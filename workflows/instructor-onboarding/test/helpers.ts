import "./block-network.ts";
import { defaultConfig } from "../src/config.ts";
import { createFakePorts, type FakeBundle, type FakeOptions } from "../src/fakes.ts";
import { sampleAirtableRecord } from "../src/fixtures/sample-instructor.ts";
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

export function runtime(options?: FakeOptions, extra?: Partial<RunDeps>): { fake: FakeBundle; deps: RunDeps } {
  const fake = createFakePorts(options);
  return {
    fake,
    deps: {
      ports: fake.ports,
      mode: "live",
      now: () => new Date(FIXED_NOW),
      ...extra,
      config: { ...defaultConfig(), payrollCalendarId: "cal-weekly", ...extra?.config },
    },
  };
}
