import "./block-network.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { sampleAirtableRecord } from "../src/fixtures/sample-instructor.ts";
import { employeeIdempotencyKey } from "../src/mappings/employee.ts";
import { runInstructorOnboarding } from "../src/run.ts";
import { startWorkflowForRecord } from "../src/host/queue-consumer.ts";
import { runtime } from "./helpers.ts";

test("a failed contact step retries without repeating the employee call or sending Slack twice", async () => {
  const { fake, deps } = runtime({ failUpsertContact: 1 });
  const stepCache = new Map<string, unknown>();
  await assert.rejects(
    () => runInstructorOnboarding(sampleAirtableRecord(), { ...deps, stepCache }),
    /forced contact failure/,
  );
  assert.equal(fake.employees.length, 1);
  assert.equal(fake.contacts.length, 0);
  assert.equal(fake.slack.length, 0);
  assert.equal(fake.calls.filter((call) => call.method === "createEmployee").length, 1);

  const second = await runInstructorOnboarding(sampleAirtableRecord(), { ...deps, stepCache });
  assert.equal(fake.calls.filter((call) => call.method === "createEmployee").length, 1);
  assert.equal(fake.contacts.length, 1);
  assert.equal(second.employee.created, true);
  assert.equal(second.contact.created, true);
  assert.equal(second.slack.sent, true);
  assert.equal(second.email.sent, true);
  assert.equal(fake.slack.length, 1);
  assert.equal(fake.emails.length, 1);
});

test("a repeated employee create with the same idempotency key does not insert a second employee", async () => {
  const { fake, deps } = runtime();
  const first = await runInstructorOnboarding(sampleAirtableRecord(), deps);
  const second = await runInstructorOnboarding(sampleAirtableRecord(), deps);
  assert.equal(first.employee.created, true);
  assert.equal(second.employee.created, false);
  assert.equal(second.employee.action, "reuse");
  assert.equal(second.employee.employeeId, first.employee.employeeId);
  assert.equal(fake.employees.length, 1);
  assert.equal(employeeIdempotencyKey("recInstructor001"), "instructor-onboarding:recInstructor001:employee");
  assert.equal(fake.employees[0]?.payload?.FirstName, "Avery");
});

test("the employee step does not scan Xero by email", async () => {
  const { fake, deps } = runtime({
    employees: [{ employeeId: "emp-already", email: "Avery.Nguyen.Example@example.com" }],
  });
  const result = await runInstructorOnboarding(sampleAirtableRecord(), deps);
  assert.equal(fake.calls.some((call) => call.method === "findEmployeesByEmail"), false);
  assert.equal(result.employee.created, true);
  assert.notEqual(result.employee.employeeId, "emp-already");
});

test("a second queue delivery with the same record id does not start a second workflow", async () => {
  const record = sampleAirtableRecord();
  const started: string[] = [];
  const start = async (id: string) => {
    if (started.includes(id)) throw new Error("Workflow instance already exists");
    started.push(id);
  };
  assert.equal(await startWorkflowForRecord(record, start), "started");
  assert.equal(await startWorkflowForRecord(record, start), "duplicate");
  assert.deepEqual(started, ["recInstructor001"]);
});
