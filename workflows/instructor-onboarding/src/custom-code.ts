import type { InstructorRecord } from "./types.ts";

/**
 * Slot for the custom code step Thiago thinks the live Zap had.
 * The published map does not include one. The default is a no-op.
 * A follow-up can pass a different function, or replace `steps` on the runner,
 * without rewriting the Xero, Slack, or email steps.
 */
export interface CustomCodeContext {
  record: InstructorRecord;
  superFundId: string;
  genderCode: string;
  startDate: string;
}

export type CustomCodeStep = (ctx: CustomCodeContext) => CustomCodeContext | Promise<CustomCodeContext>;

export const passthroughCustomCode: CustomCodeStep = (ctx) => ctx;
