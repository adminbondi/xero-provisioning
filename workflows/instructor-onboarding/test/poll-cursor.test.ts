import "./block-network.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { sampleAirtableRecord } from "../src/fixtures/sample-instructor.ts";
import { runPollTick } from "../src/poll.ts";
import type { AirtableApiRecord } from "../src/types.ts";
import { runtime, withFields } from "./helpers.ts";

function at(id: string, createdTime: string, remove: string[] = []): AirtableApiRecord {
  const record = remove.length > 0 ? withFields({}, remove) : sampleAirtableRecord();
  record.id = id;
  record.createdTime = createdTime;
  return record;
}

test("the cursor admits only records created after it, and a finished record is not processed again", async () => {
  const older = at("rec-old", "2026-10-01T00:00:00.000Z");
  const newer = at("rec-new", "2026-10-12T03:00:00.000Z");
  const { fake, store, deps } = runtime({ airtableRecords: [older, newer] });
  await store.setCursor({ createdAfter: "2026-10-12T00:00:00.000Z" });

  const first = await runPollTick(deps);
  assert.deepEqual(
    first.results.map((item) => item.recordId),
    ["rec-new"],
  );
  assert.equal(first.results[0]?.status, "processed");
  assert.equal(fake.employees.length, 1);

  const second = await runPollTick(deps);
  assert.equal(second.results[0]?.status, "skipped");
  assert.equal(fake.employees.length, 1);
  assert.equal(fake.calls.filter((call) => call.method === "createEmployee").length, 1);
});

test("a record that fails validation stays incomplete and is tried again", async () => {
  const broken = at("rec-broken", "2026-10-12T03:00:00.000Z", ["Email"]);
  const { fake, store, deps } = runtime({ airtableRecords: [broken] });
  await store.setCursor({ createdAfter: "2026-10-01T00:00:00.000Z" });
  const first = await runPollTick(deps);
  const second = await runPollTick(deps);
  assert.equal(first.results[0]?.status, "failed");
  assert.equal(second.results[0]?.status, "failed");
  assert.ok(first.results[0]?.error?.fields?.includes("Email"));
  assert.equal(fake.employees.length, 0);
});

test("the cursor setter rejects a date that is not a timestamp", async () => {
  const { store } = runtime();
  await assert.rejects(() => store.setCursor({ createdAfter: "yesterday" }), /ISO-8601/);
});
