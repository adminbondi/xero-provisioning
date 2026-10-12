import "./block-network.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { AIRTABLE_FIELDS } from "../src/airtable/parse-record.ts";
import { AirtableFieldTypeError, MissingFieldsError } from "../src/errors.ts";
import { runInstructorOnboarding } from "../src/run.ts";
import { runtime, withFields } from "./helpers.ts";

const required = [
  AIRTABLE_FIELDS.firstName,
  AIRTABLE_FIELDS.lastName,
  AIRTABLE_FIELDS.dateOfBirth,
  AIRTABLE_FIELDS.email,
  AIRTABLE_FIELDS.gender,
  AIRTABLE_FIELDS.mobile,
  AIRTABLE_FIELDS.superFund,
  AIRTABLE_FIELDS.memberNumber,
  AIRTABLE_FIELDS.tfn,
  AIRTABLE_FIELDS.residentialAddress,
  AIRTABLE_FIELDS.city,
  AIRTABLE_FIELDS.state,
  AIRTABLE_FIELDS.postalCode,
  AIRTABLE_FIELDS.abn,
  AIRTABLE_FIELDS.bsb,
  AIRTABLE_FIELDS.account,
];

test("missing fields are named and no external call is made", async () => {
  const { fake, deps } = runtime();
  await assert.rejects(
    () => runInstructorOnboarding(withFields({}, ["TFN", "Mobile", "ABN"]), deps),
    (error: unknown) => {
      assert.ok(error instanceof MissingFieldsError);
      assert.equal(error.step, "airtable-record");
      assert.deepEqual(error.fields, ["Mobile", "TFN", "ABN"]);
      return true;
    },
  );
  assert.equal(fake.calls.length, 0);
  assert.equal(fake.employees.length, 0);
  assert.equal(fake.contacts.length, 0);
  assert.equal(fake.slack.length, 0);
  assert.equal(fake.emails.length, 0);
});

test("each required Airtable field blocks the run on its own", async () => {
  const aliases: Record<string, string[]> = {
    Account: ["Bank Account Number"],
    DOB: ["Date of Birth"],
  };
  for (const field of required) {
    const { fake, deps } = runtime();
    await assert.rejects(
      () => runInstructorOnboarding(withFields({}, [field, ...(aliases[field] ?? [])]), deps),
      (error: unknown) => error instanceof MissingFieldsError && error.fields.includes(field),
    );
    assert.equal(fake.calls.length, 0, field);
  }
  const { fake, deps } = runtime();
  const blankId = withFields();
  blankId.id = "";
  await assert.rejects(
    () => runInstructorOnboarding(blankId, deps),
    (error: unknown) => error instanceof MissingFieldsError && error.fields.includes("record id"),
  );
  assert.equal(fake.calls.length, 0);
});

test("a non-ISO date of birth is rejected before Xero", async () => {
  const { fake, deps } = runtime();
  await assert.rejects(
    () => runInstructorOnboarding(withFields({ DOB: "18/04/1992" }), deps),
    /DOB \(expected YYYY-MM-DD\)/,
  );
  assert.equal(fake.employees.length, 0);
});

test("numeric BSB is rejected instead of dropping the leading zero", async () => {
  const { fake, deps } = runtime();
  await assert.rejects(() => runInstructorOnboarding(withFields({ BSB: 62000 }), deps), AirtableFieldTypeError);
  assert.equal(fake.calls.length, 0);
});
