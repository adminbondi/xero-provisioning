/**
 * Ivan Iglesias's Payroll AU setup, on fakes only.
 * Does not call Xero, Slack, Gmail, or a webhook URL.
 */
import "./block-network.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { parseAirtableRecord } from "../src/airtable/parse-record.ts";
import { InvalidAbnError } from "../src/errors.ts";
import { sampleAirtableRecord } from "../src/fixtures/sample-instructor.ts";
import { lookupSuperFund } from "../src/lookups/super-funds.ts";
import { accountsPayableTaxType, buildContactPayload } from "../src/mappings/contact.ts";
import { buildEmployeePayload, buildPayTemplate } from "../src/mappings/employee.ts";
import { runInstructorOnboarding } from "../src/run.ts";
import type { XeroPayTemplate } from "../src/types.ts";
import { runtime, withFields } from "./helpers.ts";

const FORM_FUND = "4caabd49-1d08-4d8b-958b-d933a113e9c9";

test("YES and NO both keep GST on Expenses until Thiago confirms the split", () => {
  const yes = parseAirtableRecord(withFields({ "ABN Registered for GST": [{ name: "YES" }] }));
  const no = parseAirtableRecord(withFields({ "ABN Registered for GST": ["NO"] }));
  const plainNo = parseAirtableRecord(withFields({ "ABN Registered for GST": "NO" }));
  assert.equal(yes.abnRegisteredForGst, "YES");
  assert.equal(no.abnRegisteredForGst, "NO");
  assert.equal(plainNo.abnRegisteredForGst, "NO");
  assert.equal(accountsPayableTaxType("YES"), "INPUT");
  assert.equal(accountsPayableTaxType("NO"), "INPUT");
  assert.equal(buildContactPayload(yes).AccountsPayableTaxType, "INPUT");
  assert.equal(buildContactPayload(no).AccountsPayableTaxType, "INPUT");
  assert.equal(buildContactPayload(yes).TaxNumber, "12345678901");
  assert.equal(buildContactPayload(no).TaxNumber, "12345678901");
});

test("the super line uses the form fund membership and a second run does not duplicate it", async () => {
  const { fake, deps } = runtime({
    readback: {
      superMemberships: [
        {
          superMembershipId: "other-fund-membership",
          superFundId: "00000000-0000-0000-0000-000000000001",
          employeeNumber: "OTHER",
        },
        {
          superMembershipId: "form-fund-membership",
          superFundId: FORM_FUND,
          employeeNumber: "SM-100200",
        },
      ],
    },
  });
  const first = await runInstructorOnboarding(sampleAirtableRecord(), deps);
  const line = first.payTemplate.template.SuperLines[0];
  assert.equal(first.employee.payload.SuperMemberships[0]?.SuperFundID, lookupSuperFund("AustralianSuper"));
  assert.equal(first.employee.payload.SuperMemberships[0]?.SuperFundID, FORM_FUND);
  assert.equal(line?.SuperMembershipID, "form-fund-membership");
  assert.notEqual(line?.SuperMembershipID, "other-fund-membership");
  assert.equal(line?.ContributionType, "SGC");
  assert.equal(line?.CalculationType, "FIXEDAMOUNT");
  assert.equal(line?.ExpenseAccountCode, "478");
  assert.equal(line?.LiabilityAccountCode, "826");
  assert.equal("Percentage" in (line ?? {}), false);
  assert.equal("Amount" in (line ?? {}), false);
  assert.equal("MinimumMonthlyEarnings" in (line ?? {}), false);
  assert.deepEqual(first.payTemplate.template.EarningsLines, []);
  assert.deepEqual(first.payTemplate.template.LeaveLines, []);
  assert.deepEqual(first.payTemplate.template.DeductionLines, []);
  assert.deepEqual(first.payTemplate.template.ReimbursementLines, []);
  assert.equal(JSON.stringify(first.payTemplate.template).includes("12"), false);
  assert.equal(first.employeeRead.gender, "F");
  assert.equal(first.employeeRead.incomeType, "NONEMPLOYEE");
  assert.equal(first.employeeRead.genderUnset, false);
  assert.equal(first.employeeRead.incomeTypeUnset, false);

  const stored = fake.employees.find((employee) => employee.employeeId === first.employee.employeeId);
  assert.ok(stored);
  stored.payTemplate = {
    EarningsLines: [{ EarningsRateID: "rate-1" }],
    LeaveLines: [{ LeaveTypeID: "leave-1" }],
    DeductionLines: [{ DeductionTypeID: "deduction-1" }],
    ReimbursementLines: [{ Amount: 10 }],
    SuperLines: [{ ContributionType: "SGC" }, { ContributionType: "SGC" }],
  } as unknown as XeroPayTemplate;

  const second = await runInstructorOnboarding(sampleAirtableRecord(), deps);
  assert.equal(second.employee.action, "skip-email");
  assert.equal(second.employee.created, false);
  assert.equal(second.payTemplate.updated, false);
  assert.equal(fake.calls.filter((call) => call.method === "updatePayTemplate").length, 1);
  await fake.ports.employees.updatePayTemplate(stored.employeeId, first.payTemplate.template);
  assert.equal(stored.payTemplate?.SuperLines.length, 1);
  assert.deepEqual(stored.payTemplate?.EarningsLines, []);
  assert.deepEqual(stored.payTemplate?.LeaveLines, []);
  assert.equal(stored.payTemplate?.SuperLines[0]?.SuperMembershipID, "form-fund-membership");
  assert.equal(stored.payTemplate?.SuperLines[0]?.CalculationType, "FIXEDAMOUNT");
});

