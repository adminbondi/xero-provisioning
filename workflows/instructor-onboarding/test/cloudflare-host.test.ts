import "./block-network.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { parseAirtableRecord } from "../src/airtable/parse-record.ts";
import { sampleAirtableRecord } from "../src/fixtures/sample-instructor.ts";
import { bearerMatches, dryRunEnabled, handleIntake, workflowInstanceId } from "../src/host/intake.ts";
import { startWorkflowForRecord } from "../src/host/queue-consumer.ts";
import { STEP_CONFIG } from "../src/host/step-config.ts";
import { lookupGender } from "../src/lookups/gender.ts";
import { lookupSuperFund } from "../src/lookups/super-funds.ts";
import { buildContactPayload } from "../src/mappings/contact.ts";
import { buildEmployeePayload } from "../src/mappings/employee.ts";
import { buildInstructorEmail } from "../src/messages/email.ts";
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
  assert.equal((await startWorkflowForRecord(record, start, { dryRun: true })).result, "started");
  assert.equal((await startWorkflowForRecord(record, start, { dryRun: false })).result, "started");
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
  assert.equal(result.slack.channel, deps.config!.slackChannelId);
  assert.match(result.slack.text, /Onboarding needs attention/);
  assert.match(result.slack.text, /MISSING Emergency contact/);
  assert.equal(result.slack.text.includes(record.tfn), false);
  assert.equal(result.slack.sent, false);
  const liveEmail = buildInstructorEmail(record, deps.config!);
  assert.equal(result.email.message.from, liveEmail.from);
  assert.equal(result.email.message.to, liveEmail.to);
  assert.equal(result.email.message.subject, liveEmail.subject);
  assert.equal(result.email.message.html.includes(record.abn), false);
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
  await assert.rejects(() => ports.employees.findEmployeesByEmail("a@example.com"), /DRY_RUN blocked employees.findEmployeesByEmail/);
  await assert.rejects(() => ports.employees.findEmployeesByName("A", "B"), /DRY_RUN blocked employees.findEmployeesByName/);
  await assert.rejects(() => ports.contacts.findContactsByEmail("a@example.com"), /DRY_RUN blocked contacts.findContactsByEmail/);
  await assert.rejects(() => ports.employees.createEmployee({} as never, "key"), /DRY_RUN blocked employees.createEmployee/);
  await assert.rejects(() => ports.employees.getEmployee("employee-1"), /DRY_RUN blocked employees.getEmployee/);
  await assert.rejects(() => ports.employees.updatePayTemplate("employee-1", {} as never), /DRY_RUN blocked employees.updatePayTemplate/);
  await assert.rejects(() => ports.webhook.post({} as never), /DRY_RUN blocked webhook.post/);
  await assert.rejects(() => ports.contacts.upsertContact({} as never), /DRY_RUN blocked contacts.upsertContact/);
  await assert.rejects(() => ports.contacts.getContact("contact-1"), /DRY_RUN blocked contacts.getContact/);
  await assert.rejects(() => ports.slack.postMessage({ channel: "C", text: "x" }), /DRY_RUN blocked slack.postMessage/);
  await assert.rejects(() => ports.email.send({} as never), /DRY_RUN blocked email.send/);
});
