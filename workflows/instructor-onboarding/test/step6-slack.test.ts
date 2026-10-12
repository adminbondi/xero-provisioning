import "./block-network.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { parseAirtableRecord } from "../src/airtable/parse-record.ts";
import { defaultConfig } from "../src/config.ts";
import { sampleAirtableRecord } from "../src/fixtures/sample-instructor.ts";
import { buildSlackMessage } from "../src/messages/slack.ts";
import { resolveConfig } from "../src/config.ts";
import { runInstructorOnboarding } from "../src/run.ts";
import { runtime } from "./helpers.ts";

test("step 6 posts to #management as the bot text from the Zap map", () => {
  const record = parseAirtableRecord(sampleAirtableRecord());
  const message = buildSlackMessage({
    record,
    employeeId: "employee-1",
    contactId: "contact-1",
    config: defaultConfig(),
  });
  assert.equal(message.channel, "C09BK6Y2WHL");
  assert.equal(
    message.text,
    [
      "Avery Nguyen has successfully been created in Xero",
      "",
      "https://go.xero.com/app/!hGL34/payroll/employee/employee-1/details",
      "https://go.xero.com/app/!hGL34/contacts/contact/contact-1/activity",
      "https://balancemovesbondi.atlassian.net/wiki/x/CgBmH",
      "https://airtable.com/appePgXVPIIkgnvBQ/pagwdybqbkTKfuNQX?sh4iX=recInstructor001",
      "",
      "Name: Avery Nguyen",
      "Email: avery.nguyen.example@example.com",
      "Mobile: 0412345678",
      "Bank: 12345678",
      "BSB: 062000",
      "ABN: 12345678901 (https://abr.business.gov.au/ABN/View?id=12345678901)",
      "TFN: 123456782",
      "Super fund: AustralianSuper",
      "Member no: SM-100200",
      "",
      "Note: admin@balancemoves.com.au emails the instructor to confirm these details.",
    ].join("\n"),
  );
});

test("step 6 escapes names and can take a channel override without code changes", async () => {
  const record = parseAirtableRecord(sampleAirtableRecord());
  record.firstName = "Avery <ops>";
  const message = buildSlackMessage({ record, employeeId: "e", contactId: "c", config: defaultConfig() });
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
});
