/**
 * DRY_RUN logs and previews. Fakes only. No live Xero, Slack, Gmail, or webhook calls.
 */
import "./block-network.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { airtableFieldText, parseAirtableRecord } from "../src/airtable/parse-record.ts";
import { sampleAirtableRecord } from "../src/fixtures/sample-instructor.ts";
import { contactBankAccount } from "../src/mappings/contact.ts";
import { buildSlackMessage } from "../src/messages/slack.ts";
import { runInstructorOnboarding } from "../src/run.ts";
import { redactSensitiveError } from "../src/sensitive.ts";
import { runtime } from "./helpers.ts";

function sentinels(record: ReturnType<typeof parseAirtableRecord>): string[] {
  return [
    record.tfn,
    record.account,
    record.bsb,
    record.abn,
    record.memberNumber,
    airtableFieldText(record.rawFields, "Bank Account Number"),
    contactBankAccount(record.bsb, record.account),
  ].filter((value) => value.length > 0);
}

test("dry-run logs and previews omit payroll secrets and say which fields are present", async () => {
  const raw = sampleAirtableRecord();
  const record = parseAirtableRecord(raw);
  const secrets = sentinels(record);
  assert.equal(secrets.length >= 6, true);
  const lines: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => {
    lines.push(args.map((item) => String(item)).join(" "));
  };
  try {
    const { fake, deps } = runtime();
    const preview = await runInstructorOnboarding(raw, { ...deps, mode: "shadow" });
    const logged = lines.join("\n");
    for (const secret of secrets) {
      assert.equal(logged.includes(secret), false, "dry-run log");
      assert.equal(preview.slack.text.includes(secret), false, "slack preview");
      assert.equal(preview.email.message.html.includes(secret), false, "email preview");
    }
    assert.match(logged, /"tfn":true/);
    assert.match(logged, /"bankAccount":true/);
    assert.match(logged, /"bsb":true/);
    assert.match(logged, /"abn":true/);
    assert.match(logged, /"memberNumber":true/);
    assert.equal(logged.includes("0412345678"), true);
    assert.equal(preview.slack.text.includes("0412345678"), true);
    assert.match(preview.slack.text, /\[TFN\]/);
    assert.match(preview.slack.text, /\[BSB\]/);
    assert.match(preview.slack.text, /\[ABN\]/);
    assert.match(preview.slack.text, /\[bank account\]/);
    assert.match(preview.slack.text, /\[member number\]/);
    assert.match(preview.email.message.html, /\[TFN\]/);
    assert.match(preview.email.message.html, /\[bank account\]/);
    assert.equal(preview.slack.sent, false);
    assert.equal(preview.email.sent, false);
    assert.equal(fake.calls.length, 0);

    const live = await runInstructorOnboarding(raw, deps);
    const zapSlack = buildSlackMessage({
      record,
      employeeId: live.employee.employeeId ?? "",
      contactId: live.contact.contactId ?? "",
      config: deps.config!,
    });
    assert.equal(live.slack.text, zapSlack.text);
    for (const secret of [record.tfn, record.account, record.bsb, record.abn, record.memberNumber]) {
      assert.equal(live.slack.text.includes(secret), true);
    }
    assert.equal(fake.slack.length, 1);
    assert.equal(fake.slack[0]?.text, zapSlack.text);
  } finally {
    console.log = original;
  }
});

test("error text redacts bank, BSB, ABN, and member number the same way as TFN", () => {
  const record = parseAirtableRecord(sampleAirtableRecord());
  const body = JSON.stringify({
    TaxFileNumber: record.tfn,
    ABN: record.abn,
    TaxNumber: record.abn,
    EmployeeNumber: record.memberNumber,
    BankAccountDetails: contactBankAccount(record.bsb, record.account),
    BSB: record.bsb,
    AccountNumber: record.account,
    BankAccountNumber: airtableFieldText(record.rawFields, "Bank Account Number"),
  });
  const redacted = redactSensitiveError(`HTTP 400 from https://api.xero.com/example: ${body}`);
  for (const secret of sentinels(record)) {
    assert.equal(redacted.includes(secret), false);
  }
  assert.match(redacted, /"TaxFileNumber":"\[redacted\]"/);
  assert.match(redacted, /"ABN":"\[redacted\]"/);
  assert.match(redacted, /"BSB":"\[redacted\]"/);
  assert.match(redacted, /"EmployeeNumber":"\[redacted\]"/);
  assert.match(redacted, /"BankAccountDetails":"\[redacted\]"/);
});
