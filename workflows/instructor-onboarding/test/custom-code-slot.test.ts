import "./block-network.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { sampleAirtableRecord } from "../src/fixtures/sample-instructor.ts";
import { CustomCodeError } from "../src/errors.ts";
import { createDefaultSteps, PIPELINE_STEPS, runInstructorOnboarding } from "../src/run.ts";
import { runtime } from "./helpers.ts";

test("the default custom-code slot is a no-op and can be replaced without rewriting Xero steps", async () => {
  const { deps } = runtime();
  const result = await runInstructorOnboarding(sampleAirtableRecord(), {
    ...deps,
    customCode: (ctx) => ({ ...ctx, startDate: "2024-01-02", record: { ...ctx.record, firstName: "Quinn" } }),
  });
  assert.equal(result.customCodeApplied, true);
  assert.equal(result.flags.includes("possible-missing-code-step"), false);
  assert.equal(result.startDate.resolved, "2024-01-02");
  assert.equal(result.startDate.overriddenByCustomCode, true);
  assert.equal(result.employee.payload.FirstName, "Quinn");
  assert.equal(result.contact.payload.FirstName, "Quinn");
  assert.equal(result.employee.payload.Gender, "F");
});

test("a failing custom-code step runs before any Xero, Slack, or email call", async () => {
  const { fake, deps } = runtime();
  await assert.rejects(
    () =>
      runInstructorOnboarding(sampleAirtableRecord(), {
        ...deps,
        customCode: () => {
          throw new Error("formatter blew up");
        },
      }),
    (error: unknown) => error instanceof CustomCodeError && /formatter blew up/.test(error.message),
  );
  assert.equal(fake.calls.length, 0);
});

test("a follow-up step can be inserted after gender lookup without rewriting the other steps", async () => {
  const steps = createDefaultSteps();
  const index = steps.findIndex((step) => step.name === "custom-code");
  steps.splice(index + 1, 0, {
    name: "follow-up-code",
    async run(ctx) {
      ctx.record = { ...ctx.record!, lastName: "Inserted" };
    },
  });
  const { deps } = runtime();
  const result = await runInstructorOnboarding(sampleAirtableRecord(), { ...deps, steps });
  assert.deepEqual(result.steps, [
    "airtable-record",
    "super-fund",
    "gender",
    "custom-code",
    "follow-up-code",
    "xero-employee",
    "xero-contact",
    "slack",
    "email",
  ]);
  assert.deepEqual([...PIPELINE_STEPS], [
    "airtable-record",
    "super-fund",
    "gender",
    "custom-code",
    "xero-employee",
    "xero-contact",
    "slack",
    "email",
  ]);
  assert.equal(result.employee.payload.LastName, "Inserted");
  assert.equal(result.contact.payload.Name, "Avery Inserted");
});
