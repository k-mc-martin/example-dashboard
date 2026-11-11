#!/usr/bin/env python3
"""Run the campaign tools against a disposable, fictional Dupdash target."""
import hashlib
import json
import os
import secrets
import csv
import argparse
import fcntl
import io
import subprocess
import sys
import tempfile
import uuid
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
OUT = ROOT / "artifacts/security-tools"
BASELINE = Path("docs/security/evidence/tools/baseline.json")
IMAGES = {
    "gitleaks": "zricethezav/gitleaks:v8.30.1@sha256:c00b6bd0aeb3071cbcb79009cb16a60dd9e0a7c60e2be9ab65d25e6bc8abbb7f",
    "semgrep": "semgrep/semgrep:1.171.0@sha256:bdf7013b2c3634a487671158da77c554f531742326b543a9464d2adf6c433ac8",
    "osv": "ghcr.io/google/osv-scanner:v2.7.1@sha256:a70ffffc2bfd33482953e5d6b64c6fcdb30239717a07b0f0d3ab2859ce3e4cde",
    "inspector": "ghcr.io/modelcontextprotocol/inspector:2.14.0@sha256:3d2834aa15cac87b5d17c680ad8db4e36a0ac2360c270057b80baf96579eeb66",
    "k6": "grafana/k6:2.3.0@sha256:2dd4756ec6e14e62778916e1eb850108e4b499304c02df56760fa0bdb0fba0b8",
    "zap": "ghcr.io/zaproxy/zaproxy:2.17.0@sha256:9624669db72f54d86c4b46a7064518bd9bf79d8c61a4c31befa9923489f328af",
}


def run(args, allowed=(0,), cwd=ROOT, timeout=480):
    p = subprocess.run(list(map(str, args)), cwd=cwd, capture_output=True, text=True,
                       errors="replace", timeout=timeout)
    if p.returncode not in allowed:
        # Full scanner output can contain source snippets or credential values.
        # Keep tool output private on failure, outside the CI upload directory.
        with (OUT.parent / "security-tools-debug.log").open("a") as f:
            f.write(p.stdout + p.stderr + "\n")
        raise RuntimeError(f"{args[0]} exited {p.returncode} (see local debug log)")
    return p


def docker(image, args, mounts=(), network="none", flags=(), allowed=(0,)):
    command = ["docker", "run", "--rm", "--network", network, *flags]
    for host, guest, mode in mounts:
        command.extend(["-v", f"{host}:{guest}:{mode}"])
    return run([*command, IMAGES.get(image, image), *args], allowed)


def write(name, data):
    (OUT / name).write_text(json.dumps(data, indent=2) + "\n")


def snapshot(target):
    files = run(["git", "ls-files", "-co", "--exclude-standard", "-z"]).stdout.split("\0")
    fingerprint = hashlib.sha256()
    for name in sorted(set(filter(None, files))):
        source = ROOT / name
        if source.is_symlink():
            data = os.fsencode(os.readlink(source))
            # Scan link text without ever following a link outside the checkout.
        elif source.is_file():
            data = source.read_bytes()
        else:
            continue
        dest = target / name
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(data)
        if Path(name) == BASELINE:
            continue  # The generated snapshot identifies its own input.
        fingerprint.update(os.fsencode(name) + b"\0" + hashlib.sha256(data).digest())
    return fingerprint.hexdigest()


def gitleaks(directory, mode, work):
    report = work / "leaks.json"
    report.unlink(missing_ok=True)
    opts = ["--log-opts=--all --full-history -m"] if mode == "git" else []
    p = docker("gitleaks", [mode, "--no-banner", "--redact=100", "--report-format=json",
                           "--report-path=/out/leaks.json", *opts, "/src"],
               [(directory, "/src", "ro"), (work, "/out", "rw")], allowed=(0, 1),
               flags=["-e", "GIT_CONFIG_COUNT=1", "-e", "GIT_CONFIG_KEY_0=safe.directory",
                      "-e", "GIT_CONFIG_VALUE_0=/src"])
    findings = json.loads(report.read_text())
    if bool(findings) != bool(p.returncode):
        raise ValueError("Inconsistent Gitleaks result")
    return [{k: item.get(k) for k in ("RuleID", "File", "StartLine", "Commit")} for item in findings]


