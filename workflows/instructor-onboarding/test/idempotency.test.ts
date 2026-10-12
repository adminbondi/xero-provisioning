import "./block-network.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { AmbiguousContactError, AmbiguousEmployeeError } from "../src/errors.ts";
import { sampleAirtableRecord } from "../src/fixtures/sample-instructor.ts";
import { runInstructorOnboarding } from "../src/run.ts";
import { runtime, withFields } from "./helpers.ts";

test("running the same Airtable record twice does not create a second employee or contact", async () => {
  const { fake, deps } = runtime();
  const first = await runInstructorOnboarding(sampleAirtableRecord(), deps);
  const second = await runInstructorOnboarding(sampleAirtableRecord(), deps);
  assert.equal(first.employee.created, true);
  assert.equal(first.contact.created, true);
  assert.equal(second.employee.created, false);
  assert.equal(second.employee.action, "reuse");
  assert.equal(second.employee.employeeId, first.employee.employeeId);
  assert.equal(second.contact.created, false);
  assert.equal(second.contact.action, "update");
  assert.equal(second.contact.contactId, first.contact.contactId);
  assert.equal(fake.employees.length, 1);
  assert.equal(fake.contacts.length, 1);
  assert.equal(fake.slack.length, 1);
  assert.equal(fake.emails.length, 1);
  assert.equal(fake.calls.filter((call) => call.method === "createEmployee").length, 1);
  assert.equal(second.slack.sent, false);
  assert.equal(second.email.sent, false);
});

test("a repeated create with the same idempotency key is swallowed by the employee port", async () => {
  const { fake } = runtime();
  const record = (await import("../src/airtable/parse-record.ts")).parseAirtableRecord(sampleAirtableRecord());
  const { buildEmployeePayload, employeeIdempotencyKey } = await import("../src/mappings/employee.ts");
  const payload = buildEmployeePayload({
    record,
    genderCode: "F",
    superFundId: "4caabd49-1d08-4d8b-958b-d933a113e9c9",
    payrollCalendarId: "cal-weekly",
    startDate: "2026-10-13",
  });
  const key = employeeIdempotencyKey(record.recordId);
  const created = await fake.ports.employees.createEmployee(payload, key);
  const again = await fake.ports.employees.createEmployee(payload, key);
  assert.equal(created.created, true);
  assert.equal(again.created, false);
  assert.equal(again.employeeId, created.employeeId);
  assert.equal(fake.employees.length, 1);
});

test("an existing employee email is reused and the employee is not patched", async () => {
  const { fake, deps } = runtime({
    employees: [{ employeeId: "emp-already", email: "Avery.Nguyen.Example@example.com" }],
  });
  const result = await runInstructorOnboarding(sampleAirtableRecord(), deps);
  assert.equal(result.employee.action, "reuse");
  assert.equal(result.employee.created, false);
  assert.equal(result.employee.employeeId, "emp-already");
  assert.equal(fake.calls.filter((call) => call.method === "createEmployee").length, 0);
  assert.equal(fake.employees[0]?.payload, null);

  const renamed = withFields({ "First Name": "Renamed" });
  renamed.id = "recInstructor001";
  const second = await runInstructorOnboarding(renamed, deps);
  assert.equal(second.employee.action, "reuse");
  assert.equal(second.employee.payload.FirstName, "Renamed");
  assert.equal(fake.calls.filter((call) => call.method === "createEmployee").length, 0);
  assert.equal(fake.employees.length, 1);
  assert.equal(fake.contacts.length, 1);
});

test("two employees with the same email are not guessed between", async () => {
  const { fake, deps } = runtime({
    employees: [
      { employeeId: "emp-a", email: "avery.nguyen.example@example.com" },
      { employeeId: "emp-b", email: "avery.nguyen.example@example.com" },
    ],
  });
  await assert.rejects(() => runInstructorOnboarding(sampleAirtableRecord(), deps), AmbiguousEmployeeError);
  assert.equal(fake.calls.filter((call) => call.method === "createEmployee").length, 0);
  assert.equal(fake.contacts.length, 0);
  assert.equal(fake.slack.length, 0);
});

test("two contacts with the same name are not guessed between", async () => {
  const { fake, deps } = runtime({
    contacts: [
      { contactId: "c1", name: "Avery Nguyen", contactNumber: null },
      { contactId: "c2", name: "Avery Nguyen", contactNumber: null },
    ],
  });
  await assert.rejects(() => runInstructorOnboarding(sampleAirtableRecord(), deps), AmbiguousContactError);
  assert.equal(fake.contacts.length, 2);
  assert.equal(fake.slack.length, 0);
  assert.equal(fake.employees.length, 1);
});

test("a failed contact upsert retries without a second employee, then sends Slack and email once", async () => {
  const { fake, deps } = runtime({ failUpsertContact: 1 });
  await assert.rejects(() => runInstructorOnboarding(sampleAirtableRecord(), deps), /forced contact failure/);
  assert.equal(fake.employees.length, 1);
  assert.equal(fake.contacts.length, 0);
  assert.equal(fake.slack.length, 0);
  const second = await runInstructorOnboarding(sampleAirtableRecord(), deps);
  assert.equal(fake.employees.length, 1);
  assert.equal(fake.calls.filter((call) => call.method === "createEmployee").length, 1);
  assert.equal(fake.contacts.length, 1);
  assert.equal(second.employee.created, false);
  assert.equal(second.contact.created, true);
  assert.equal(second.slack.sent, true);
  assert.equal(second.email.sent, true);
  assert.equal(fake.slack.length, 1);
  assert.equal(fake.emails.length, 1);
});
