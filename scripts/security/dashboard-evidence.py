"""Collect public results for the deployed commit. Write only display fields to stdout."""
import argparse
import json
from pathlib import Path
import re
import subprocess
import tempfile

from dashboard_browser_results import browser_results

REPO = "k-mc-martin/example-dashboard"
WORKFLOWS = (
    ("security-tools.yml", "Security tools", "security-tool-evidence", "summary.json"),
    ("campaign.yml", "Exercise campaign", "security-exercise-campaign", "report.json"),
    ("hosted-exercises.yml", "Hosted dashboard exercises", None, None),
    ("hosted-boundary.yml", "Hosted boundary", "hosted-boundary", "report.json"),
)


def gh(*args):
    return subprocess.check_output(["gh", *args, "--repo", REPO], text=True)


def collect(commit):
    result = {"commit": commit, "runs": [], "checks": []}
    for workflow, title, artifact, filename in WORKFLOWS:
        runs = json.loads(gh("run", "list", "--workflow", workflow, "--commit", commit,
                             "--branch", "main", "--limit", "1",
                             "--json", "databaseId,headSha,status,conclusion,updatedAt"))
        if not runs or runs[0]["headSha"] != commit:
            continue
        run = runs[0]
        result["runs"].append({"title": title, "id": run["databaseId"],
                               "status": run["conclusion"] or run["status"],
                               "updatedAt": run["updatedAt"]})
        if not artifact or run["status"] != "completed" or run["conclusion"] != "success":
            continue
        with tempfile.TemporaryDirectory() as tmp:
            gh("run", "download", str(run["databaseId"]), "--name", artifact, "--dir", tmp)
            report = json.loads((Path(tmp) / filename).read_text())
            if (report.get("commit") or report.get("sourceCommit")) != commit:
                raise ValueError("Artifact revision differs from " + title)
            if workflow == "security-tools.yml":
                for name, check in report["checks"].items():
                    if name.startswith(("Gitleaks", "Semgrep", "OSV", "ZAP")):
                        result["checks"].append({"name": name, "status": check["status"],
                                                 "detail": check["detail"]})
            if workflow == "campaign.yml":
                for filename, label in (("checks.tap", "Server checks"), ("dashboard-browser.tap", "Browser checks")):
                    tap = (Path(tmp) / filename).read_text()
                    if label == "Browser checks":
                        result["checks"].extend(browser_results(tap))
                    counts = dict(re.findall(r"^# (pass|fail|skipped) (\d+)$", tap, re.M))
                    result["checks"].append({"name": label, "status": run["conclusion"],
                                             "detail": ", ".join(f"{v} {k}" for k, v in counts.items())})
            if workflow == "hosted-boundary.yml" and report.get("deployedCommit") != commit:
                raise ValueError("The tested website served another commit")
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("commit")
    args = parser.parse_args()
    if not re.fullmatch("[0-9a-f]{40}", args.commit):
        parser.error("Supply a full Git commit SHA")
    print(json.dumps(collect(args.commit)))
