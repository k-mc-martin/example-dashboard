#!/usr/bin/env python3
"""Collect sanitized, read-only AI routing usage from n8n PostgreSQL."""

from __future__ import annotations

import datetime as dt
import json
import math
import re
import subprocess
from typing import Any


MODEL = "gpt-5.6-luna"
BUDGET_TABLE_NAME = "dupdash_mail_routing_budget"
LEDGER_TABLE_NAME = "dupdash_mail_continuity_ledger"
ROUTING_WORKFLOW_ID = "DupdashMailboxRoutingDrain"
LIMITS_NODE_NAME = "Demo routing limits"
MAX_SAFE_INTEGER = 9_007_199_254_740_991
LIMIT_KEYS = {
    "modelRoutingAuthorized",
    "maxCallsPerRun",
    "maxInputTokensPerRun",
    "maxOutputTokensPerRun",
    "maxCostUsdPerRun",
    "maxCallsPerDay",
    "maxInputTokensPerDay",
    "maxOutputTokensPerDay",
    "maxCostUsdPerDay",
    "maxCostUsdPerMonth",
}
class UsageError(RuntimeError):
    """Raised when the usage observation cannot be proven safe and complete."""


def utc_now() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


def iso_utc(value: dt.datetime) -> str:
    return value.astimezone(dt.timezone.utc).isoformat()


def parse_instant(value: Any, field: str) -> dt.datetime:
    if not isinstance(value, str) or not value.strip():
        raise UsageError(f"{field} is invalid")
    text = value.strip()
    if text.endswith(("Z", "z")):
        text = text[:-1] + "+00:00"
    try:
        parsed = dt.datetime.fromisoformat(text)
    except ValueError as exc:
        raise UsageError(f"{field} is invalid") from exc
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise UsageError(f"{field} must include a timezone")
    return parsed.astimezone(dt.timezone.utc)


def finite_number(value: Any, field: str, *, positive: bool = False) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise UsageError(f"{field} is invalid")
    number = float(value)
    if not math.isfinite(number) or number < 0 or (positive and number <= 0):
        raise UsageError(f"{field} is invalid")
    return number


def counter(value: Any, field: str) -> int:
    number = finite_number(value, field)
    if not number.is_integer() or number > MAX_SAFE_INTEGER:
        raise UsageError(f"{field} is invalid")
    return int(number)


def extract_limits(code: Any) -> dict[str, float]:
    """Parse the literal JSON returned by the named node without evaluating code."""
    if not isinstance(code, str):
        raise UsageError("routing limits code is unavailable")
    match = re.fullmatch(r"\s*return\s*\[\s*\{\s*json\s*:\s*(.*?)\s*\}\s*\]\s*;?\s*", code, re.S)
    if match is None:
        raise UsageError("routing limits code is not a JSON return literal")
    try:
        limits = json.loads(match.group(1), parse_constant=lambda _value: (_ for _ in ()).throw(ValueError()))
    except (json.JSONDecodeError, ValueError) as exc:
        raise UsageError("routing limits JSON is invalid") from exc
    if not isinstance(limits, dict) or set(limits) != LIMIT_KEYS:
        raise UsageError("routing limits fields are invalid")
    if limits.get("modelRoutingAuthorized") is not True:
        raise UsageError("recurring model routing is not authorized")
    for key in LIMIT_KEYS - {"modelRoutingAuthorized"}:
        finite_number(limits.get(key), key, positive=True)
    return {
        "perRunUsd": finite_number(limits["maxCostUsdPerRun"], "maxCostUsdPerRun", positive=True),
        "perDayUsd": finite_number(limits["maxCostUsdPerDay"], "maxCostUsdPerDay", positive=True),
        "perMonthUsd": finite_number(limits["maxCostUsdPerMonth"], "maxCostUsdPerMonth", positive=True),
    }


