import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  backupAttentionRevision,
  feedAttentionRevision,
  readAttentionDismissals,
  storeAttentionDismissal,
  visibleAttention,
} from "../lib/attention.ts";
import { SQLiteDatabase } from "../db/index.ts";

test("one notification can be dismissed without hiding another", () => {
  const items = [
    { identity: "feedback-obstruction:one", conditionRevision: "revision-one", title: "One" },
    { identity: "feedback-obstruction:two", conditionRevision: "revision-two", title: "Two" },
  ];
  const visible = visibleAttention(items, [{
    identity: "feedback-obstruction:one",
    conditionRevision: "revision-one",
    dismissedAt: "2026-10-17T12:00:00.000Z",
  }]);
  assert.deepEqual(visible.map(item => item.identity), ["feedback-obstruction:two"]);
});

test("dismissals persist across database reopen while changed and new conditions surface", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "dupdash-attention-"));
  const path = join(directory, "dashboard.sqlite");
  t.after(() => rmSync(directory, { recursive: true, force: true }));

  let db = new SQLiteDatabase(path);
  await storeAttentionDismissal(db, {
    identity: "feedback-obstruction:one",
    conditionRevision: "source-a:analysis-a",
  }, "2026-10-17T12:00:00.000Z");
  db.close();

  db = new SQLiteDatabase(path);
  t.after(() => db.close());
  const persisted = await readAttentionDismissals(db);
  assert.deepEqual(persisted, [{
    identity: "feedback-obstruction:one",
    conditionRevision: "source-a:analysis-a",
    dismissedAt: "2026-10-17T12:00:00.000Z",
  }]);

  const candidates = [
    { identity: "feedback-obstruction:one", conditionRevision: "source-a:analysis-a" },
    { identity: "feedback-obstruction:two", conditionRevision: "source-b:analysis-b" },
  ];
  assert.deepEqual(visibleAttention(candidates, persisted), [candidates[1]]);

  const changed = { identity: "feedback-obstruction:one", conditionRevision: "source-a:analysis-new" };
  assert.deepEqual(visibleAttention([changed], persisted), [changed]);
});

test("routine refreshes of an identical failure stay dismissed while semantic changes surface", () => {
  const firstPollAt = "2026-10-17T12:00:00.000Z";
  const refreshedPollAt = "2026-10-17T12:15:00.000Z";
  assert.notEqual(firstPollAt, refreshedPollAt);

  const firstRevision = feedAttentionRevision("error", "provider_unavailable");
  const refreshedRevision = feedAttentionRevision("error", "provider_unavailable");
  const dismissal = [{ identity: "feed:cloudflare", conditionRevision: firstRevision, dismissedAt: firstPollAt }];
  assert.deepEqual(visibleAttention([{ identity: "feed:cloudflare", conditionRevision: refreshedRevision }], dismissal), []);

  const changedFailure = { identity: "feed:cloudflare", conditionRevision: feedAttentionRevision("error", "authorization_required") };
  assert.deepEqual(visibleAttention([changedFailure], dismissal), [changedFailure]);

  const backupPollOne = backupAttentionRevision({ sourceStatus: "error", sourceDetail: "Recovery collection failed.", updateState: "idle" });
  const backupPollTwo = backupAttentionRevision({ sourceStatus: "error", sourceDetail: "Recovery collection failed.", updateState: "idle" });
  assert.equal(backupPollOne, backupPollTwo);
  assert.notEqual(backupPollOne, backupAttentionRevision({ sourceStatus: "error", sourceDetail: "Recovery collection failed.", updateState: "failed", updateJobId: "job-2" }));
});
