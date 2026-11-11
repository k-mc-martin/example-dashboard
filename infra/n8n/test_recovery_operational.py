import json
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).parent
WORKFLOW = ROOT / "workflows/providers/operational-recovery.json"

class RecoveryOperationalTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        subprocess.run(["node", str(WORKFLOW.with_suffix(".mjs")), "--write"], check=True)
        cls.workflow = json.loads(WORKFLOW.read_text())
        cls.nodes = {node["name"]: node for node in cls.workflow["nodes"]}

    def project(self, value):
        source = self.nodes["Sanitize recovery telemetry"]["parameters"]["jsCode"]
        harness = "const vm=require('node:vm');const s=JSON.parse(process.argv[1]),v=JSON.parse(process.argv[2]);const o=vm.runInNewContext(`(()=>{${s}})()`,{$json:v,Date});process.stdout.write(JSON.stringify(o[0].json));"
        result = subprocess.run(["node", "-e", harness, json.dumps(source), json.dumps(value)], text=True, capture_output=True, check=True)
        return json.loads(result.stdout)

    def test_workflow_safety(self):
        self.assertEqual(self.workflow["id"], "DupdashRecoveryOperational")
        self.assertFalse(self.workflow["active"])
        self.assertEqual(self.workflow["settings"]["saveDataSuccessExecution"], "none")
        self.assertEqual(self.workflow["settings"]["saveDataErrorExecution"], "none")
        self.assertFalse(self.workflow["settings"]["saveManualExecutions"])
        self.assertEqual(self.workflow["settings"]["executionTimeout"], 60)
        self.assertEqual(self.nodes["Every 5 minutes"]["parameters"]["rule"]["interval"], [{"field":"minutes","minutesInterval":5}])
        self.assertEqual(self.nodes["Read internal recovery feed"]["parameters"]["url"], "http://recovery-feed:8080/recovery.json")
        delivery = self.nodes["Deliver operation observation"]
        self.assertEqual(delivery["parameters"]["url"], "http://dashboard:3000/api/n8n/operations")
        self.assertEqual(delivery["credentials"]["httpHeaderAuth"]["id"], "DupdashDashboardIngest")
        self.assertEqual(delivery["maxTries"], 3)

    def test_valid_feed_is_strictly_projected_with_source_timestamp(self):
        generated = "2026-09-30T20:11:39.379721+00:00"
        output = self.project({"statusCode":200,"body":{"schemaVersion":1,"generatedAt":generated,"backupFolder":{"name":"Dupdash Backups","bytes":11996082,"objects":42,"measuredAt":generated},"restoreChecks":[{"checkedAt":generated,"requestedSnapshot":"a"*64,"ok":True,"checksumsVerified":10,"counts":{"credentials":8,"users":1,"workflows":11}}],"automation":{"measuredAt":generated,"workflows":[{"id":"DupdashRecoveryOperational","name":"Recovery","active":False}],"executionHistoryAvailable":False,"lastExecution":None,"failureCount24h":None}}})
        self.assertEqual(output["observedAt"], "2026-09-30T20:11:39.379Z")
        self.assertEqual(output["data"]["backupFolder"]["objects"], 42)
        self.assertEqual(set(output), {"surface","observedAt","status","data"})

    def test_503_and_network_failure_are_provider_unavailable(self):
        for value in ({"statusCode":503,"body":{"errorCode":"collection_failed"}}, {"error":{"message":"discard this"}}):
            output = self.project(value)
            self.assertEqual(output["errorCode"], "provider_unavailable")
            self.assertNotIn("discard", json.dumps(output))

    def test_invalid_success_is_error_not_zero(self):
        output = self.project({"statusCode":200,"body":{"schemaVersion":1,"generatedAt":"bad","backupFolder":{"name":"Dupdash Backups","bytes":None,"objects":0,"measuredAt":"bad"},"restoreChecks":[]}})
        self.assertEqual(output["status"], "error")
        self.assertEqual(output["errorCode"], "invalid_response")
        self.assertNotIn("data", output)

    def test_ai_usage_is_projected_and_invalid_usage_is_unavailable_without_losing_recovery(self):
        at = "2026-09-30T20:00:00.000Z"
        totals = {"calls": 1, "inputTokens": 1719, "outputTokens": 29, "estimatedCostUsd": 0.0003786}
        usage = {"status":"ok", "measuredAt":at, "trackingStartedAt":"2026-09-30T00:00:00Z", "windowStartedAt":"2026-09-30T00:00:00Z", "model":"gpt-5.6-luna", "currency":"USD", "monthKey":"2026-09", "today":totals.copy(), "month":totals.copy(), "window":totals.copy(), "reservedMonthUsd":0.00189175, "limits":{"perRunUsd":0.05,"perDayUsd":0.2,"perMonthUsd":2}, "daily":[{"date":"2026-09-30",**totals}], "unresolvedCalls":0}
        body = {"schemaVersion":1,"generatedAt":at,"backupFolder":{"name":"Dupdash Backups","bytes":12,"objects":1,"measuredAt":at},"restoreChecks":[],"automation":{"measuredAt":at,"workflows":[],"executionHistoryAvailable":False,"lastExecution":None,"failureCount24h":None,"aiUsage":usage}}
        result = self.project({"statusCode":200,"body":body})
        self.assertEqual(result["status"], "ok")
        self.assertEqual(result["data"]["automation"]["aiUsage"], usage)
        usage["secret"] = "must-not-cross-boundary"
        result = self.project({"statusCode":200,"body":body})
        self.assertEqual(result["status"], "ok")
        self.assertEqual(result["data"]["automation"]["aiUsage"]["status"], "unavailable")
        self.assertNotIn("must-not-cross-boundary", json.dumps(result))

    def test_backup_catalog_is_strictly_projected(self):
        at = "2026-10-01T18:00:00Z"
        library = lambda identifier: {"id":identifier,"name":identifier,"mode":"active-sync","setup":"not-initialized","eligibleForSync":True,"phase":"idle","summary":"Awaiting setup.","destinations":[]}
        catalog = {"schemaVersion":1,"generatedAt":at,"libraries":[library("dashboard-n8n"),library("example-app-source")]}
        body = {"schemaVersion":1,"generatedAt":at,"backupFolder":{"name":"Dupdash Backups","bytes":12,"objects":1,"measuredAt":at},"restoreChecks":[],"automation":{"measuredAt":at,"workflows":[],"executionHistoryAvailable":False,"lastExecution":None,"failureCount24h":None},"backupCatalog":catalog}
        result = self.project({"statusCode":200,"body":body})
        self.assertEqual([item["id"] for item in result["data"]["backupCatalog"]["libraries"]], ["dashboard-n8n","example-app-source"])
        body["backupCatalog"]["privatePath"] = "/secret"
        self.assertEqual(self.project({"statusCode":200,"body":body})["errorCode"], "invalid_response")

if __name__ == "__main__": unittest.main()