def usage_query() -> str:
    """Return a psql script whose only result is narrowly selected usage telemetry."""
    # n8n derives physical names as <configured-prefix>data_table_user_<data-table-id>.
    # PostgreSQL resolves those relations, and format(%I) quotes both schema and table.
    return rf"""
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
WITH wanted AS (
  SELECT id, name
  FROM "data_table"
  WHERE name IN ('{BUDGET_TABLE_NAME}', '{LEDGER_TABLE_NAME}')
), physical AS (
  SELECT w.name, ns.nspname AS schema_name, cls.relname AS relation_name
  FROM wanted w
  JOIN pg_catalog.pg_class cls
    ON right(cls.relname, length('data_table_user_' || w.id)) = 'data_table_user_' || w.id
   AND cls.relkind IN ('r', 'p')
  JOIN pg_catalog.pg_namespace ns ON ns.oid = cls.relnamespace
  WHERE ns.nspname = current_schema()
), resolved AS (
  SELECT
    max(schema_name) FILTER (WHERE name = '{BUDGET_TABLE_NAME}') AS budget_schema,
    max(relation_name) FILTER (WHERE name = '{BUDGET_TABLE_NAME}') AS budget_relation,
    max(schema_name) FILTER (WHERE name = '{LEDGER_TABLE_NAME}') AS ledger_schema,
    max(relation_name) FILTER (WHERE name = '{LEDGER_TABLE_NAME}') AS ledger_relation
  FROM physical
  HAVING count(*) FILTER (WHERE name = '{BUDGET_TABLE_NAME}') = 1
     AND count(*) FILTER (WHERE name = '{LEDGER_TABLE_NAME}') = 1
), limits AS (
  SELECT node -> 'parameters' ->> 'jsCode' AS limits_code
  FROM "workflow_entity" workflow
  JOIN "workflow_history" published
    ON published."workflowId" = workflow.id
   AND published."versionId" = workflow."activeVersionId"
  CROSS JOIN LATERAL jsonb_array_elements(published.nodes::jsonb) node
  WHERE workflow.id = '{ROUTING_WORKFLOW_ID}'
    AND node ->> 'name' = '{LIMITS_NODE_NAME}'
  LIMIT 2
), observation AS (
  SELECT resolved.*, min(limits_code) AS limits_code
  FROM resolved CROSS JOIN limits
  GROUP BY budget_schema, budget_relation, ledger_schema, ledger_relation
  HAVING count(*) = 1
)
SELECT format(
$usage$
SELECT json_build_object(
  'measuredAt', %L,
  'limitsCode', %L,
  'budgetRows', COALESCE((
    SELECT json_agg(json_build_object(
      'createdAt', "createdAt",
      'monthKey', "monthKey",
      'monthCostUsd', "monthCostUsd"
    ) ORDER BY id)
    FROM %I.%I
    WHERE "budgetKey" = 'mail-routing'
  ), '[]'::json),
  'usageRows', COALESCE((
    SELECT json_agg(json_build_object(
      'routedAt', "routedAt",
      'reservedAt', "reservedAt",
      'state', "state",
      'model', "model",
      'inputTokens', "modelInputTokens",
      'outputTokens', "modelOutputTokens",
      'estimatedCostUsd', "modelCostUsd"
    ) ORDER BY id)
    FROM %I.%I
    WHERE COALESCE("modelInputTokens", 0) <> 0
       OR COALESCE("modelOutputTokens", 0) <> 0
       OR COALESCE("modelCostUsd", 0) <> 0
       OR "state" IN ('model-call-reserved', 'model-call-failed', 'model-call-uncertain')
  ), '[]'::json)
)::text;
$usage$,
  transaction_timestamp(), limits_code,
  budget_schema, budget_relation, ledger_schema, ledger_relation
)
FROM observation
\gexec
COMMIT;
"""


def psql_command(config: dict[str, str]) -> list[str]:
    return [
        "docker", "compose", "--project-directory", config["deployment_dir"],
        "--file", config["compose_file"], "exec", "-T", config["postgres_service"],
        "sh", "-ceu", 'exec psql --no-psqlrc --quiet --tuples-only --no-align '
        '--set=ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" '
        '--file=-',
        "dupdash-ai-usage",
    ]


