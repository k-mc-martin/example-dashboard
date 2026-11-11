#!/usr/bin/env python3
"""Unit tests for sanitized AI usage collection."""

from __future__ import annotations

import datetime as dt
import importlib.util
import json
from pathlib import Path
import unittest
from unittest import mock


HERE = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location("ai_usage_under_test", HERE / "ai_usage.py")
assert SPEC and SPEC.loader
usage = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(usage)

MEASURED = dt.datetime(2026, 9, 30, 12, 0, tzinfo=dt.timezone.utc)
LIMITS = {
    "modelRoutingAuthorized": True,
    "maxCallsPerRun": 10,
    "maxInputTokensPerRun": 50000,
    "maxOutputTokensPerRun": 2560,
    "maxCostUsdPerRun": 0.05,
    "maxCallsPerDay": 40,
    "maxInputTokensPerDay": 200000,
    "maxOutputTokensPerDay": 10240,
    "maxCostUsdPerDay": 0.2,
    "maxCostUsdPerMonth": 2,
}
CONFIG = {
    "deployment_dir": "/opt/secdash/n8n",
    "compose_file": "/opt/secdash/n8n/compose.yml",
    "postgres_service": "postgres",
}


def limits_code() -> str:
    return "return [{json:" + json.dumps(LIMITS, separators=(",", ":")) + "}];"


def row(
    routed_at: str, input_tokens: float, output_tokens: float, cost: float,
    *, state: str = "delivered", model: str = usage.MODEL,
    reserved_at: str = "",
) -> dict:
    return {
        "routedAt": routed_at,
        "reservedAt": reserved_at,
        "state": state,
        "model": model,
        "inputTokens": input_tokens,
        "outputTokens": output_tokens,
        "estimatedCostUsd": cost,
    }


def observation(rows: list[dict] | None = None) -> dict:
    return {
        "measuredAt": "2026-09-30T12:00:00+00:00",
        "limitsCode": limits_code(),
        "budgetRows": [{
            "createdAt": "2026-09-01T00:00:00+00:00",
            "monthKey": "2026-09", "monthCostUsd": 0.04,
        }],
        "usageRows": rows or [],
    }


class AiUsageTests(unittest.TestCase):
    def test_zero_usage_seed_is_excluded_and_daily_matches_window(self) -> None:
        raw = observation([
            row("2026-09-01T00:00:00Z", 0, 0, 0, state="delivered"),
            row("2026-09-15T10:00:00Z", 1000, 20, 0.000224),
            row("2026-09-30T11:00:00Z", 2000, 40, 0.000448),
        ])
        result = usage.build_usage(raw, MEASURED)
        self.assertEqual(result["status"], "ok")
        self.assertEqual(result["today"]["calls"], 1)
        self.assertEqual(result["month"]["calls"], 2)
        self.assertEqual(result["window"]["calls"], 2)
        self.assertEqual(len(result["daily"]), 30)
        self.assertEqual(sum(day["calls"] for day in result["daily"]), 2)
        self.assertAlmostEqual(
            sum(day["estimatedCostUsd"] for day in result["daily"]),
            result["window"]["estimatedCostUsd"], places=12,
        )

    def test_reserved_model_call_is_unresolved_without_becoming_usage(self) -> None:
        raw = observation([
            row("", 0, 0, 0, state="model-call-reserved",
                model="", reserved_at="2026-09-30T11:55:00Z"),
        ])
        result = usage.build_usage(raw, MEASURED)
        self.assertEqual(result["unresolvedCalls"], 1)
        self.assertEqual(result["today"]["calls"], 0)
        self.assertEqual(result["reservedMonthUsd"], 0.04)

    def test_invalid_recorded_usage_makes_only_usage_unavailable(self) -> None:
        cases = {
            "negative cost": row("2026-09-30T11:00:00Z", 10, 1, -0.01),
            "future time": row("2026-09-30T13:00:00Z", 10, 1, 0.01),
            "cost without tokens": row("2026-09-30T11:00:00Z", 0, 0, 0.01),
            "non-finite counter": row("2026-09-30T11:00:00Z", float("inf"), 1, 0.01),
        }
        for label, invalid in cases.items():
            with self.subTest(label=label), mock.patch.object(
                usage, "read_observation", return_value=observation([invalid])
            ):
                result = usage.measure_ai_usage(CONFIG, MEASURED)
                self.assertEqual(result, {
                    "status": "unavailable",
                    "measuredAt": "2026-09-30T12:00:00+00:00",
                    "errorCode": "usage_unavailable",
                })

    def test_limits_are_literal_json_and_are_never_evaluated(self) -> None:
        self.assertEqual(usage.extract_limits(limits_code())["perMonthUsd"], 2.0)
        with self.assertRaises(usage.UsageError):
            usage.extract_limits("return [{json:(globalThis.compromised=true,{})}];")

    def test_query_is_repeatable_read_only_and_selects_no_message_content(self) -> None:
        query = usage.usage_query()
        self.assertIn("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY", query)
        self.assertIn("format(", query)
        self.assertIn("%I.%I", query)
        self.assertIn("current_schema()", query)
        self.assertIn('FROM "data_table"', query)
        self.assertIn('JOIN "workflow_history" published', query)
        self.assertIn('published."versionId" = workflow."activeVersionId"', query)
        for forbidden in ('"sender"', '"subject"', '"body"', '"messageId"', '"recordId"'):
            self.assertNotIn(forbidden, query)
        for mutation in (" INSERT ", " UPDATE ", " DELETE ", " ALTER ", " DROP "):
            self.assertNotIn(mutation, " " + query.upper() + " ")

    def test_missing_budget_or_data_table_returns_unavailable(self) -> None:
        missing_budget = observation()
        missing_budget["budgetRows"] = []
        completed = mock.Mock(stdout=json.dumps(missing_budget))
        with mock.patch.object(usage.subprocess, "run", return_value=completed):
            result = usage.measure_ai_usage(CONFIG, MEASURED)
        self.assertEqual(result["status"], "unavailable")
        self.assertEqual(result["errorCode"], "usage_unavailable")

        completed = mock.Mock(stdout="")
        with mock.patch.object(usage.subprocess, "run", return_value=completed):
            result = usage.measure_ai_usage(CONFIG, MEASURED)
        self.assertEqual(result["status"], "unavailable")

    def test_output_contract_contains_only_sanitized_aggregates(self) -> None:
        result = usage.build_usage(
            observation([row("2026-09-30T11:00:00Z", 10, 1, 0.01)]), MEASURED,
        )
        self.assertEqual(set(result), {
            "status", "measuredAt", "trackingStartedAt", "windowStartedAt", "model",
            "currency", "monthKey", "today", "month", "window", "reservedMonthUsd",
            "limits", "daily", "unresolvedCalls",
        })
        serialized = json.dumps(result)
        for forbidden in ("messageId", "recordId", "sender", "subject", "body", "routingRunId"):
            self.assertNotIn(forbidden, serialized)


if __name__ == "__main__":
    unittest.main()
