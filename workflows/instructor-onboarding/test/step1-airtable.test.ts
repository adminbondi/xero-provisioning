import "./block-network.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { AIRTABLE_FIELDS, parseAirtableRecord } from "../src/airtable/parse-record.ts";
import { AIRTABLE_BASE_ID, AIRTABLE_TABLE_ID, SAFETY_NET_CRON } from "../src/config.ts";
import { AirtableFieldTypeError } from "../src/errors.ts";
import { sampleAirtableRecord } from "../src/fixtures/sample-instructor.ts";
import { SAFETY_NET_NOT_BEFORE_MESSAGE, runSafetyNet } from "../src/host/safety-net.ts";
import { runtime, withFields } from "./helpers.ts";

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

test("the daily safety net lists with attachments and no view or filter", async () => {
  assert.equal(SAFETY_NET_CRON, "0 21 * * *");
  const record = sampleAirtableRecord();
  record.createdTime = "2026-10-12T01:00:00.000Z";
  const { fake } = runtime({ airtableRecords: [record] });
  const enqueued: string[] = [];
  const tick = await runSafetyNet({
    airtable: fake.ports.airtable,
    notBefore: "2026-10-01T00:00:00.000Z",
    hasWorkflow: async () => false,
    enqueue: async (item) => {
      enqueued.push(item.id);
    },
  });
  assert.equal(tick.blocked, false);
  assert.equal(fake.calls.filter((call) => call.method === "listRecords").length, 1);
  const detail = fake.calls[0]?.detail as {
    baseId: string;
    tableId: string;
    includeAttachments: boolean;
    view: null;
    filterByFormula: null;
  };
  assert.equal(detail.baseId, AIRTABLE_BASE_ID);
  assert.equal(detail.baseId, "appePgXVPIIkgnvBQ");
  assert.equal(detail.tableId, AIRTABLE_TABLE_ID);
  assert.equal(detail.tableId, "tblageJRycUMiyKGr");
  assert.equal(detail.includeAttachments, true);
  assert.equal(detail.view, null);
  assert.equal(detail.filterByFormula, null);
  assert.deepEqual(enqueued, ["recInstructor001"]);
  assert.equal(fake.employees.length, 0);
});

test("the safety net refuses to scan history until the cutoff is set", async () => {
  const { fake } = runtime({ airtableRecords: [sampleAirtableRecord()] });
  const tick = await runSafetyNet({
    airtable: fake.ports.airtable,
    notBefore: null,
    hasWorkflow: async () => false,
    enqueue: async () => {
      throw new Error("should not enqueue");
    },
  });
  assert.equal(tick.blocked, true);
  assert.equal(tick.reason, SAFETY_NET_NOT_BEFORE_MESSAGE);
  assert.equal(fake.calls.length, 0);
  assert.equal(fake.employees.length, 0);
});
