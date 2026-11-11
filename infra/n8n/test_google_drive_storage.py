import json
import subprocess
import unittest
from pathlib import Path


ROOT = Path(__file__).parent
WORKFLOW = ROOT / "workflows/providers/google-drive-storage.json"


class GoogleDriveStorageWorkflowTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.workflow = json.loads(WORKFLOW.read_text(encoding="utf-8"))
        cls.nodes = {node["name"]: node for node in cls.workflow["nodes"]}

    def normalize(self, value):
        source = self.nodes["Sanitize storage observation"]["parameters"]["jsCode"]
        harness = (
            "const vm=require('node:vm');"
            "const src=JSON.parse(process.argv[1]);"
            "const input=JSON.parse(process.argv[2]);"
            "const out=vm.runInNewContext(`(()=>{${src}})()`,{$json:input,Date});"
            "process.stdout.write(JSON.stringify(out[0].json));"
        )
        result = subprocess.run(
            ["node", "-e", harness, json.dumps(source), json.dumps(value)],
            text=True, capture_output=True, check=True,
        )
        return json.loads(result.stdout)

    def test_contract_and_safety_settings(self):
        self.assertFalse(self.workflow["active"])
        self.assertEqual(self.workflow["id"], "SecDashGoogleDriveStorage")
        self.assertEqual(self.workflow["settings"]["saveDataSuccessExecution"], "none")
        self.assertEqual(self.workflow["settings"]["saveDataErrorExecution"], "none")
        self.assertFalse(self.workflow["settings"]["saveManualExecutions"])
        trigger = self.nodes["Every 5 minutes"]
        self.assertEqual(trigger["parameters"]["rule"]["interval"], [{"field": "minutes", "minutesInterval": 5}])
        request = self.nodes["Read Drive storage quota"]
        self.assertEqual(request["parameters"]["url"], "https://drive.secdash.invalid/drive/v3/about")
        self.assertEqual(request["parameters"]["queryParameters"]["parameters"], [{"name": "fields", "value": "storageQuota"}])
        self.assertEqual(request["credentials"]["httpHeaderAuth"]["id"], "SecDashGoogleDriveStorage")
        delivery = self.nodes["Deliver storage observation"]
        self.assertEqual(delivery["parameters"]["url"], "http://dashboard:3000/api/n8n/drive-storage")
        self.assertEqual(delivery["credentials"]["httpHeaderAuth"]["id"], "SecDashDashboardIngest")

    def test_valid_quota_is_sanitized(self):
        output = self.normalize({"statusCode": 200, "body": {"storageQuota": {
            "limit": "9007199254740991", "usage": "20", "usageInDrive": "12", "usageInDriveTrash": "8",
            "unrelated": "discard-me",
        }}})
        self.assertEqual(set(output), {"provider", "observedAt", "status", "quota"})
        self.assertEqual(output["provider"], "google-drive")
        self.assertEqual(output["status"], "ok")
        self.assertEqual(output["quota"], {"limitBytes": "9007199254740991", "usedBytes": "20", "driveBytes": "12", "trashBytes": "8"})

    def test_missing_limit_is_null(self):
        output = self.normalize({"statusCode": 200, "body": {"storageQuota": {
            "usage": "20", "usageInDrive": "12", "usageInDriveTrash": "8",
        }}})
        self.assertIsNone(output["quota"]["limitBytes"])

    def test_invalid_values_do_not_become_fake_zeroes(self):
        for value in ("01", "-1", "9007199254740992", 12, None):
            output = self.normalize({"statusCode": 200, "body": {"storageQuota": {
                "limit": "100", "usage": value, "usageInDrive": "12", "usageInDriveTrash": "8",
            }}})
            self.assertEqual(output["status"], "error")
            self.assertEqual(output["errorCode"], "invalid_response")
            self.assertNotIn("quota", output)

    def test_error_mapping_is_sanitized(self):
        cases = [(401, "authorization_required"), (403, "authorization_required"),
                 (429, "provider_unavailable"), (500, "provider_unavailable"),
                 (404, "invalid_response")]
        for status, expected in cases:
            with self.subTest(status=status):
                output = self.normalize({"statusCode": status, "body": {"secret": "discard-me"}})
                self.assertEqual(set(output), {"provider", "observedAt", "status", "errorCode"})
                self.assertEqual(output["errorCode"], expected)

    def test_network_failure_is_provider_unavailable(self):
        output = self.normalize({"error": {"message": "sensitive upstream failure"}})
        self.assertEqual(output["errorCode"], "provider_unavailable")
        self.assertNotIn("sensitive", json.dumps(output))

    def test_refresh_authorization_failure_is_authorization_required(self):
        output = self.normalize({"error": {"message": "OAuth refresh failed: invalid_grant"}})
        self.assertEqual(output["errorCode"], "authorization_required")
        self.assertNotIn("invalid_grant", json.dumps(output))


if __name__ == "__main__":
    unittest.main()
