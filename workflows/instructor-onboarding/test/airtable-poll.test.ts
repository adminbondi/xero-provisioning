/**
 * Hourly Airtable poll. Fakes only. No live Airtable, Xero, Slack, Gmail, or webhook calls.
 */
import "./block-network.ts";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { airtableFieldText, parseAirtableRecord } from "../src/airtable/parse-record.ts";
import {
  AIRTABLE_BASE_ID,
  AIRTABLE_POLL_CALLS_PER_30_DAY_MONTH,
  AIRTABLE_POLL_CALLS_PER_31_DAY_MONTH,
  AIRTABLE_POLL_CRON,
  AIRTABLE_TABLE_ID,
} from "../src/config.ts";
import { sampleAirtableRecord } from "../src/fixtures/sample-instructor.ts";
import {
  AIRTABLE_CURSOR_KEY_DRY,
  AIRTABLE_CURSOR_KEY_LIVE,
  AIRTABLE_POLL_BLOCKED_MESSAGE,
  EXPECTED_AIRTABLE_CALLS,
  createdAfterFormula,
  memoryCursor,
  pollNewInstructors,
} from "../src/host/airtable-poll.ts";
import { createAirtablePort } from "../src/host/http.ts";
import { contactBankAccount } from "../src/mappings/contact.ts";
import { runInstructorOnboarding } from "../src/run.ts";
import type { AirtableApiRecord } from "../src/types.ts";
import type { AirtableListArgs } from "../src/ports.ts";
import { runtime } from "./helpers.ts";

const NOT_BEFORE = "2026-10-01T00:00:00.000Z";

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

test("a new Instructors row is polled once, and a re-run does not handle it again", async () => {
  assert.equal(AIRTABLE_POLL_CRON, "0 * * * *");
  assert.equal(EXPECTED_AIRTABLE_CALLS.perDay, 24);
  assert.equal(AIRTABLE_POLL_CALLS_PER_30_DAY_MONTH, 720);
  assert.equal(AIRTABLE_POLL_CALLS_PER_31_DAY_MONTH, 744);
  const wrangler = readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8");
  assert.match(wrangler, /"crons": \["0 \* \* \* \*"\]/);
  assert.equal(wrangler.includes("0 21 * * *"), false);

  const record = sampleAirtableRecord();
  record.createdTime = "2026-10-12T01:00:00.000Z";
  const older = sampleAirtableRecord();
  older.id = "recOlder00000001";
  older.createdTime = "2026-09-01T00:00:00.000Z";
  const { fake } = runtime({ airtableRecords: [older, record] });
  const cursor = memoryCursor();
  const enqueued: AirtableApiRecord[] = [];
  const first = await pollNewInstructors({
    airtable: fake.ports.airtable,
    cursor,
    dryRun: true,
    notBefore: NOT_BEFORE,
    enqueue: async (item) => {
      enqueued.push(item);
    },
  });
  assert.equal(first.blocked, false);
  assert.equal(first.pages, 1);
  assert.deepEqual(enqueued.map((item) => item.id), ["recInstructor001"]);
  const fields = enqueued[0]?.fields as Record<string, unknown>;
  assert.equal(fields["First Name"], "Avery");
  assert.equal(first.watermark, "2026-10-12T01:00:00.000Z");
  const lists = fake.calls.filter((call) => call.method === "listRecords");
  assert.equal(lists.length, 1);
  const detail = lists[0]?.detail as AirtableListArgs;
  assert.equal(detail.baseId, AIRTABLE_BASE_ID);
  assert.equal(detail.tableId, AIRTABLE_TABLE_ID);
  assert.equal(detail.includeAttachments, true);
  assert.equal(detail.view, null);
  assert.equal(detail.offset, undefined);
  assert.equal(detail.filterByFormula, createdAfterFormula(NOT_BEFORE));
  assert.equal(fake.calls.some((call) => call.method === "createEmployee"), false);

  const second = await pollNewInstructors({
    airtable: fake.ports.airtable,
    cursor,
    dryRun: true,
    notBefore: NOT_BEFORE,
    enqueue: async () => {
      throw new Error("should not enqueue on re-run");
    },
  });
  assert.equal(second.blocked, false);
  assert.equal(second.pages, 1);
  assert.deepEqual(second.enqueued, []);
  assert.equal(second.watermark, "2026-10-12T01:00:00.000Z");
  const again = fake.calls.filter((call) => call.method === "listRecords");
  assert.equal(again.length, 2);
  const secondDetail = again[1]?.detail as AirtableListArgs;
  assert.equal(secondDetail.filterByFormula, createdAfterFormula("2026-10-12T01:00:00.000Z"));
  assert.equal(await cursor.get(AIRTABLE_CURSOR_KEY_LIVE), null);
  assert.equal(await cursor.get(AIRTABLE_CURSOR_KEY_DRY), "2026-10-12T01:00:00.000Z");
});

test("the poll pages only when the first page is not enough", async () => {
  const first = sampleAirtableRecord();
  first.createdTime = "2026-10-12T01:00:00.000Z";
  const second = sampleAirtableRecord();
  second.id = "recInstructor002";
  second.createdTime = "2026-10-12T02:00:00.000Z";
  const calls: AirtableListArgs[] = [];
  const enqueued: string[] = [];
  const result = await pollNewInstructors({
    airtable: {
      async listRecords(args) {
        calls.push(args);
        if (!args.offset) return { records: [first], offset: "page-2" };
        return { records: [second] };
      },
    },
    cursor: memoryCursor(),
    dryRun: true,
    notBefore: NOT_BEFORE,
    enqueue: async (record) => {
      enqueued.push(record.id);
    },
  });
  assert.equal(calls.length, 2);
  assert.equal(calls[0]?.filterByFormula, createdAfterFormula(NOT_BEFORE));
  assert.equal(calls[1]?.filterByFormula, calls[0]?.filterByFormula);
  assert.equal(calls[1]?.offset, "page-2");
  assert.deepEqual(enqueued, ["recInstructor001", "recInstructor002"]);
  assert.equal(result.watermark, "2026-10-12T02:00:00.000Z");
});