def leak_check(source, mode, work):
    found = gitleaks(source, mode, work)
    write("gitleaks-" + mode + ".json", found)
    return ("findings" if found else "passed"), f"{len(found)} flagged matches"


def history(work):
    if run(["git", "rev-parse", "--is-shallow-repository"]).stdout.strip() == "true":
        raise RuntimeError("History is shallow. Fetch the complete history and rerun.")
    refs = run(["git", "rev-list", "--all", "--count"]).stdout.strip()
    if refs == "0":
        return "pending", "No commits in this repository yet"
    status, note = leak_check(ROOT, "git", work)
    return status, f"{refs} reachable commits, {note}"


def history_control(work):
    repo = work / "canary"
    repo.mkdir()
    def git(*args):
        run(["git", "-c", "user.name=Demo Fixture", "-c", "user.email=fixture@example.invalid",
             "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", *args], cwd=repo)
    git("init", "-q")
    (repo / "sample.txt").write_text("token=ghp_" + secrets.token_hex(18) + "\n")
    git("add", "sample.txt")
    git("commit", "-qm", "Synthetic marker")
    git("rm", "-q", "sample.txt")
    git("commit", "-qm", "Remove marker")
    found = gitleaks(repo, "git", work)
    if not any(f["RuleID"] == "github-pat" and f["File"] == "sample.txt" for f in found):
        raise ValueError("Deleted history canary was missed")
    return "passed", "Detected a synthetic token deleted before HEAD"


def semgrep(source):
    p = docker("semgrep", ["semgrep", "scan", "--metrics=off", "--disable-version-check",
               "--strict", "--error", "--json", "--no-git-ignore", "--config", "/rules.yml", "/src"],
               [(source, "/src", "ro"), (HERE / "semgrep.yml", "/rules.yml", "ro")], allowed=(0, 1))
    data = json.loads(p.stdout)
    if data["errors"] or not data["paths"]["scanned"]:
        raise ValueError("Semgrep reported errors or scanned no source")
    found = [{"rule": x["check_id"], "path": x["path"], "line": x["start"]["line"]}
             for x in data["results"]]
    if bool(found) != bool(p.returncode):
        raise ValueError("Inconsistent Semgrep exit status")
    return len(data["paths"]["scanned"]), found


def source_rules(source):
    count, found = semgrep(source)
    reviews = json.loads((HERE / "semgrep-reviews.json").read_text())
    accepted = {}
    for review in reviews:
        file = source / review["path"]
        if file.is_file() and hashlib.sha256(file.read_bytes()).hexdigest() == review["sha256"]:
            for line in review["lines"]:
                accepted[(review["rule"], "/src/" + review["path"], line)] = review["reason"]
    for match in found:
        reason = accepted.get((match["rule"], match["path"], match["line"]))
        if reason:
            match["review"] = reason
    open_matches = sum("review" not in match for match in found)
    write("semgrep.json", {"filesScanned": count, "matches": found, "open": open_matches})
    return ("findings" if open_matches else "passed"), f"{count} source files, {len(found)} matches, {open_matches} open"


def rule_control(work):
    directory = work / "unsafe-js"
    directory.mkdir()
    (directory / "sample.js").write_text(
        'eval(input);\nconst opts = {rejectUnauthorized: false};\ndb.prepare(`select ${input}`);\n')
    _, found = semgrep(directory)
    expected = {"javascript-dynamic-code", "disabled-tls-validation", "unescaped-sql-interpolation"}
    if {row["rule"].split(".")[-1] for row in found} != expected:
        raise ValueError("Seeded examples did not trigger each Semgrep rule")
    return "passed", "Each local rule detected its seeded example"


