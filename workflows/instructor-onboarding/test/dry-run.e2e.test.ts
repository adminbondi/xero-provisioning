/**
 * DRY RUN end-to-end.
 * Exercises Zap steps 1–7 against in-memory fakes only.
 * Does not call Xero, Slack, Gmail, Airtable, or any network.
 */
import "./block-network.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { sampleAirtableRecord } from "../src/fixtures/sample-instructor.ts";
import { PIPELINE_STEPS, runInstructorOnboarding } from "../src/run.ts";
import { runtime } from "./helpers.ts";

test("dry run exercises steps 1-7 against fakes", async () => {
  const { fake, deps } = runtime();
  const result = await runInstructorOnboarding(sampleAirtableRecord(), deps);

  assert.deepEqual(result.steps, [...PIPELINE_STEPS]);
  assert.equal(result.ok, true);
  assert.equal(result.flags.includes("possible-missing-code-step"), false);
  assert.ok(result.flags.includes("contact-mobile-plus61-prefix"));
  assert.ok(result.flags.includes("employee-state-hardcoded-nsw"));
  assert.ok(result.flags.includes("contact-bank-bsb-concat"));
  assert.ok(result.flags.includes("start-date-zapier-expression"));
  assert.equal(result.flags.includes("gender-not-stated-empty"), false);

  assert.equal(result.superFundId, "4caabd49-1d08-4d8b-958b-d933a113e9c9");
  assert.equal(result.genderCode, "F");
  assert.equal(result.startDate.resolved, "2026-10-13");
  assert.equal(result.startDate.zapierExpression, "{{=)}}");

  assert.equal(result.employee.created, true);
  assert.equal(result.employee.payload.HomeAddress.Region, "NSW");
  assert.equal(result.employee.payload.IncomeType, null);
  assert.equal(result.employee.payload.BankAccounts.length, 0);
  assert.equal(result.contact.created, true);
  assert.equal(result.contact.payload.Addresses[0]?.Region, "VIC");
  assert.equal(result.contact.payload.BankAccountDetails, "06200090817263");
  assert.equal(result.contact.payload.Phones[0]?.PhoneNumber, "+610412345678");
  assert.equal(result.slack.sent, true);
  assert.equal(result.slack.channel, "C09BK6Y2WHL");
  assert.match(result.slack.text, /has successfully been created in Xero/);
  assert.match(result.slack.text, /https:\/\/go\.xero\.com\/app\/!hGL34\/payroll\/employee\/employee-1\/details/);
  assert.equal(result.email.sent, true);
  assert.equal(result.email.message.from, "admin@balancemoves.com.au");
  assert.equal(result.email.message.subject, "Instructor Onboarding: Please Confirm Your Details");

  assert.deepEqual(
    fake.calls.map((call) => `${call.port}.${call.method}`),
    ["employees.createEmployee", "contacts.upsertContact", "slack.postMessage", "email.send"],
  );
  assert.equal(fake.employees.length, 1);
  assert.equal(fake.contacts.length, 1);
  assert.equal(fake.slack.length, 1);
  assert.equal(fake.emails.length, 1);

  const shadow = runtime();
  const preview = await runInstructorOnboarding(sampleAirtableRecord(), { ...shadow.deps, mode: "shadow" });
  assert.equal(preview.employee.employeeId, null);
  assert.equal(preview.employee.created, false);
  assert.equal(preview.contact.contactId, null);
  assert.equal(preview.slack.sent, false);
  assert.equal(preview.email.sent, false);
  assert.equal(shadow.fake.employees.length, 0);
  assert.equal(shadow.fake.contacts.length, 0);
  assert.equal(shadow.fake.slack.length, 0);
  assert.equal(shadow.fake.emails.length, 0);
  assert.equal(shadow.fake.calls.some((call) => call.method === "createEmployee"), false);
  assert.equal(shadow.fake.calls.some((call) => call.method === "upsertContact"), false);
  assert.equal(shadow.fake.calls.length, 0);
});
