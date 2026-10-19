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
  assert.equal(result.employee.payload.IncomeType, "NONEMPLOYEE");
  assert.equal(result.employee.payload.TaxDeclaration.ABN, "12345678901");
  assert.equal(result.contact.payload.AccountsPayableTaxType, "INPUT");
  assert.equal(result.contact.payload.TaxNumber, "12345678901");
  assert.equal(result.employeeRead.genderUnset, false);
  assert.equal(result.employeeRead.incomeTypeUnset, false);
  assert.equal(result.employeeRead.incomeType, "NONEMPLOYEE");
  assert.equal(result.payTemplate.updated, true);
  assert.equal(result.payTemplate.template.EarningsLines.length, 0);
  assert.equal(result.payTemplate.template.LeaveLines.length, 0);
  assert.equal(result.payTemplate.template.SuperLines.length, 1);
  assert.equal(result.webhook.posted, true);
  assert.equal(result.webhook.payload.emergencyContactName, "Sam Nguyen");
  assert.equal(result.employee.payload.BankAccounts.length, 0);
  assert.equal(result.contact.created, true);
  assert.equal(result.contact.payload.Addresses[0]?.Region, "VIC");
  assert.equal(result.contact.payload.BankAccountDetails, "06200090817263");
  assert.equal(result.contact.payload.Phones[0]?.PhoneNumber, "+610412345678");
  assert.equal(result.slack.sent, true);
  assert.equal(result.slack.channel, "C09BK6Y2WHL");
  assert.match(result.slack.text, /has been fully onboarded in Xero/);
  assert.match(result.slack.text, /PASS Mobile/);
  assert.match(result.slack.text, /PASS Default purchase account/);
  assert.equal(result.slack.text.includes("MISSING"), false);
  assert.equal(result.slack.text.includes("Emergency contact"), false);
  assert.match(result.slack.text, /https:\/\/go\.xero\.com\/app\/!hGL34\/payroll\/employee\/employee-1\/details/);
  assert.equal(result.email.sent, true);
  assert.equal(result.email.message.from, "admin@balancemoves.com.au");
  assert.equal(result.email.message.subject, "Instructor Onboarding: Please Confirm Your Details");

  assert.deepEqual(
    fake.calls.map((call) => `${call.port}.${call.method}`),
    [
      "employees.findEmployeesByEmail",
      "contacts.findContactsByEmail",
      "employees.findEmployeesByName",
      "contacts.findContactsByName",
      "employees.createEmployee",
      "employees.getEmployee",
      "employees.updatePayTemplate",
      "contacts.upsertContact",
      "employees.getEmployee",
      "employees.listPayrollCalendars",
      "contacts.getContact",
      "slack.postMessage",
      "email.send",
      "webhook.post",
    ],
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
  assert.match(preview.slack.text, /not checked \(dry run\)/);
  assert.equal(preview.slack.text.includes("PASS"), false);
  assert.equal(preview.slack.text.includes("MISSING"), false);
  assert.equal(preview.email.sent, false);
  assert.equal(shadow.fake.employees.length, 0);
  assert.equal(shadow.fake.contacts.length, 0);
  assert.equal(shadow.fake.slack.length, 0);
  assert.equal(shadow.fake.emails.length, 0);
  assert.equal(preview.payTemplate.updated, false);
  assert.equal(preview.payTemplate.template.SuperLines[0]?.SuperMembershipID, null);
  assert.equal(preview.webhook.posted, false);
  assert.equal(shadow.fake.calls.some((call) => call.method === "createEmployee"), false);
  assert.equal(shadow.fake.calls.some((call) => call.method === "getEmployee"), false);
  assert.equal(shadow.fake.calls.some((call) => call.method === "updatePayTemplate"), false);
  assert.equal(shadow.fake.calls.some((call) => call.method === "upsertContact"), false);
  assert.equal(shadow.fake.calls.some((call) => call.method === "post"), false);
  assert.equal(shadow.fake.webhooks.length, 0);
  assert.equal(shadow.fake.calls.length, 0);
});