def osv(source):
    p = docker("osv", ["scan", "source", "--lockfile", "/input/package-lock.json",
               "--all-packages", "--format", "json"], network="bridge", allowed=(0, 1),
               mounts=[(source / "package-lock.json", "/input/package-lock.json", "ro")])
    packages = [p for r in json.loads(p.stdout)["results"] for p in r["packages"]]
    if not packages:
        raise ValueError("OSV returned no packages")
    matches = [{"name": p["package"]["name"], "version": p["package"]["version"],
                "advisories": [v["id"] for v in p["vulnerabilities"]]}
               for p in packages if p.get("vulnerabilities")]
    if bool(matches) != bool(p.returncode):
        raise ValueError("Inconsistent OSV result")
    write("osv.json", {"packagesScanned": len(packages), "matches": matches})
    ids = {i for m in matches for i in m["advisories"]}
    return ("findings" if matches else "passed"), f"{len(packages)} package versions, {len(ids)} distinct advisories across {len(matches)} affected versions"


def standards(source):
    def fetch(url):
        return run(["curl", "--fail", "--silent", "--show-error", "--location",
                    "--retry", "2", "--max-time", "45", url]).stdout

    csv_url = ("https://raw.githubusercontent.com/OWASP/ASVS/5cf9b032440be53ce345ab3c130fda46ba1ce7a2/"
               "5.0/docs_en/OWASP_Application_Security_Verification_Standard_5.0.0_en.csv")
    # Hash the original bytes. Text-mode command output normalizes the upstream CSV line endings.
    csv_bytes = subprocess.check_output(["curl", "-fsSL", "--retry", "2", "--max-time", "45", csv_url])
    if hashlib.sha256(csv_bytes).hexdigest() != "98c8fe911b9edb403af8ee05d3ce8201ecac2659e313b053890a62847cdcf680":
        raise ValueError("ASVS reference checksum mismatch")
    reference = {"v5.0.0-" + row["req_id"][1:]: int(row["L"])
                 for row in csv.DictReader(io.StringIO(csv_bytes.decode("utf-8-sig")))}
    manifest = docker("node:24.21.0-bookworm-slim",
                      ["node", "--input-type=module", "-e",
                       "import * as m from '/tests/account-evidence-cases.mjs'; console.log(JSON.stringify(m))"],
                      [(source / "tests", "/tests", "ro")])
    cases = json.loads(manifest.stdout)
    mapped = {r for case in cases["cases"].values() for r in case["requirements"]}
    manual = {c["id"] for c in cases["manualChecks"]}
    if (mapped | manual) - reference.keys():
        raise ValueError("Unknown ASVS ID in the account manifest")
    wstg = {
        "ATHZ-02": ("05-Authorization_Testing/02-Testing_for_Bypassing_Authorization_Schema", "roles"),
        "ATHZ-03": ("05-Authorization_Testing/03-Testing_for_Privilege_Escalation", "memberTabs"),
        "ATHZ-04": ("05-Authorization_Testing/04-Testing_for_Insecure_Direct_Object_References", "isolation"),
        "SESS-06": ("06-Session_Management_Testing/06-Testing_for_Logout_Functionality", "login"),
    }
    procedures = {}
    for short_id, (path, case) in wstg.items():
        url = ("https://raw.githubusercontent.com/OWASP/wstg/dd33419e10edb22b78d89325a6c2aad9f184e3a2/"
               "document/4-Web_Application_Security_Testing/" + path + ".md")
        if "WSTG-" + short_id not in fetch(url):
            raise ValueError(f"Unknown WSTG procedure {short_id}")
        procedures["WSTG-v42-" + short_id] = {"procedure": url, "scenario": cases["cases"][case]["title"]}
    write("owasp-mappings.json", {
        "scope": "Account exercise reference mappings. Test outcomes are in the account report.",
        "catalog": csv_url, "catalogRequirements": len(reference),
        "automated": sorted(mapped), "manual": sorted(manual), "WSTG": procedures})
    return "passed", f"{len(mapped | manual)} ASVS requirement references and {len(procedures)} WSTG procedures validated"


