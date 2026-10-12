import "./block-network.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { parseAirtableRecord } from "../src/airtable/parse-record.ts";
import { EMAIL_FROM, EMAIL_FROM_NAME, EMAIL_SUBJECT, defaultConfig } from "../src/config.ts";
import { sampleAirtableRecord } from "../src/fixtures/sample-instructor.ts";
import { buildInstructorEmail } from "../src/messages/email.ts";

test("step 7 builds the confirmation email from admin@balancemoves.com.au", () => {
  const record = parseAirtableRecord(sampleAirtableRecord());
  const message = buildInstructorEmail(record, defaultConfig());
  assert.equal(message.from, EMAIL_FROM);
  assert.equal(message.from, "admin@balancemoves.com.au");
  assert.equal(message.fromName, EMAIL_FROM_NAME);
  assert.equal(message.fromName, "Thiago & Yvette");
  assert.equal(message.to, "avery.nguyen.example@example.com");
  assert.deepEqual(message.cc, ["admin@balancemoves.com.au"]);
  assert.deepEqual(message.bcc, ["admin@balancemoves.com.au"]);
  assert.equal(message.subject, EMAIL_SUBJECT);
  assert.equal(message.subject, "Instructor Onboarding: Please Confirm Your Details");
  assert.match(message.html, /Hello Avery,/);
  assert.match(message.html, /Welcome\. Please review &amp; reply confirming:/);
  assert.match(message.html, /Tax Details/);
  assert.match(message.html, /Bank account: 12345678/);
  assert.match(message.html, /BSB: 062000/);
  assert.match(message.html, /ABN: 12345678901/);
  assert.match(message.html, /https:\/\/abr\.business\.gov\.au\/ABN\/View\?id=12345678901/);
  assert.match(message.html, /TFN: 123456782/);
  assert.match(message.html, /Superannuation/);
  assert.match(message.html, /Fund: AustralianSuper/);
  assert.match(message.html, /Member no: SM-100200/);
  assert.match(message.html, /Yvette &amp; Thiago/);
  assert.match(message.html, /0424 133 544/);
  assert.match(message.html, /balancemoves\.com\.au/);
  assert.match(message.html, /72A-74 Hall Street Bondi Beach NSW 2026/);
});

test("step 7 encodes instructor-controlled text", () => {
  const record = parseAirtableRecord(sampleAirtableRecord());
  record.firstName = "Avery <b>";
  const message = buildInstructorEmail(record, defaultConfig());
  assert.match(message.html, /Hello Avery &lt;b&gt;,/);
  assert.equal(message.html.includes("<b>"), false);
});
