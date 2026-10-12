import "./block-network.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { sampleAirtableRecord } from "../src/fixtures/sample-instructor.ts";
import { startWorkflowForRecord } from "../src/host/queue-consumer.ts";
import { runInstructorOnboarding } from "../src/run.ts";
import { runtime } from "./helpers.ts";

test("a failed instance can run again without creating a second employee", async () => {
  const record = sampleAirtableRecord();
  const { fake, deps } = runtime();
  const first = await runInstructorOnboarding(record, deps);
  assert.equal(first.employee.created, true);
  assert.equal(fake.calls.filter((call) => call.method === "createEmployee").length, 1);

  const started: string[] = [];
  const failed = new Set<string>([record.id]);
  const start = async (id: string) => {
    if (failed.has(id) || started.includes(id)) throw new Error("Workflow instance already exists");
    started.push(id);
  };
  const rerun = await startWorkflowForRecord(record, start, {
    instanceStatus: async (id) => (failed.has(id) ? "errored" : "unknown"),
  });
  assert.equal(rerun.result, "rerun");
  assert.equal(rerun.instanceId, `${record.id}-retry-1`);
  assert.deepEqual(started, [`${record.id}-retry-1`]);

  const second = await runInstructorOnboarding(record, deps);
  assert.equal(second.employee.action, "skip-email");
  assert.equal(second.employee.created, false);
  assert.equal(second.employee.employeeId, first.employee.employeeId);
  assert.equal(fake.calls.filter((call) => call.method === "createEmployee").length, 1);
  assert.equal(fake.employees.length, 1);
});

test("a finished instance stays a duplicate, and a failed dry-run instance uses its own retry id", async () => {
  const record = sampleAirtableRecord();
  const started: string[] = [record.id];
  const start = async (id: string) => {
    if (started.includes(id)) throw new Error("instance.already_exists");
    started.push(id);
  };
  const finished = await startWorkflowForRecord(record, start, {
    instanceStatus: async () => "complete",
  });
  assert.equal(finished.result, "duplicate");
  assert.equal(finished.instanceId, record.id);

  const dryId = `${record.id}-dry`;
  const dryStarted: string[] = [dryId];
  const dryStart = async (id: string) => {
    if (dryStarted.includes(id)) throw new Error("Workflow instance already exists");
    dryStarted.push(id);
  };
  const dry = await startWorkflowForRecord(record, dryStart, {
    dryRun: true,
    instanceStatus: async (id) => (id === dryId ? "terminated" : "unknown"),
  });
  assert.equal(dry.result, "rerun");
  assert.equal(dry.instanceId, `${dryId}-retry-1`);
  assert.notEqual(dry.instanceId, record.id);
});