test("unset Gender and IncomeType are flagged and an 11-digit ABN is required", async () => {
  const flagged = runtime({ readback: { gender: "", incomeType: null } });
  const result = await runInstructorOnboarding(sampleAirtableRecord(), flagged.deps);
  assert.equal(result.employeeRead.genderUnset, true);
  assert.equal(result.employeeRead.incomeTypeUnset, true);
  assert.equal(result.payTemplate.updated, true);
  assert.equal(result.webhook.posted, true);
  assert.equal(result.webhook.payload.emergencyContactName, "Sam Nguyen");
  assert.equal(result.webhook.payload.emergencyContactMobile, "0499888777");
  assert.equal(JSON.stringify(result.employee.payload).includes("Sam Nguyen"), false);
  assert.equal(JSON.stringify(result.contact.payload).includes("Sam Nguyen"), false);

  const stated = runtime();
  const notStated = await runInstructorOnboarding(withFields({ Gender: "Not Stated" }), stated.deps);
  assert.equal(notStated.employee.payload.Gender, "");
  assert.equal(notStated.employeeRead.genderUnset, true);

  const record = parseAirtableRecord(withFields({ ABN: "1234567890" }));
  assert.throws(
    () =>
      buildEmployeePayload({
        record,
        genderCode: "F",
        superFundId: FORM_FUND,
        payrollCalendarId: "cal-weekly",
        startDate: "2026-10-13",
      }),
    InvalidAbnError,
  );
  const rejected = runtime();
  await assert.rejects(() => runInstructorOnboarding(withFields({ ABN: "1234567890" }), rejected.deps), InvalidAbnError);
  assert.equal(rejected.fake.calls.some((call) => call.method === "createEmployee"), false);
  assert.equal(rejected.fake.calls.some((call) => call.method === "getEmployee"), false);
});

test("dry run logs the full SGC template and does not post the webhook", async () => {
  const { fake, deps } = runtime();
  const preview = await runInstructorOnboarding(sampleAirtableRecord(), { ...deps, mode: "shadow" });
  const template = buildPayTemplate(null);
  assert.deepEqual(preview.payTemplate.template, template);
  assert.equal(preview.payTemplate.updated, false);
  assert.equal(preview.webhook.posted, false);
  assert.equal(preview.webhook.payload.xeroEmployeeId, null);
  assert.equal(preview.webhook.payload.emergencyContactName, "Sam Nguyen");
  assert.equal(fake.webhooks.length, 0);
  assert.equal(fake.calls.length, 0);
});