test("the poll lists nothing until the initial cursor is set", async () => {
  const { fake } = runtime({ airtableRecords: [sampleAirtableRecord()] });
  const result = await pollNewInstructors({
    airtable: fake.ports.airtable,
    cursor: memoryCursor(),
    dryRun: true,
    notBefore: null,
    enqueue: async () => {
      throw new Error("should not enqueue");
    },
  });
  assert.equal(result.blocked, true);
  assert.equal(result.reason, AIRTABLE_POLL_BLOCKED_MESSAGE);
  assert.equal(fake.calls.length, 0);
});

test("DRY_RUN logs still mask TFN, bank account, BSB, ABN, and member number", async () => {
  const raw = sampleAirtableRecord();
  const record = parseAirtableRecord(raw);
  const secrets = sentinels(record);
  assert.equal(secrets.length >= 6, true);
  const { fake, deps } = runtime();
  const lines: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => {
    lines.push(args.map((item) => String(item)).join(" "));
  };
  try {
    await runInstructorOnboarding(raw, { ...deps, mode: "shadow" });
  } finally {
    console.log = original;
  }
  const logged = lines.join("\n");
  for (const secret of secrets) {
    assert.equal(logged.includes(secret), false);
  }
  assert.match(logged, /"tfn":true/);
  assert.match(logged, /"bankAccount":true/);
  assert.match(logged, /"bsb":true/);
  assert.match(logged, /"abn":true/);
  assert.match(logged, /"memberNumber":true/);
  assert.equal(fake.calls.length, 0);
});

test("the Airtable adapter sends the created-time filter and still rejects a view", async () => {
  const formula = createdAfterFormula(NOT_BEFORE);
  let seen = "";
  const fetchImpl: typeof fetch = async (input) => {
    seen = String(input);
    return Response.json({ records: [] });
  };
  const listed = await createAirtablePort({ fetch: fetchImpl, token: "test-airtable-token" }).listRecords({
    baseId: AIRTABLE_BASE_ID,
    tableId: AIRTABLE_TABLE_ID,
    includeAttachments: true,
    view: null,
    filterByFormula: formula,
  });
  assert.equal(listed.records.length, 0);
  assert.match(seen, /filterByFormula=/);
  assert.match(seen, /IS_AFTER/);
  assert.equal(seen.includes("view="), false);
  const airtable = createAirtablePort({
    fetch: async () => {
      throw new Error("fetch should not run");
    },
    token: "test-airtable-token",
  });
  await assert.rejects(
    () =>
      airtable.listRecords({
        baseId: AIRTABLE_BASE_ID,
        tableId: AIRTABLE_TABLE_ID,
        includeAttachments: true,
        view: "Grid view" as unknown as null,
        filterByFormula: null,
      }),
    /must not set a view/,
  );
  await assert.rejects(
    () =>
      airtable.listRecords({
        baseId: AIRTABLE_BASE_ID,
        tableId: AIRTABLE_TABLE_ID,
        includeAttachments: true,
        view: null,
        filterByFormula: "Name='Avery'",
      }),
    /CREATED_TIME/,
  );
});

test("the go-live cutoff is the env value passed in, and the production config does not reset live vars", () => {
  const wrangler = readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8");
  const stripped = wrangler.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const config = JSON.parse(stripped) as {
    vars: Record<string, string>;
    env: {
      preview: {
        name: string;
        vars: Record<string, string>;
        triggers: { crons: string[] };
        queues: { consumers: Array<{ queue: string }> };
      };
    };
  };
  assert.equal(config.vars.DRY_RUN, undefined);
  assert.equal(config.vars.SAFETY_NET_NOT_BEFORE, undefined);
  assert.equal(config.env.preview.name, "instructor-onboarding-preview");
  assert.equal(config.env.preview.vars.DRY_RUN, "false");
  assert.equal(config.env.preview.vars.SAFETY_NET_NOT_BEFORE, "2099-01-01T00:00:00Z");
  assert.equal(config.env.preview.vars.SLACK_CHANNEL_ID, "C0C8CEZN64E");
  assert.equal(config.env.preview.vars.SLACK_DRY_RUN_CHANNEL_ID, "C0C8CEZN64E");
  assert.deepEqual(config.env.preview.triggers.crons, []);
  assert.equal(config.env.preview.queues.consumers[0]?.queue, "instructor-onboarding-preview-intake");
  assert.match(wrangler, /--keep-vars/);
  const previewCutoff = "2026-03-01T00:00:00.000Z";
  assert.equal(createdAfterFormula(previewCutoff), "IS_AFTER(CREATED_TIME(), '2026-03-01T00:00:00.000Z')");
  assert.equal(createdAfterFormula(previewCutoff).includes("2026-10-12T09:19:56Z"), false);
  assert.match(wrangler, /"SLACK_CHANNEL_ID": "C09BK6Y2WHL"/);
  assert.match(wrangler, /"SLACK_DRY_RUN_CHANNEL_ID": "C0C8CEZN64E"/);
  assert.equal(wrangler.includes('"SLACK_DRY_RUN_CHANNEL_ID": "C09BK6Y2WHL"'), false);
});
