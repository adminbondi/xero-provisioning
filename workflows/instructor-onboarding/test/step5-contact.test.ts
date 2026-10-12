import "./block-network.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { parseAirtableRecord } from "../src/airtable/parse-record.ts";
import { CONTRACTORS_GROUP_NAME } from "../src/config.ts";
import { sampleAirtableRecord } from "../src/fixtures/sample-instructor.ts";
import { accountsPayableTaxType, buildContactPayload, contactBankAccount, contactMobile, contactNumberFor, proposedE164Mobile } from "../src/mappings/contact.ts";
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
  assert.equal(payload.AccountsPayableTaxType, "INPUT");
  assert.equal(accountsPayableTaxType("YES"), "INPUT");
  assert.equal(accountsPayableTaxType("NO"), "INPUT");
  assert.equal(JSON.stringify(payload).includes("Sam Nguyen"), false);
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

test("a name-only Xero match is held and a different person is still created", async () => {
  const held = runtime({
    contacts: [{ contactId: "contact-from-zap", name: "Avery Nguyen", contactNumber: null, email: "someone.else@example.com" }],
  });
  const result = await runInstructorOnboarding(sampleAirtableRecord(), {
    ...held.deps,
    config: { ...held.deps.config!, slackChannelId: "C-DRY-TEST" },
  });
  assert.equal(result.match.disposition, "hold-name");
  assert.equal(result.employee.action, "hold-name");
  assert.equal(result.employee.created, false);
  assert.equal(result.contact.action, "hold-name");
  assert.equal(result.contact.contactId, "contact-from-zap");
  assert.equal(result.contact.created, false);
  assert.equal(held.fake.calls.some((call) => call.method === "findContactsByName"), true);
  assert.equal(held.fake.calls.some((call) => call.method === "upsertContact"), false);
  assert.equal(held.fake.calls.some((call) => call.method === "createEmployee"), false);
  assert.equal(held.fake.calls.some((call) => call.method === "send"), false);
  assert.equal(held.fake.slack.length, 1);
  assert.equal(held.fake.slack[0]?.channel, "C-DRY-TEST");
  assert.match(held.fake.slack[0]?.text ?? "", /held for a person to check/);
  assert.equal(held.fake.slack[0]?.text.includes("has successfully been created"), false);
  const record = parseAirtableRecord(sampleAirtableRecord());
  for (const secret of [record.tfn, record.account, record.bsb, record.abn, record.memberNumber]) {
    assert.equal(held.fake.slack[0]?.text.includes(secret), false);
  }
  assert.equal(held.fake.contacts.length, 1);

  const created = runtime({
    contacts: [{ contactId: "contact-other", name: "Other Person", contactNumber: "airtable:recInstructor001", email: "other.person@example.com" }],
  });
  const update = await runInstructorOnboarding(sampleAirtableRecord(), created.deps);
  assert.equal(update.match.disposition, "create");
  assert.equal(update.contact.action, "update");
  assert.equal(update.contact.created, false);
  assert.equal(update.contact.contactId, "contact-other");
  assert.equal(created.fake.calls.filter((call) => call.method === "upsertContact").length, 1);
});

function payloadWouldChange(): boolean {
  return contactMobile("0412345678") === proposedE164Mobile("0412345678");
}