def read_observation(config: dict[str, str]) -> dict[str, Any]:
    try:
        completed = subprocess.run(
            psql_command(config), input=usage_query(),
            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True,
            check=True, timeout=15,
        )
    except (FileNotFoundError, subprocess.CalledProcessError, subprocess.TimeoutExpired) as exc:
        raise UsageError("usage query failed") from exc
    output = completed.stdout.strip()
    if not output:
        raise UsageError("usage tables or workflow limits are unavailable")
    try:
        raw = json.loads(output, parse_constant=lambda _value: (_ for _ in ()).throw(ValueError()))
    except (json.JSONDecodeError, ValueError) as exc:
        raise UsageError("usage query returned invalid JSON") from exc
    if not isinstance(raw, dict) or set(raw) != {
        "measuredAt", "limitsCode", "budgetRows", "usageRows"
    }:
        raise UsageError("usage observation fields are invalid")
    if not isinstance(raw["budgetRows"], list) or len(raw["budgetRows"]) != 1:
        raise UsageError("routing budget singleton is unavailable")
    if not isinstance(raw["usageRows"], list):
        raise UsageError("usage rows are invalid")
    return raw


def empty_summary() -> dict[str, int | float]:
    return {"calls": 0, "inputTokens": 0, "outputTokens": 0, "estimatedCostUsd": 0.0}


def add_usage(summary: dict[str, int | float], input_tokens: int, output_tokens: int, cost: float) -> None:
    summary["calls"] = int(summary["calls"]) + 1
    summary["inputTokens"] = int(summary["inputTokens"]) + input_tokens
    summary["outputTokens"] = int(summary["outputTokens"]) + output_tokens
    summary["estimatedCostUsd"] = float(summary["estimatedCostUsd"]) + cost
    if (int(summary["inputTokens"]) > MAX_SAFE_INTEGER
            or int(summary["outputTokens"]) > MAX_SAFE_INTEGER
            or not math.isfinite(float(summary["estimatedCostUsd"]))):
        raise UsageError("usage aggregate is invalid")


