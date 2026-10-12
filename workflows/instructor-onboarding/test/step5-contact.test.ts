import "./block-network.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { parseAirtableRecord } from "../src/airtable/parse-record.ts";
import { CONTRACTORS_GROUP_NAME } from "../src/config.ts";
import { sampleAirtableRecord } from "../src/fixtures/sample-instructor.ts";
import { buildContactPayload, contactBankAccount, contactMobile, contactNumberFor } from "../src/mappings/contact.ts";
import { runInstructorOnboarding } from "../src/run.ts";
import { runtime } from "./helpers.ts";

test("step 5 builds the create/update contact, including concatenated bank details and +61", () => {
  const record = parseAirtableRecord(sampleAirtableRecord());
  assert.equal(contactMobile("0412345678"), "+610412345678");
  assert.equal(contactBankAccount("062000", "12345678"), "06200012345678");
  assert.equal(contactNumberFor(record.recordId), "airtable:recInstructor001");
  const payload = buildContactPayload(record);
  assert.equal(payload.Name, "Avery Nguyen");
  assert.equal(payload.FirstName, "Avery");
  assert.equal(payload.LastName, "Nguyen");
  assert.equal(payload.EmailAddress, record.email);
  assert.equal(payload.TaxNumber, "12345678901");
  assert.equal(payload.BankAccountDetails, "06200012345678");
  assert.equal(payload.Phones[0]?.PhoneType, "MOBILE");
  assert.equal(payload.Phones[0]?.PhoneNumber, "+610412345678");
  assert.equal(payload.Phones[0]?.PhoneCountryCode, "");
  assert.equal(payload.Addresses[0]?.AddressType, "POBOX");
  assert.equal(payload.Addresses[0]?.Region, "VIC");
  assert.equal(payload.Addresses[0]?.Country, "Australia");
  assert.equal(payload.Addresses[0]?.City, "Bondi Beach");
  assert.equal(payload.Addresses[0]?.PostalCode, "2026");
  assert.deepEqual(payload.ContactGroups, [{ Name: CONTRACTORS_GROUP_NAME }]);
  assert.deepEqual(payload.ContactGroups, [{ Name: "Contractors" }]);
});

test("step 5 updates a contact the Zap may already have created under the same name", async () => {
  const { fake, deps } = runtime({
    contacts: [{ contactId: "contact-from-zap", name: "Avery Nguyen", contactNumber: null }],
  });
  const result = await runInstructorOnboarding(sampleAirtableRecord(), deps);
  assert.equal(fake.contacts.length, 1);
  assert.equal(result.contact.created, false);
  assert.equal(result.contact.action, "update");
  assert.equal(result.contact.contactId, "contact-from-zap");
  assert.equal(fake.contacts[0]?.contactNumber, "airtable:recInstructor001");
  assert.equal(fake.contacts[0]?.payload?.ContactGroups[0]?.Name, "Contractors");
});
