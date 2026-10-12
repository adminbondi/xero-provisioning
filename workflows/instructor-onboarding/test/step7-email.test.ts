import "./block-network.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { parseAirtableRecord } from "../src/airtable/parse-record.ts";
import { EMAIL_FROM, EMAIL_FROM_NAME, EMAIL_SUBJECT, defaultConfig } from "../src/config.ts";
import { sampleAirtableRecord } from "../src/fixtures/sample-instructor.ts";
import { buildInstructorEmail, escapeHtml, renderInstructorEmailHtml } from "../src/messages/email.ts";

test("step 7 renders Thiago's verbatim instructor email", () => {
  const record = parseAirtableRecord(sampleAirtableRecord());
  const message = buildInstructorEmail(record, defaultConfig());
  const expected = renderInstructorEmailHtml({
    firstName: "Avery",
    email: "avery.nguyen.example@example.com",
    bankAccountNumber: "55556666",
    bsb: "062000",
    abn: "12345678901",
    tfn: "123456782",
    superannuationFundName: "STA0100AU - AustralianSuper",
    memberNumber: "SM-100200",
  });
  assert.equal(message.from, EMAIL_FROM);
  assert.equal(message.from, "admin@balancemoves.com.au");
  assert.equal(message.fromName, EMAIL_FROM_NAME);
  assert.equal(message.fromName, "Thiago & Yvette");
  assert.equal(message.to, "avery.nguyen.example@example.com");
  assert.deepEqual(message.cc, ["admin@balancemoves.com.au"]);
  assert.deepEqual(message.bcc, ["admin@balancemoves.com.au"]);
  assert.equal(message.subject, EMAIL_SUBJECT);
  assert.equal(message.subject, "Instructor Onboarding: Please Confirm Your Details");
  assert.equal(message.html, expected);
  for (const value of ["Avery", "55556666", "062000", "12345678901", "123456782", "STA0100AU - AustralianSuper", "SM-100200"]) {
    assert.equal(message.html.includes(value), true, value);
  }
  assert.equal(message.html.split("12345678901").length - 1, 2);
  assert.equal(message.html.includes("{"), false);
  assert.equal(message.html.includes("}"), false);
  assert.equal(message.html.includes("<strong>Bank Account Number:</strong> 90817263"), false);
  assert.equal(message.html.includes("4caabd49-1d08-4d8b-958b-d933a113e9c9"), false);
  assert.match(message.html, /Hello Avery, <\/p>/);
  assert.match(message.html, /Welcome again to Balance Moves! Thanks for submitting your details - we're looking forward to working with you!/);
  assert.match(message.html, /we would like to kindly request that you to review and confirm/i);
  assert.match(message.html, /<p>Best regards,<\/p>$/);
});

test("step 7 encodes instructor-controlled text", () => {
  const raw = sampleAirtableRecord();
  const fields = raw.fields as Record<string, unknown>;
  fields["First Name"] = "Avery <b>";
  const message = buildInstructorEmail(parseAirtableRecord(raw), defaultConfig());
  assert.match(message.html, /Hello Avery &lt;b&gt;, /);
  assert.equal(message.html.includes("<b>"), false);
  assert.equal(message.html.includes(escapeHtml("Avery <b>")), true);
});

test("step 7 reads live number columns and the raw super fund name", () => {
  const record = parseAirtableRecord({
    id: "recLiveShape000001",
    fields: {
      "First Name": "Example",
      "Last Name": "Instructor",
      "Date of Birth": "1990-01-02",
      Email: "example.instructor@example.com",
      Gender: "Female",
      Mobile: "0412000000",
      "Super Fund": "AustralianSuper",
      "Superannuation Fund Name": { name: "STA0100AU - AustralianSuper" },
      "Superannuation Member Number": 100200,
      TFN: 123456782,
      "Residential Address": "1 Example Street",
      "City/Suburb": "Bondi",
      State: "New South Wales",
      "Postal Code": "2026",
      ABN: 12345678901,
      BSB: "062000",
      "Bank Account Number": 55556666,
    },
  });
  assert.equal(record.dateOfBirth, "1990-01-02");
  assert.equal(record.account, "55556666");
  assert.equal(record.tfn, "123456782");
  assert.equal(record.abn, "12345678901");
  assert.equal(record.memberNumber, "100200");
  const message = buildInstructorEmail(record, defaultConfig());
  assert.match(message.html, /STA0100AU - AustralianSuper/);
  assert.match(message.html, /Bank Account Number:<\/strong> 55556666/);
  assert.equal(message.html.includes("{"), false);
});