def build_usage(raw: dict[str, Any], measured_at: dt.datetime) -> dict[str, Any]:
    measured_at = measured_at.astimezone(dt.timezone.utc)
    limits = extract_limits(raw.get("limitsCode"))

    budget = raw["budgetRows"][0]
    if not isinstance(budget, dict) or set(budget) != {
        "createdAt", "monthKey", "monthCostUsd"
    }:
        raise UsageError("routing budget row is invalid")
    tracking_start = parse_instant(budget.get("createdAt"), "trackingStartedAt")
    if tracking_start > measured_at:
        raise UsageError("trackingStartedAt is in the future")
    month_key = measured_at.strftime("%Y-%m")
    stored_month_key = budget.get("monthKey")
    if not isinstance(stored_month_key, str) or re.fullmatch(r"\d{4}-\d{2}", stored_month_key) is None:
        raise UsageError("routing budget month is invalid")
    try:
        stored_month = dt.datetime.strptime(stored_month_key, "%Y-%m").replace(tzinfo=dt.timezone.utc)
    except ValueError as exc:
        raise UsageError("routing budget month is invalid") from exc
    if stored_month > measured_at.replace(day=1, hour=0, minute=0, second=0, microsecond=0):
        raise UsageError("routing budget month is in the future")
    stored_month_cost = finite_number(budget.get("monthCostUsd"), "monthCostUsd")
    reserved_month_usd = stored_month_cost if stored_month_key == month_key else 0.0

    window_start = max(tracking_start, measured_at - dt.timedelta(days=30))
    today_start = measured_at.replace(hour=0, minute=0, second=0, microsecond=0)
    month_start = today_start.replace(day=1)
    daily: dict[str, dict[str, int | float]] = {}
    cursor = window_start.date()
    while cursor <= measured_at.date():
        daily[cursor.isoformat()] = empty_summary()
        cursor += dt.timedelta(days=1)
    if len(daily) > 31:
        raise UsageError("usage window is invalid")

    today = empty_summary()
    month = empty_summary()
    unresolved_calls = 0
    for index, row in enumerate(raw["usageRows"]):
        if not isinstance(row, dict) or set(row) != {
            "routedAt", "reservedAt", "state", "model", "inputTokens",
            "outputTokens", "estimatedCostUsd",
        }:
            raise UsageError("usage row is invalid")
        input_tokens = counter(row.get("inputTokens"), f"usageRows[{index}].inputTokens")
        output_tokens = counter(row.get("outputTokens"), f"usageRows[{index}].outputTokens")
        cost = finite_number(row.get("estimatedCostUsd"), f"usageRows[{index}].estimatedCostUsd")
        has_usage = input_tokens + output_tokens > 0
        uncertain = row.get("state") in {
            "model-call-reserved", "model-call-failed", "model-call-uncertain"
        }
        if not has_usage:
            if cost > 0:
                raise UsageError("recorded cost has no model token usage")
            if uncertain:
                reserved_at = parse_instant(row.get("reservedAt"), f"usageRows[{index}].reservedAt")
                if reserved_at > measured_at:
                    raise UsageError("unresolved model reservation is in the future")
                unresolved_calls += 1
            continue
        if row.get("model") != MODEL or cost <= 0:
            raise UsageError("recorded model usage is invalid")
        routed_at = parse_instant(row.get("routedAt"), f"usageRows[{index}].routedAt")
        if routed_at < tracking_start or routed_at > measured_at:
            raise UsageError("recorded model usage time is outside the tracking period")
        if routed_at >= today_start:
            add_usage(today, input_tokens, output_tokens, cost)
        if routed_at >= month_start:
            add_usage(month, input_tokens, output_tokens, cost)
        if routed_at >= window_start:
            add_usage(daily[routed_at.date().isoformat()], input_tokens, output_tokens, cost)

    window = empty_summary()
    daily_rows = []
    for date, summary in daily.items():
        add_calls = int(summary["calls"])
        window["calls"] = int(window["calls"]) + add_calls
        window["inputTokens"] = int(window["inputTokens"]) + int(summary["inputTokens"])
        window["outputTokens"] = int(window["outputTokens"]) + int(summary["outputTokens"])
        window["estimatedCostUsd"] = (
            float(window["estimatedCostUsd"]) + float(summary["estimatedCostUsd"])
        )
        daily_rows.append({"date": date, **summary})
    if (int(window["inputTokens"]) > MAX_SAFE_INTEGER
            or int(window["outputTokens"]) > MAX_SAFE_INTEGER
            or not math.isfinite(float(window["estimatedCostUsd"]))):
        raise UsageError("usage window aggregate is invalid")

    return {
        "status": "ok",
        "measuredAt": iso_utc(measured_at),
        "trackingStartedAt": iso_utc(tracking_start),
        "windowStartedAt": iso_utc(window_start),
        "model": MODEL,
        "currency": "USD",
        "monthKey": month_key,
        "today": today,
        "month": month,
        "window": window,
        "reservedMonthUsd": reserved_month_usd,
        "limits": limits,
        "daily": daily_rows,
        "unresolvedCalls": unresolved_calls,
    }


def unavailable(measured_at: dt.datetime) -> dict[str, str]:
    return {
        "status": "unavailable",
        "measuredAt": iso_utc(measured_at),
        "errorCode": "usage_unavailable",
    }


def measure_ai_usage(
    config: dict[str, str], measured_at: dt.datetime | None = None,
) -> dict[str, Any]:
    fallback_measured = measured_at or utc_now()
    if fallback_measured.tzinfo is None or fallback_measured.utcoffset() is None:
        raise ValueError("measured_at must include a timezone")
    fallback_measured = fallback_measured.astimezone(dt.timezone.utc)
    try:
        raw = read_observation(config)
        measured = (
            fallback_measured if measured_at is not None
            else parse_instant(raw.get("measuredAt"), "measuredAt")
        )
        return build_usage(raw, measured)
    except (UsageError, KeyError, TypeError, ValueError, OverflowError):
        return unavailable(fallback_measured)
