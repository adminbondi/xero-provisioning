import "./block-network.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { parseAirtableRecord } from "../src/airtable/parse-record.ts";
import { sampleAirtableRecord } from "../src/fixtures/sample-instructor.ts";
import { runInstructorOnboarding } from "../src/run.ts";
import { runtime } from "./helpers.ts";

test("a name-only employee match is held and an email match on the contact skips without a name lookup", async () => {
  const named = runtime({
    employees: [{ employeeId: "emp-name", email: "other.person@example.com", firstName: "avery", lastName: "nguyen" }],
  });
  const held = await runInstructorOnboarding(sampleAirtableRecord(), {
    ...named.deps,
    config: { ...named.deps.config!, slackChannelId: "C-DRY-TEST" },
  });
  assert.equal(held.match.disposition, "hold-name");
  assert.equal(held.employee.employeeId, "emp-name");
  assert.equal(held.employee.created, false);
  assert.equal(named.fake.calls.some((call) => call.method === "createEmployee"), false);
  assert.equal(named.fake.slack[0]?.channel, "C-DRY-TEST");
  assert.equal(named.fake.calls.some((call) => call.method === "findEmployeesByName"), true);

  const emailed = runtime({
    contacts: [{ contactId: "con-mail", name: "Different Person", contactNumber: null, email: "avery.nguyen.example@example.com" }],
  });
  const skipped = await runInstructorOnboarding(sampleAirtableRecord(), emailed.deps);
  assert.equal(skipped.match.disposition, "skip-email");
  assert.equal(skipped.contact.contactId, "con-mail");
  assert.equal(skipped.employee.created, false);
  assert.equal(emailed.fake.calls.some((call) => call.method === "findContactsByName"), false);
  assert.equal(emailed.fake.calls.some((call) => call.method === "createEmployee"), false);
  const record = parseAirtableRecord(sampleAirtableRecord());
  const text = JSON.stringify(skipped.match);
  for (const secret of [record.tfn, record.account, record.bsb, record.abn, record.memberNumber]) {
    assert.equal(text.includes(secret), false);
  }
});

test("shadow mode does not look anyone up in Xero", async () => {
  const { fake, deps } = runtime({
    employees: [{ employeeId: "emp-already", email: "avery.nguyen.example@example.com", firstName: "Avery", lastName: "Nguyen" }],
  });
  const result = await runInstructorOnboarding(sampleAirtableRecord(), { ...deps, mode: "shadow" });
  assert.equal(result.match.disposition, "create");
  assert.equal(result.match.reason, "dry-run");
  assert.equal(fake.calls.length, 0);
  assert.equal(result.employee.created, false);
});
