import "./block-network.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveStartDate } from "../src/clock.ts";
import { EMPLOYEE_HOME_STATE, ZAPIER_START_DATE_EXPRESSION } from "../src/config.ts";
import { PayrollCalendarError } from "../src/errors.ts";
import { parseAirtableRecord } from "../src/airtable/parse-record.ts";
import { lookupGender } from "../src/lookups/gender.ts";
import { lookupSuperFund } from "../src/lookups/super-funds.ts";
import { buildEmployeePayload } from "../src/mappings/employee.ts";
import { resolveWeeklyPayrollCalendar, runInstructorOnboarding } from "../src/run.ts";
import { sampleAirtableRecord } from "../src/fixtures/sample-instructor.ts";
import { runtime } from "./helpers.ts";

test("step 4 builds the contractor employee and keeps the Zap oddities", () => {
  const record = parseAirtableRecord(sampleAirtableRecord());
  assert.equal(record.state, "VIC");
  const payload = buildEmployeePayload({
    record,
    genderCode: lookupGender(record.gender),
    superFundId: lookupSuperFund(record.superFund),
    payrollCalendarId: "cal-weekly",
    startDate: "2026-10-13",
  });
  assert.equal(payload.FirstName, "Avery");
  assert.equal(payload.LastName, "Nguyen");
  assert.equal(payload.DateOfBirth, "1992-04-18");
  assert.equal(payload.Email, "avery.nguyen.example@example.com");
  assert.equal(payload.Gender, "F");
  assert.equal(payload.Mobile, "0412345678");
  assert.equal(payload.EmploymentType, "CONTRACTOR");
  assert.equal(payload.Status, "ACTIVE");
  assert.equal(payload.EmploymentType, "CONTRACTOR");
  assert.equal(payload.IncomeType, "NONEMPLOYEE");
  assert.equal(payload.TaxDeclaration.EmploymentBasis, "NONEMPLOYEE");
  assert.equal(payload.TaxDeclaration.TaxScaleType, null);
  assert.equal(payload.TaxDeclaration.ResidencyStatus, "AUSTRALIANRESIDENT");
  assert.equal(payload.TaxDeclaration.AustralianResidentForTaxPurposes, true);
  assert.equal(payload.TaxDeclaration.TaxFreeThresholdClaimed, false);
  assert.equal(payload.TaxDeclaration.HasHELPDebt, false);
  assert.equal(payload.TaxDeclaration.ABN, "12345678901");
  assert.equal(payload.TaxDeclaration.ABN.length, 11);
  assert.equal(payload.TaxDeclaration.TaxFileNumber, "123456782");
  assert.equal(payload.SuperMemberships[0]?.SuperFundID, "4caabd49-1d08-4d8b-958b-d933a113e9c9");
  assert.equal(payload.SuperMemberships[0]?.EmployeeNumber, "SM-100200");
  assert.equal(payload.HomeAddress.Region, "NSW");
  assert.equal(payload.HomeAddress.Region, EMPLOYEE_HOME_STATE);
  assert.notEqual(payload.HomeAddress.Region, record.state);
  assert.equal(payload.HomeAddress.Country, "Australia");
  assert.equal(payload.HomeAddress.AddressLine1, "1 Example Street");
  assert.equal(payload.HomeAddress.City, "Bondi Beach");
  assert.equal(payload.HomeAddress.PostalCode, "2026");
  assert.equal(payload.MiddleNames, null);
  assert.equal(payload.Phone, null);
  assert.equal(payload.JobTitle, null);
  assert.deepEqual(payload.BankAccounts, []);
  assert.equal(JSON.stringify(payload).includes("cert.pdf"), false);
  assert.equal(JSON.stringify(payload).includes("Sam Nguyen"), false);
});

test("step 4 resolves the Zap StartDate expression as today in Australia/Sydney", () => {
  assert.equal(ZAPIER_START_DATE_EXPRESSION, "{{=)}}");
  assert.equal(resolveStartDate(new Date("2026-10-12T12:30:00.000Z")), "2026-10-12");
  assert.equal(resolveStartDate(new Date("2026-10-12T13:30:00.000Z")), "2026-10-13");
});

test("step 4 posts one employee using the configured weekly calendar", async () => {
  const happy = runtime();
  const result = await runInstructorOnboarding(sampleAirtableRecord(), happy.deps);
  assert.equal(result.employee.payload.PayrollCalendarID, "cal-weekly");
  assert.equal(result.employee.payload.StartDate, "2026-10-13");
  assert.equal(result.startDate.zapierExpression, "{{=)}}");
  const methods = happy.fake.calls.map((call) => call.method);
  assert.equal(methods.filter((method) => method === "createEmployee").length, 1);
  assert.equal(methods.filter((method) => method === "listPayrollCalendars").length, 1);
  assert.equal(methods.indexOf("createEmployee") < methods.indexOf("listPayrollCalendars"), true);

  const missing = runtime();
  missing.deps = {
    ...missing.deps,
    config: { ...missing.deps.config!, payrollCalendarId: undefined },
  };
  await assert.rejects(() => runInstructorOnboarding(sampleAirtableRecord(), missing.deps), PayrollCalendarError);
  assert.equal(missing.fake.employees.length, 0);
  assert.equal(missing.fake.calls.some((call) => call.method === "listPayrollCalendars"), false);
});

test("the weekly calendar lookup is a separate one-shot read, not a workflow step", async () => {
  const one = runtime();
  assert.equal(await resolveWeeklyPayrollCalendar(one.fake.ports.employees), "cal-weekly");

  const none = runtime({ calendars: [] });
  await assert.rejects(() => resolveWeeklyPayrollCalendar(none.fake.ports.employees), PayrollCalendarError);

  const many = runtime({
    calendars: [
      { payrollCalendarId: "a", name: "Weekly", calendarType: "WEEKLY" },
      { payrollCalendarId: "b", name: "Weekly contractors", calendarType: "WEEKLY" },
    ],
  });
  await assert.rejects(() => resolveWeeklyPayrollCalendar(many.fake.ports.employees), /Multiple WEEKLY/);
});
