import "./block-network.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { sampleAirtableRecord } from "../src/fixtures/sample-instructor.ts";
import { STEP_CONFIG } from "../src/host/step-config.ts";
import { bearerMatches, handleIntake } from "../src/host/intake.ts";
import { runSafetyNet } from "../src/host/safety-net.ts";
import { PIPELINE_STEPS } from "../src/run.ts";
import { runtime } from "./helpers.ts";

test("intake accepts a bearer token and enqueues the record", async () => {
  const record = sampleAirtableRecord();
  const queued: unknown[] = [];
  const response = await handleIntake(
    new Request("https://worker.example/intake", {
      method: "POST",
      headers: { authorization: "Bearer studio-token", "content-type": "application/json" },
      body: JSON.stringify(record),
    }),
    {
      ingressToken: "studio-token",
      enqueue: async (item) => {
        queued.push(item);
      },
    },
  );
  assert.equal(response.status, 202);
  assert.deepEqual(queued, [record]);
  assert.equal(await bearerMatches("Bearer studio-token", "studio-token"), true);
  assert.equal(await bearerMatches("Bearer wrong", "studio-token"), false);
  assert.equal(await bearerMatches(null, ""), false);
});

test("intake rejects a bad token, a bad body, and a non-POST", async () => {
  const enqueue = async () => {
    throw new Error("should not enqueue");
  };
  const denied = await handleIntake(
    new Request("https://worker.example/intake", {
      method: "POST",
      headers: { authorization: "Bearer wrong", "content-type": "application/json" },
      body: JSON.stringify(sampleAirtableRecord()),
    }),
    { ingressToken: "studio-token", enqueue },
  );
  assert.equal(denied.status, 401);

  const unconfigured = await handleIntake(
    new Request("https://worker.example/intake", { method: "POST", body: "{}" }),
    { ingressToken: "", enqueue },
  );
  assert.equal(unconfigured.status, 503);

  const badId = await handleIntake(
    new Request("https://worker.example/intake", {
      method: "POST",
      headers: { authorization: "Bearer studio-token", "content-type": "application/json" },
      body: JSON.stringify({ id: "rec has spaces", fields: {} }),
    }),
    { ingressToken: "studio-token", enqueue },
  );
  assert.equal(badId.status, 400);

  const get = await handleIntake(new Request("https://worker.example/intake"), {
    ingressToken: "studio-token",
    enqueue,
  });
  assert.equal(get.status, 405);
});

test("the safety net enqueues only rows after the cutoff that have no workflow", async () => {
  const older = sampleAirtableRecord();
  older.id = "recOlder00000001";
  older.createdTime = "2026-09-01T00:00:00.000Z";
  const started = sampleAirtableRecord();
  started.id = "recStarted000001";
  started.createdTime = "2026-10-12T00:00:00.000Z";
  const missing = sampleAirtableRecord();
  missing.id = "recMissing000001";
  missing.createdTime = "2026-10-12T02:00:00.000Z";
  const { fake } = runtime({ airtableRecords: [older, started, missing] });
  const enqueued: string[] = [];
  const result = await runSafetyNet({
    airtable: fake.ports.airtable,
    notBefore: "2026-10-01T00:00:00.000Z",
    hasWorkflow: async (recordId) => recordId === "recStarted000001",
    enqueue: async (record) => {
      enqueued.push(record.id);
    },
  });
  assert.equal(result.blocked, false);
  assert.deepEqual(enqueued, ["recMissing000001"]);
  assert.equal(fake.calls.some((call) => call.method === "createEmployee"), false);
  assert.equal(fake.calls.some((call) => call.port === "contacts"), false);
});

test("each of the seven steps has its own retry settings", () => {
  assert.deepEqual(Object.keys(STEP_CONFIG), [...PIPELINE_STEPS]);
  assert.equal(STEP_CONFIG["airtable-record"].retries.limit, 0);
  assert.equal(STEP_CONFIG["super-fund"].retries.limit, 0);
  assert.equal(STEP_CONFIG.gender.retries.limit, 0);
  assert.equal(STEP_CONFIG["xero-employee"].retries.limit, 5);
  assert.equal(STEP_CONFIG["xero-contact"].retries.limit, 5);
  assert.notEqual(STEP_CONFIG.slack.retries.delay, STEP_CONFIG["xero-employee"].retries.delay);
  assert.equal(STEP_CONFIG.email.retries.backoff, "exponential");
  const script = readFileSync(new URL("../airtable/on-record-created.js", import.meta.url), "utf8");
  assert.match(script, /Bearer \$\{ingressToken\}/);
  assert.match(script, /\/intake|workerUrl/);
});
