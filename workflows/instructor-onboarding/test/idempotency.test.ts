import "./block-network.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { parseAirtableRecord } from "../src/airtable/parse-record.ts";
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
  assert.equal(second.employee.action, "skip-email");
  assert.equal(second.employee.created, false);
  assert.equal(second.employee.employeeId, first.employee.employeeId);
  assert.equal(fake.employees.length, 1);
  assert.equal(fake.calls.filter((call) => call.method === "createEmployee").length, 1);
  assert.equal(employeeIdempotencyKey("recInstructor001"), "instructor-onboarding:recInstructor001:employee");
  assert.equal(fake.employees[0]?.payload?.FirstName, "Avery");
  const again = await fake.ports.employees.createEmployee(
    first.employee.payload,
    employeeIdempotencyKey("recInstructor001"),
  );
  assert.equal(again.created, false);
  assert.equal(again.employeeId, first.employee.employeeId);
  assert.equal(fake.employees.length, 1);
});

test("an email already in Xero skips the create and does not look up by name", async () => {
  const { fake, deps } = runtime({
    employees: [{ employeeId: "emp-already", email: "Avery.Nguyen.Example@example.com", firstName: "Avery", lastName: "Nguyen" }],
  });
  const lines: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => {
    lines.push(args.map((item) => String(item)).join(" "));
  };
  try {
    const result = await runInstructorOnboarding(sampleAirtableRecord(), deps);
    assert.equal(result.employee.action, "skip-email");
    assert.equal(result.employee.created, false);
    assert.equal(result.employee.employeeId, "emp-already");
    assert.equal(result.contact.action, "skip-email");
    assert.equal(result.contact.created, false);
    assert.equal(result.employeeRead.checked, false);
    assert.equal(result.payTemplate.updated, false);
    assert.equal(result.slack.sent, false);
    assert.equal(result.email.sent, false);
    assert.equal(result.webhook.posted, false);
    assert.equal(fake.calls.some((call) => call.method === "findEmployeesByEmail"), true);
    assert.equal(fake.calls.some((call) => call.method === "findEmployeesByName"), false);
    assert.equal(fake.calls.some((call) => call.method === "findContactsByName"), false);
    assert.equal(fake.calls.some((call) => call.method === "createEmployee"), false);
    assert.equal(fake.calls.some((call) => call.method === "upsertContact"), false);
    assert.equal(fake.calls.some((call) => call.method === "getEmployee"), false);
    assert.equal(fake.calls.some((call) => call.method === "postMessage"), false);
    assert.equal(fake.calls.some((call) => call.method === "send"), false);
    assert.equal(fake.employees.length, 1);
    const skip = lines.find((line) => line.includes("xero-email-skip"));
    assert.equal(skip?.includes("emp-already"), true);
    assert.equal(skip?.includes("recInstructor001"), true);
    const record = parseAirtableRecord(sampleAirtableRecord());
    for (const secret of [record.tfn, record.account, record.bsb, record.abn, record.memberNumber]) {
      assert.equal(skip?.includes(secret), false, secret);
    }
  } finally {
    console.log = original;
  }
});

test("a second queue delivery with the same record id does not start a second workflow", async () => {
  const record = sampleAirtableRecord();
  const started: string[] = [];
  const start = async (id: string) => {
    if (started.includes(id)) throw new Error("Workflow instance already exists");
    started.push(id);
  };
  assert.equal((await startWorkflowForRecord(record, start)).result, "started");
  assert.equal((await startWorkflowForRecord(record, start)).result, "duplicate");
  assert.deepEqual(started, ["recInstructor001"]);
});
