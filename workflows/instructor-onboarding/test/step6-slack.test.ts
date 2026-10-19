import "./block-network.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { parseAirtableRecord } from "../src/airtable/parse-record.ts";
import { defaultConfig, resolveConfig } from "../src/config.ts";
import { sampleAirtableRecord } from "../src/fixtures/sample-instructor.ts";
import { lookupGender } from "../src/lookups/gender.ts";
import { lookupSuperFund } from "../src/lookups/super-funds.ts";
import { contactMobile, buildContactPayload } from "../src/mappings/contact.ts";
import { buildEmployeePayload, buildPayTemplate } from "../src/mappings/employee.ts";
import {
  buildSlackMessage,
  fixedAmountIsBlank,
  setupCheckLines,
  setupFactsFromWritten,
} from "../src/messages/slack.ts";
import { runInstructorOnboarding } from "../src/run.ts";
import { runtime } from "./helpers.ts";

test("live create output passes the end check with no MISSING lines", () => {
  const record = parseAirtableRecord(sampleAirtableRecord());
  const employee = buildEmployeePayload({
    record,
    genderCode: lookupGender(record.gender),
    superFundId: lookupSuperFund(record.superFund),
    payrollCalendarId: "cal-weekly",
    startDate: "2026-10-13",
  });
  const contact = buildContactPayload(record);
  const template = buildPayTemplate("membership-1");
  assert.equal(contactMobile(record.mobile), `+61${record.mobile}`);
  assert.equal(contact.Phones[0]?.PhoneNumber, "+610412345678");
  assert.equal("PurchasesDefaultAccountCode" in contact, false);
  assert.equal("Amount" in template.SuperLines[0], false);
  const facts = setupFactsFromWritten({
    superFundId: lookupSuperFund(record.superFund),
    superFundName: record.superFund,
    employee,
    contact,
    amount: undefined,
    calendarType: "WEEKLY",
    purchaseAccountCode: null,
  });
  const lines = setupCheckLines(facts);
  assert.equal(lines.some((line) => line.status === "missing"), false);
  assert.equal(lines.every((line) => line.status === "pass"), true);
  assert.equal(lines.some((line) => line.label === "Emergency contact"), false);
  assert.equal(lines.find((line) => line.label === "Mobile")?.status, "pass");
  assert.equal(lines.find((line) => line.label === "Default purchase account")?.status, "pass");
  const message = buildSlackMessage({
    name: "Avery Nguyen",
    employeeId: "employee-1",
    contactId: "contact-1",
    recordId: record.recordId,
    orgShortCode: defaultConfig().orgShortCode,
    channel: defaultConfig().slackChannelId,
    checks: lines,
  });
  assert.equal(message.channel, "C09BK6Y2WHL");
  assert.match(message.text, /has been fully onboarded in Xero/);
  assert.match(message.text, /https:\/\/go\.xero\.com\/app\/!hGL34\/payroll\/employee\/employee-1\/details/);
  assert.match(message.text, /https:\/\/go\.xero\.com\/app\/!hGL34\/contacts\/contact\/contact-1\/activity/);
  assert.match(message.text, /https:\/\/airtable\.com\/appePgXVPIIkgnvBQ\/pagwdybqbkTKfuNQX\?sh4iX=recInstructor001/);
  assert.equal(message.text.includes("MISSING"), false);
  assert.equal(message.text.includes("Emergency contact"), false);
  for (const secret of [record.tfn, record.account, record.bsb, record.abn, record.memberNumber]) {
    assert.equal(message.text.includes(secret), false);
  }
});

test("a blank or zero Fixed Amount passes and a set purchase account does not", () => {
  const record = parseAirtableRecord(sampleAirtableRecord());
  const employee = buildEmployeePayload({
    record,
    genderCode: lookupGender(record.gender),
    superFundId: lookupSuperFund(record.superFund),
    payrollCalendarId: "cal-weekly",
    startDate: "2026-10-13",
  });
  const contact = buildContactPayload(record);
  for (const amount of [undefined, null, "", "  ", 0, "0", "0.00"]) {
    assert.equal(fixedAmountIsBlank(amount), true, String(amount));
    const lines = setupCheckLines(
      setupFactsFromWritten({
        superFundId: lookupSuperFund(record.superFund),
        superFundName: record.superFund,
        employee,
        contact,
        amount,
        calendarType: "WEEKLY",
        purchaseAccountCode: null,
      }),
    );
    assert.equal(lines.find((line) => line.label.startsWith("Super line"))?.status, "pass");
  }
  assert.equal(fixedAmountIsBlank("10.50"), false);
  const setAmount = setupCheckLines(
    setupFactsFromWritten({
      superFundId: lookupSuperFund(record.superFund),
      superFundName: record.superFund,
      employee,
      contact,
      amount: 12,
      calendarType: "WEEKLY",
      purchaseAccountCode: "",
    }),
  );
  assert.equal(setAmount.find((line) => line.label.startsWith("Super line"))?.status, "missing");
  assert.equal(setAmount.find((line) => line.label === "Default purchase account")?.status, "pass");
  const setPurchase = setupCheckLines(
    setupFactsFromWritten({
      superFundId: lookupSuperFund(record.superFund),
      superFundName: record.superFund,
      employee,
      contact,
      amount: undefined,
      calendarType: "WEEKLY",
      purchaseAccountCode: "310",
    }),
  );
  assert.equal(setPurchase.find((line) => line.label === "Default purchase account")?.status, "missing");
});

test("step 6 escapes names and can take a channel override without code changes", async () => {
  const { fake, deps } = runtime();
  const result = await runInstructorOnboarding(sampleAirtableRecord(), {
    ...deps,
    config: resolveConfig({
      SLACK_CHANNEL_ID: "C-TEST-ONLY",
      XERO_WEEKLY_PAYROLL_CALENDAR_ID: "cal-weekly",
    }),
  });
  assert.equal(result.slack.channel, "C-TEST-ONLY");
  assert.equal(fake.slack[0]?.channel, "C-TEST-ONLY");
  assert.match(result.slack.text, /PASS Mobile/);
  assert.equal(result.slack.text.includes("MISSING"), false);
  assert.equal(result.contact.payload.Phones[0]?.PhoneNumber, "+610412345678");
});
