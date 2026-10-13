import "./block-network.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { parseAirtableRecord } from "../src/airtable/parse-record.ts";
import { defaultConfig, resolveConfig } from "../src/config.ts";
import { sampleAirtableRecord } from "../src/fixtures/sample-instructor.ts";
import { buildSlackMessage, setupCheckLines, type SetupFacts } from "../src/messages/slack.ts";
import { runInstructorOnboarding } from "../src/run.ts";
import { runtime } from "./helpers.ts";

function facts(patch: Partial<SetupFacts> = {}): SetupFacts {
  return {
    superFundId: "4caabd49-1d08-4d8b-958b-d933a113e9c9",
    expectedSuperFundId: "4caabd49-1d08-4d8b-958b-d933a113e9c9",
    contributionType: "SGC",
    calculationType: "FIXEDAMOUNT",
    expenseAccountCode: "478",
    liabilityAccountCode: "826",
    fixedAmountBlank: true,
    memberNumberPresent: true,
    abnPresent: true,
    employmentType: "CONTRACTOR",
    incomeType: "NONEMPLOYEE",
    genderPresent: true,
    weeklyCalendar: true,
    residencyStatus: "AUSTRALIANRESIDENT",
    tfnPresent: true,
    mobile: "+61 400 000 000",
    purchaseAccountCode: null,
    bankDetailsPresent: true,
    gstOnExpenses: true,
    ...patch,
  };
}

test("a blank Fixed Amount and a blank purchase account pass, and emergency contact is not checked", () => {
  const lines = setupCheckLines(facts());
  const ok = Object.fromEntries(lines.map((line) => [line.label, line.ok]));
  assert.equal(ok["Super line AustralianSuper SGC Fixed Amount accounts 478 and 826"], true);
  assert.equal(ok["Default purchase account"], true);
  assert.equal(lines.some((line) => line.label === "Emergency contact"), false);
  assert.equal(ok["Mobile format"], true);
  assert.equal(ok["GST on Expenses"], true);
  assert.equal(
    setupCheckLines(facts({ fixedAmountBlank: false })).find((line) => line.label.startsWith("Super line"))?.ok,
    true,
  );
  assert.equal(
    setupCheckLines(facts({ purchaseAccountCode: "310" })).find((line) => line.label === "Default purchase account")?.ok,
    false,
  );
  assert.equal(
    setupCheckLines(facts({ mobile: "+610400 000 000" })).find((line) => line.label === "Mobile format")?.ok,
    false,
  );
});

test("step 6 posts the checklist and does not include payroll values", () => {
  const record = parseAirtableRecord(sampleAirtableRecord());
  const checks = setupCheckLines(facts({ mobile: "+61 412345678" }));
  const message = buildSlackMessage({
    name: "Avery Nguyen",
    employeeId: "employee-1",
    contactId: "contact-1",
    recordId: record.recordId,
    orgShortCode: defaultConfig().orgShortCode,
    channel: defaultConfig().slackChannelId,
    checks,
  });
  assert.equal(message.channel, "C09BK6Y2WHL");
  assert.equal(
    message.text,
    [
      "*Avery Nguyen* has been fully onboarded in Xero ✅",
      "1. View Avery Nguyen's Profile on Xero (https://go.xero.com/app/!hGL34/payroll/employee/employee-1/details)",
      "2. Check Avery Nguyen's Contact on Xero (https://go.xero.com/app/!hGL34/contacts/contact/contact-1/activity)",
      "3. Open their Airtable record (https://airtable.com/appePgXVPIIkgnvBQ/pagwdybqbkTKfuNQX?sh4iX=recInstructor001)",
      "4. Check their ABN (https://abr.business.gov.au/)",
      "*Automatic checks*",
      ...checks.map((check) => `${check.ok ? "PASS" : "MISSING"} ${check.label}`),
      "*NOTE: they should have received an email from admin@balancemoves.com.au*",
    ].join("\n"),
  );
  assert.equal(message.text.includes("Emergency contact"), false);
  assert.equal(message.text.includes("Onboarding needs attention"), false);
  assert.equal(message.text.includes("https://abr.business.gov.au/ABN"), false);
  for (const secret of [record.tfn, record.account, record.bsb, record.abn, record.memberNumber]) {
    assert.equal(message.text.includes(secret), false);
  }
});

test("step 6 escapes names and can take a channel override without code changes", async () => {
  const checks = setupCheckLines(facts());
  const message = buildSlackMessage({
    name: "Avery <ops>",
    employeeId: "e",
    contactId: "c",
    recordId: "recInstructor001",
    orgShortCode: defaultConfig().orgShortCode,
    channel: defaultConfig().slackChannelId,
    checks,
  });
  assert.match(message.text, /Avery &lt;ops&gt;/);
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
  assert.match(result.slack.text, /has been fully onboarded in Xero/);
  assert.equal(result.slack.text.includes("Emergency contact"), false);
  assert.equal(result.slack.text.includes("Onboarding needs attention"), false);

  const raw = sampleAirtableRecord();
  delete (raw.fields as Record<string, unknown>)["Emergency Contact Name"];
  delete (raw.fields as Record<string, unknown>)["Emergency Contact Mobile"];
  const fresh = runtime();
  const withoutEmergency = await runInstructorOnboarding(raw, {
    ...fresh.deps,
    config: resolveConfig({
      SLACK_CHANNEL_ID: "C-TEST-ONLY",
      XERO_WEEKLY_PAYROLL_CALENDAR_ID: "cal-weekly",
    }),
  });
  assert.equal(withoutEmergency.slack.text, result.slack.text);
  assert.equal(withoutEmergency.slack.text.includes("Onboarding needs attention"), false);
});
