import "./block-network.ts";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { parseAirtableRecord } from "../src/airtable/parse-record.ts";
import { sampleAirtableRecord } from "../src/fixtures/sample-instructor.ts";
import { handleManualRun, summariseParsed } from "../src/host/manual-run.ts";
import { workflowInstanceId } from "../src/host/intake.ts";
import { payrollFieldPresence } from "../src/sensitive.ts";
import { runInstructorOnboarding } from "../src/run.ts";
import { runtime } from "./helpers.ts";

test("a manual dry run processes one record once and a second call is a duplicate", async () => {
  const source = readFileSync(new URL("../src/host/manual-run.ts", import.meta.url), "utf8");
  assert.equal(source.includes("AIRTABLE_CURSOR"), false);
  assert.equal(source.includes(".put("), false);
  assert.match(source, /created-after:dry/);
  assert.match(source, /created-after:live/);

  const record = sampleAirtableRecord();
  const parsed = parseAirtableRecord(record);
  const started: string[] = [];
  let shadows = 0;
  const request = () =>
    new Request("https://worker.example/run", {
      method: "POST",
      headers: { authorization: "Bearer studio-token", "content-type": "application/json" },
      body: JSON.stringify({ recordId: record.id }),
    });
  const deps = {
    ingressToken: "studio-token",
    dryRun: true,
    slackChannelId: "C-DRY",
    loadRecord: async (id: string) => ({ ...record, id }),
    startWorkflow: async (item: typeof record) => {
      const instanceId = workflowInstanceId(item.id, true);
      if (started.includes(instanceId)) return { result: "duplicate" as const, instanceId };
      started.push(instanceId);
      return { result: "started" as const, instanceId };
    },
    runShadow: async () => {
      shadows += 1;
      const { deps: runDeps } = runtime();
      const result = await runInstructorOnboarding(record, { ...runDeps, mode: "shadow", config: { ...runDeps.config!, slackChannelId: "C-DRY" } });
      return summariseParsed(result, payrollFieldPresence(parsed));
    },
  };

  const first = await handleManualRun(request(), deps);
  assert.equal(first.status, 202);
  const firstBody = await first.json() as {
    duplicate: boolean;
    instanceId: string;
    dryRun: boolean;
    matchDisposition: string;
    slackChannel: string;
    employeeAction: string;
    present: { tfn: boolean; bankAccount: boolean };
  };
  assert.equal(firstBody.duplicate, false);
  assert.equal(firstBody.dryRun, true);
  assert.equal(firstBody.instanceId, "recInstructor001-dry");
  assert.equal(firstBody.matchDisposition, "create");
  assert.equal(firstBody.slackChannel, "C-DRY");
  assert.equal(firstBody.employeeAction, "create");
  assert.equal(firstBody.present.tfn, true);
  assert.equal(firstBody.present.bankAccount, true);
  assert.equal(shadows, 1);
  const encoded = JSON.stringify(firstBody);
  for (const secret of [parsed.tfn, parsed.account, parsed.bsb, parsed.abn, parsed.memberNumber]) {
    assert.equal(encoded.includes(secret), false);
  }

  const second = await handleManualRun(request(), deps);
  assert.equal(second.status, 200);
  const secondBody = await second.json() as { duplicate: boolean; matchDisposition: string | null };
  assert.equal(secondBody.duplicate, true);
  assert.equal(secondBody.matchDisposition, null);
  assert.equal(shadows, 1);
  assert.deepEqual(started, ["recInstructor001-dry"]);
});

test("a live manual run starts the workflow and does not run the shadow pipeline", async () => {
  let shadows = 0;
  const response = await handleManualRun(
    new Request("https://worker.example/run", {
      method: "POST",
      headers: { authorization: "Bearer studio-token", "content-type": "application/json" },
      body: JSON.stringify({ recordId: "recInstructor001" }),
    }),
    {
      ingressToken: "studio-token",
      dryRun: false,
      slackChannelId: "C09BK6Y2WHL",
      loadRecord: async () => sampleAirtableRecord(),
      startWorkflow: async () => ({ result: "started" as const, instanceId: "recInstructor001" }),
      runShadow: async () => {
        shadows += 1;
        throw new Error("live manual run must not execute inline");
      },
    },
  );
  assert.equal(response.status, 202);
  const body = await response.json() as { dryRun: boolean; duplicate: boolean; instanceId: string; matchDisposition: null };
  assert.equal(body.dryRun, false);
  assert.equal(body.duplicate, false);
  assert.equal(body.instanceId, "recInstructor001");
  assert.equal(body.matchDisposition, null);
  assert.equal(shadows, 0);
});

test("manual run rejects a missing token", async () => {
  const response = await handleManualRun(
    new Request("https://worker.example/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ recordId: "recInstructor001" }),
    }),
    {
      ingressToken: "studio-token",
      dryRun: true,
      slackChannelId: "C-DRY",
      loadRecord: async () => sampleAirtableRecord(),
      startWorkflow: async () => ({ result: "started" as const, instanceId: "recInstructor001-dry" }),
    },
  );
  assert.equal(response.status, 401);
});
