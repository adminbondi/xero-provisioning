import "./block-network.ts";
import { createFakePorts, type FakeBundle, type FakeOptions } from "../src/fakes.ts";
import { sampleAirtableRecord } from "../src/fixtures/sample-instructor.ts";
import { MemoryWorkflowStore } from "../src/idempotency.ts";
import type { RunDeps } from "../src/run.ts";
import type { AirtableApiRecord } from "../src/types.ts";

export const FIXED_NOW = new Date("2026-10-12T13:30:00.000Z");

export function withFields(
  patch: Record<string, unknown> = {},
  remove: string[] = [],
): AirtableApiRecord {
  const record = sampleAirtableRecord();
  const fields = record.fields as Record<string, unknown>;
  Object.assign(fields, patch);
  for (const key of remove) delete fields[key];
  return record;
}

export function runtime(options?: FakeOptions, extra?: Partial<RunDeps>): { fake: FakeBundle; store: MemoryWorkflowStore; deps: RunDeps } {
  const fake = createFakePorts(options);
  const store = new MemoryWorkflowStore();
  return {
    fake,
    store,
    deps: {
      ports: fake.ports,
      store,
      mode: "live",
      now: () => new Date(FIXED_NOW),
      ...extra,
    },
  };
}
