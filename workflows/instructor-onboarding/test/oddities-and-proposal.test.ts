import "./block-network.ts";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { HOSTING_PROPOSAL } from "../src/host/proposal.ts";
import { DESIGN_ADDITIONS, ODDITIES } from "../src/oddities.ts";
import { PIPELINE_STEPS } from "../src/run.ts";

test("hosting is a proposal and the pipeline stops before the Jira steps", () => {
  assert.equal(HOSTING_PROPOSAL.status, "proposal");
  assert.equal(HOSTING_PROPOSAL.decided, false);
  assert.equal(HOSTING_PROPOSAL.trigger.intervalMs, 120_000);
  assert.equal(PIPELINE_STEPS.includes("jira" as (typeof PIPELINE_STEPS)[number]), false);
  assert.equal(new Set(ODDITIES.map((item) => item.id)).size, ODDITIES.length);
  assert.equal(new Set(DESIGN_ADDITIONS.map((item) => item.id)).size, DESIGN_ADDITIONS.length);
});

test("the READMEs name every preserved oddity and design addition", () => {
  const packageReadme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
  const rootReadme = readFileSync(new URL("../../../README.md", import.meta.url), "utf8");
  for (const item of [...ODDITIES, ...DESIGN_ADDITIONS]) {
    assert.equal(packageReadme.includes(item.id), true, item.id);
    assert.equal(rootReadme.includes(item.id), true, item.id);
  }
  assert.match(rootReadme, /proposal/i);
  assert.match(rootReadme, /do not .*switch/i);
});
