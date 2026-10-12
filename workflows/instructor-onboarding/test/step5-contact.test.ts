import "./block-network.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { parseAirtableRecord } from "../src/airtable/parse-record.ts";
import { CONTRACTORS_GROUP_NAME } from "../src/config.ts";
import { sampleAirtableRecord } from "../src/fixtures/sample-instructor.ts";
import { buildContactPayload, contactBankAccount, contactMobile, contactNumberFor, proposedE164Mobile } from "../src/mappings/contact.ts";
import { runInstructorOnboarding } from "../src/run.ts";
import { runtime } from "./helpers.ts";

test("step 5 builds the create/update contact, including concatenated bank details and +61", () => {
  const record = parseAirtableRecord(sampleAirtableRecord());
  assert.equal(contactMobile("0412345678"), "+610412345678");
  assert.equal(proposedE164Mobile("0412345678"), "+61412345678");
  assert.equal(proposedE164Mobile("+61412345678"), null);
  assert.equal(payloadWouldChange(), false);
  assert.equal(contactBankAccount("062000", "90817263"), "06200090817263");
  assert.equal(contactNumberFor(record.recordId), "airtable:recInstructor001");
  const payload = buildContactPayload(record);
  assert.equal(payload.Name, "Avery Nguyen");
  assert.equal(payload.FirstName, "Avery");
  assert.equal(payload.LastName, "Nguyen");
  assert.equal(payload.EmailAddress, record.email);
  assert.equal(payload.TaxNumber, "12345678901");
  assert.equal(payload.BankAccountDetails, "06200090817263");
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

test("step 5 upserts once by ContactNumber and does not search by name", async () => {
  const { fake, deps } = runtime({
    contacts: [{ contactId: "contact-from-zap", name: "Avery Nguyen", contactNumber: null }],
  });
  const result = await runInstructorOnboarding(sampleAirtableRecord(), deps);
  assert.equal(fake.calls.some((call) => call.method === "findContactsByName"), false);
  assert.equal(fake.calls.filter((call) => call.method === "upsertContact").length, 1);
  assert.equal(result.contact.created, true);
  assert.equal(fake.contacts.length, 2);

  const again = await runInstructorOnboarding(sampleAirtableRecord(), deps);
  assert.equal(again.contact.created, false);
  assert.equal(again.contact.action, "update");
  assert.equal(again.contact.contactId, result.contact.contactId);
  assert.equal(fake.contacts.length, 2);
});

function payloadWouldChange(): boolean {
  return contactMobile("0412345678") === proposedE164Mobile("0412345678");
}