def inspector():
    def call(method, *args):
        p = docker("inspector", ["--cli", "node", "/checks/inspector-fixture.mjs",
                   "--protocol-era", "modern", "--method", method, *args], [(HERE, "/checks", "ro")])
        return json.loads(p.stdout)
    discovery = call("initialize")
    if discovery.get("protocolVersion") != "2026-07-28":
        raise ValueError("Unexpected MCP protocol version")
    listing = call("tools/list")
    result = call("tools/call", "--tool-name", "fixture_status")
    if [t["name"] for t in listing["tools"]] != ["fixture_status"] or result["content"] != [
            {"type": "text", "text": "fictional provider ready"}] or result.get("isError"):
        raise ValueError("Inspector did not return the expected tool and content")
    write("inspector.json", {"negotiated": discovery, "tools/list": listing, "tools/call": result})
    return "passed", "Discovered and called the offline fixture tool"


def k6(network, work):
    docker("k6", ["run", "--no-usage-report", "--summary-export=/out/k6.json", "/checks/roles.k6.js"],
           [(HERE, "/checks", "ro"), (work, "/out", "rw")], network)
    info = json.loads((work / "k6.json").read_text())["metrics"]
    checks = info["checks"]
    write("k6.json", {key: info[key] for key in ("checks", "completed_role_sessions", "iterations", "http_reqs", "http_req_failed")})
    return "passed", f"{int(checks['passes'])} checks in {int(info['iterations']['count'])} role sessions"


def zap(network, work, build_img, mounts):
    session = docker(build_img, ["node", "--input-type=module", "-e",
            "import { visitor, signIn } from '/app/tests/demo-http-client.mjs';"
            "console.log(await signIn(await visitor(), 'Employee'));"], mounts, network).stdout.strip()
    template = (HERE / "zap.yml").read_text()
    plan = work / "employee-plan.yml"
    plan.write_text(template.replace("EMPLOYEE_COOKIE_HEADER", json.dumps("Cookie: " + session)))
    result = docker("zap", ["zap.sh", "-cmd", "-autorun", "/plan.yml"],
                    [(plan, "/plan.yml", "ro"), (work, "/zap/wrk", "rw")],
                    network, allowed=(0, 1, 2))
    output = result.stdout + result.stderr
    if "Automation plan failures:" in output or "Difference in response code" in output or output.count("Job requestor requesting URL") != 5:
        raise ValueError("ZAP failed to exercise all five requests with their expected responses")
    report = json.loads((work / "report.json").read_text())
    sites = report.get("site", [])
    if [s["@name"] for s in sites] != ["http://127.0.0.1:5286"]:
        raise ValueError("Unexpected or missing ZAP target")
    alerts = [{k: a[k] for k in ("pluginid", "alert", "riskcode", "count")} for a in sites[0]["alerts"]]
    write("zap.json", {"target": sites[0]["@name"], "alerts": alerts})
    highest = max((int(a["riskcode"]) for a in alerts), default=0)
    if result.returncode not in ({0} if highest < 2 else {1, 2}):
        raise ValueError("ZAP reported a plan error outside its alert threshold")
    return ("findings" if highest >= 2 else "passed"), f"{len(alerts)} alert types, highest risk {['informational','low','medium','high'][highest]}"


