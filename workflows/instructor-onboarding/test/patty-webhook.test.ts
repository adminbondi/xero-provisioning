import "./block-network.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { parseAirtableRecord } from "../src/airtable/parse-record.ts";
import { sampleAirtableRecord } from "../src/fixtures/sample-instructor.ts";
import { runInstructorOnboarding } from "../src/run.ts";
import { runtime } from "./helpers.ts";

test("an unset Patty webhook URL skips the live step and does not post", async () => {
  const record = parseAirtableRecord(sampleAirtableRecord());
  const lines: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => {
    lines.push(args.map((item) => String(item)).join(" "));
  };
  try {
    const { fake, deps } = runtime();
    const result = await runInstructorOnboarding(sampleAirtableRecord(), {
      ...deps,
      config: { ...deps.config!, pattyWebhookUrl: undefined },
    });
    assert.equal(result.webhook.posted, false);
    assert.equal(result.webhook.payload.emergencyContactName, "Sam Nguyen");
    assert.equal(fake.calls.some((call) => call.port === "webhook"), false);
    assert.equal(fake.webhooks.length, 0);
    const logged = lines.join("\n");
    assert.match(logged, /"event":"patty-webhook-skipped"/);
    assert.match(logged, /"recordId":"recInstructor001"/);
    for (const secret of [record.tfn, record.account, record.bsb, record.abn, record.memberNumber]) {
      assert.equal(logged.includes(secret), false);
    }
  } finally {
    console.log = original;
  }
});
