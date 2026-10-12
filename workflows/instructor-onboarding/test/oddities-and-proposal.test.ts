import "./block-network.ts";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { AIRTABLE_POLL_CRON } from "../src/config.ts";
import { HOSTING_DECISION } from "../src/host/decision.ts";
import { DESIGN_ADDITIONS, ODDITIES } from "../src/oddities.ts";
import { PIPELINE_STEPS } from "../src/run.ts";

test("hosting is decided and the pipeline is the seven Zap steps", () => {
  assert.equal(HOSTING_DECISION.status, "decided");
  assert.equal(HOSTING_DECISION.decided, true);
  assert.equal(HOSTING_DECISION.host, "cloudflare-worker");
  assert.equal(HOSTING_DECISION.execution, "cloudflare-workflows");
  assert.equal(HOSTING_DECISION.idempotency, "workflow-instance-id");
  assert.equal(HOSTING_DECISION.durableStore, "kv-created-time-watermark");
  assert.equal(HOSTING_DECISION.trigger, "hourly-airtable-poll");
  assert.equal(HOSTING_DECISION.xeroAuth, "oauth-refresh-token");
  assert.equal(HOSTING_DECISION.pollCron, AIRTABLE_POLL_CRON);
  assert.deepEqual(PIPELINE_STEPS, [
    "airtable-record",
    "super-fund",
    "gender",
    "xero-employee",
    "xero-contact",
    "slack",
    "email",
  ]);
  assert.equal(new Set(ODDITIES.map((item) => item.id)).size, ODDITIES.length);
  assert.equal(new Set(DESIGN_ADDITIONS.map((item) => item.id)).size, DESIGN_ADDITIONS.length);
  assert.equal(ODDITIES.some((item) => item.id === "possible-missing-code-step"), false);
});

test("the READMEs name every preserved oddity and design addition", () => {
  const packageReadme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
  const rootReadme = readFileSync(new URL("../../../README.md", import.meta.url), "utf8");
  for (const item of [...ODDITIES, ...DESIGN_ADDITIONS]) {
    assert.equal(packageReadme.includes(item.id), true, item.id);
    assert.equal(rootReadme.includes(item.id), true, item.id);
  }
  assert.match(rootReadme, /Cloudflare Workflows/);
  assert.match(rootReadme, /do not .*switch/i);
  assert.match(rootReadme, /\+614/);
  assert.match(packageReadme, /free plan cannot run scripts/i);
  assert.match(packageReadme, /AIRTABLE_TOKEN/);
});