def main():
    import time
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--save-baseline", action="store_true",
                        help="save a sanitized copy of the completed run under docs/security/evidence")
    args = parser.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    lock = (OUT.parent / "security-tools.lock").open("a")
    fcntl.flock(lock, fcntl.LOCK_EX)
    for f in OUT.glob("*.json"):
        f.unlink()
    debug = OUT.parent / "security-tools-debug.log"
    debug.unlink(missing_ok=True)
    debug.touch(mode=0o600)
    checks = {}
    def record(name, func, *args):
        print(f"Running {name} ...", flush=True)
        try:
            status, detail = func(*args)
        except (OSError, RuntimeError, ValueError, KeyError, subprocess.SubprocessError) as e:
            status, detail = "error", str(e)
        checks[name] = {"status": status, "detail": detail}
        print(f"  {status}: {detail}", flush=True)

    with tempfile.TemporaryDirectory(prefix="dupdash-security-") as temp:
        work = Path(temp)
        source = work / "source"
        source.mkdir()
        fingerprint = snapshot(source)
        compose = ["docker", "compose", "-p", "dupdash-check-" + uuid.uuid4().hex[:12],
                   "-f", source / "infra/simulation/compose.yml", "-f", source / HERE.relative_to(ROOT) / "compose.yml"]
        # Each tool sees only its own writable scratch directory.
        def scratch(name):
            path = work / name
            path.mkdir()
            path.chmod(0o777)
            return path
        record("OWASP references and mappings", standards, source)
        record("Gitleaks source", leak_check, source, "dir", scratch("source-leaks"))
        record("Gitleaks full history", history, scratch("history-leaks"))
        record("Gitleaks deleted-secret control", history_control, scratch("history-control"))
        record("Semgrep source", source_rules, source)
        record("Semgrep rule controls", rule_control, work)
        record("OSV dependencies", osv, source)
        record("MCP Inspector stdio", inspector)
        live = ("Application and provider harness", "Provider delivery via n8n", "k6 mixed roles", "ZAP passive API baseline")
        try:
            run([*compose, "up", "--build", "--detach", "--wait"], timeout=900)
            container = run([*compose, "ps", "-q", "dashboard"]).stdout.strip()
            if not container:
                raise RuntimeError("Missing disposable dashboard container")
            network = "container:" + container
            for _ in range(30):
                ready = run(["docker", "exec", container, "node", "-e",
                    "fetch('http://127.0.0.1:5286').then(r=>process.exit(r.status===200?0:1)).catch(()=>process.exit(1))"], allowed=(0, 1))
                if ready.returncode == 0:
                    break
                time.sleep(1)
            else:
                raise RuntimeError("Disposable dashboard did not become ready")

            build_img = run(["docker", "build", "-q", "--target", "build", "-f", source / "infra/dashboard/Dockerfile", source],
                            timeout=900).stdout.strip().splitlines()[-1]
            mounts = [(source / name, "/app/" + name, "ro") for name in ("tests", "lib", "db", "infra")]
            def harness(paths, test=False):
                args = ["node", "--test", "--test-reporter=tap"] if test else ["node"]
                result = docker(build_img, args + paths, mounts, network)
                if test:
                    lines = [s for s in result.stdout.splitlines() if s.startswith(("# tests ", "# pass ", "# fail "))]
                    if len(lines) != 3 or lines[-1] != "# fail 0" or lines[1] == "# pass 0":
                        raise ValueError("Incomplete Node test output")
                    return "passed", ", ".join(s[2:] for s in lines)
                return "passed", "Verified provider delivery, retries, workspace isolation and backup completion"
            record(live[0], harness, ["tests/demo-accounts-http.mjs", "tests/demo-login.test.mjs",
                "tests/hosted-sessions.test.mjs", "tests/demo-isolation.test.mjs", "tests/fictional-providers.test.mjs"], True)
            record(live[1], harness, ["tests/fictional-providers-http.mjs"])
            record(live[2], k6, network, scratch("k6"))
            record(live[3], zap, network, scratch("zap"), build_img, mounts)
        except (OSError, RuntimeError, subprocess.SubprocessError) as e:
            for name in live:
                checks.setdefault(name, {"status": "error", "detail": str(e)})
        finally:
            run([*compose, "down", "-v", "--rmi", "local"])
        commit = run(["git", "rev-parse", "--verify", "HEAD"], allowed=(0, 128)).stdout.strip() or None
        write("summary.json", {"generatedAt": datetime.now(timezone.utc).isoformat(), "commit": commit,
              "sourceSha256": fingerprint, "images": IMAGES, "checks": checks})
    if args.save_baseline and all(c["status"] != "error" for c in checks.values()):
        saved = {p.stem: json.loads(p.read_text()) for p in sorted(OUT.glob("*.json"))}
        destination = ROOT / BASELINE
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_text(json.dumps(saved, indent=2) + "\n")
    if os.environ.get("GITHUB_STEP_SUMMARY"):
        with open(os.environ["GITHUB_STEP_SUMMARY"], "a") as report:
            report.write("## Dupdash security tool results\n\n")
            for name, row in checks.items():
                report.write(f"- **{name}** · {row['status']} · {row['detail']}\n")
    return int(any(c["status"] != "passed" for c in checks.values()))


if __name__ == "__main__":
    sys.exit(main())
