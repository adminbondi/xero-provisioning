import "./block-network.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { AIRTABLE_FIELDS, parseAirtableRecord } from "../src/airtable/parse-record.ts";
import { AirtableFieldTypeError } from "../src/errors.ts";
import { sampleAirtableRecord } from "../src/fixtures/sample-instructor.ts";
import { withFields } from "./helpers.ts";

test("step 1 parses a new Instructors record and keeps attachment metadata", () => {
  const record = parseAirtableRecord(sampleAirtableRecord());
  assert.equal(record.recordId, "recInstructor001");
  assert.equal(record.firstName, "Avery");
  assert.equal(record.city, "Bondi Beach");
  assert.equal(record.superFund, "AustralianSuper");
  assert.equal(record.attachments.length, 1);
  assert.equal(record.attachments[0]?.filename, "cert.pdf");
  assert.equal(record.attachments[0]?.field, "Certificate");
  assert.equal(AIRTABLE_FIELDS.city, "City/Suburb");
  assert.equal(AIRTABLE_FIELDS.memberNumber, "Superannuation Member Number");
});

test("step 1 ignores non-attachment arrays and rejects numeric text fields", () => {
  const parsed = parseAirtableRecord(withFields({ Tags: ["reformer"] }));
  assert.equal(parsed.attachments.length, 1);
  assert.throws(() => parseAirtableRecord(withFields({ BSB: 62000 })), AirtableFieldTypeError);
});
