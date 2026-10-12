import "./block-network.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { parseAirtableRecord } from "../src/airtable/parse-record.ts";
import { sampleAirtableRecord } from "../src/fixtures/sample-instructor.ts";
import { bearerMatches, dryRunEnabled, handleIntake, workflowInstanceId } from "../src/host/intake.ts";
import { startWorkflowForRecord } from "../src/host/queue-consumer.ts";
import { STEP_CONFIG } from "../src/host/step-config.ts";
import { runSafetyNet } from "../src/host/safety-net.ts";
import { lookupGender } from "../src/lookups/gender.ts";
import { lookupSuperFund } from "../src/lookups/super-funds.ts";
import { buildContactPayload } from "../src/mappings/contact.ts";
import { buildEmployeePayload } from "../src/mappings/employee.ts";
import { buildInstructorEmail } from "../src/messages/email.ts";
import { buildSlackMessage } from "../src/messages/slack.ts";
import { PIPELINE_STEPS, runInstructorOnboarding } from "../src/run.ts";
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

test("each pipeline step has its own retry settings", () => {
  assert.deepEqual(Object.keys(STEP_CONFIG), [...PIPELINE_STEPS]);
  assert.equal(STEP_CONFIG["airtable-record"].retries.limit, 0);
  assert.equal(STEP_CONFIG["super-fund"].retries.limit, 0);
  assert.equal(STEP_CONFIG.gender.retries.limit, 0);
  assert.equal(STEP_CONFIG["xero-employee"].retries.limit, 5);
  assert.equal(STEP_CONFIG["xero-employee-read"].retries.limit, 5);
  assert.equal(STEP_CONFIG["xero-employee-finalise"].retries.limit, 5);
  assert.equal(STEP_CONFIG["xero-employee-read"].timeout, "2 minutes");
  assert.equal(STEP_CONFIG["xero-contact"].retries.limit, 5);
  assert.equal(STEP_CONFIG["patty-webhook"].retries.limit, 5);
  assert.equal(STEP_CONFIG["patty-webhook"].timeout, "1 minute");
  assert.notEqual(STEP_CONFIG.slack.retries.delay, STEP_CONFIG["xero-employee"].retries.delay);
  assert.equal(STEP_CONFIG.email.retries.backoff, "exponential");
  const script = readFileSync(new URL("../airtable/on-record-created.js", import.meta.url), "utf8");
  assert.match(script, /Bearer \$\{ingressToken\}/);
  assert.match(script, /\/intake|workerUrl/);
});

test("DRY_RUN defaults on and uses a distinct instance id", async () => {
  assert.equal(dryRunEnabled(undefined), true);
  assert.equal(dryRunEnabled(""), true);
  assert.equal(dryRunEnabled("true"), true);
  assert.equal(dryRunEnabled("false"), false);
  const record = sampleAirtableRecord();
  assert.equal(workflowInstanceId(record.id, true), "recInstructor001-dry");
  assert.notEqual(workflowInstanceId(record.id, true), record.id);
  assert.equal(workflowInstanceId(record.id, false), record.id);
  const started: string[] = [];
  const start = async (id: string) => {
    if (started.includes(id)) throw new Error("Workflow instance already exists");
    started.push(id);
  };
  assert.equal(await startWorkflowForRecord(record, start, { dryRun: true }), "started");
  assert.equal(await startWorkflowForRecord(record, start, { dryRun: false }), "started");
  assert.deepEqual(started, ["recInstructor001-dry", "recInstructor001"]);
});

test("DRY_RUN returns the would-send payloads and does not write", async () => {
  const { fake, deps } = runtime();
  const raw = sampleAirtableRecord();
  const result = await runInstructorOnboarding(raw, { ...deps, mode: "shadow" });
  const record = parseAirtableRecord(raw);
  const expectedEmployee = buildEmployeePayload({
    record,
    genderCode: lookupGender(record.gender),
    superFundId: lookupSuperFund(record.superFund),
    payrollCalendarId: "cal-weekly",
    startDate: "2026-10-13",
  });
  assert.deepEqual(result.employee.payload, expectedEmployee);
  assert.equal(result.employee.created, false);
  assert.equal(result.employee.employeeId, null);
  assert.deepEqual(result.contact.payload, buildContactPayload(record));
  assert.equal(result.contact.created, false);
  assert.deepEqual(
    { channel: result.slack.channel, text: result.slack.text },
    buildSlackMessage({ record, employeeId: "{EmployeeID}", contactId: "{ContactID}", config: deps.config! }),
  );
  assert.equal(result.slack.sent, false);
  assert.deepEqual(result.email.message, buildInstructorEmail(record, deps.config!));
  assert.equal(result.email.sent, false);
  assert.equal(fake.calls.some((call) => call.method === "createEmployee"), false);
  assert.equal(fake.calls.some((call) => call.method === "upsertContact"), false);
  assert.equal(fake.calls.some((call) => call.method === "postMessage"), false);
  assert.equal(fake.calls.some((call) => call.method === "send"), false);
  assert.equal(fake.employees.length, 0);
  assert.equal(fake.contacts.length, 0);
  assert.equal(fake.slack.length, 0);
  assert.equal(fake.emails.length, 0);
});

test("dry-run ports refuse every external call", async () => {
  const { dryRunPorts } = await import("../src/host/dry-run-ports.ts");
  const ports = dryRunPorts();
  await assert.rejects(() => ports.employees.createEmployee({} as never, "key"), /DRY_RUN blocked employees.createEmployee/);
  await assert.rejects(() => ports.employees.getEmployee("employee-1"), /DRY_RUN blocked employees.getEmployee/);
  await assert.rejects(() => ports.employees.updatePayTemplate("employee-1", {} as never), /DRY_RUN blocked employees.updatePayTemplate/);
  await assert.rejects(() => ports.webhook.post({} as never), /DRY_RUN blocked webhook.post/);
  await assert.rejects(() => ports.contacts.upsertContact({} as never), /DRY_RUN blocked contacts.upsertContact/);
  await assert.rejects(() => ports.slack.postMessage({ channel: "C", text: "x" }), /DRY_RUN blocked slack.postMessage/);
  await assert.rejects(() => ports.email.send({} as never), /DRY_RUN blocked email.send/);
});
