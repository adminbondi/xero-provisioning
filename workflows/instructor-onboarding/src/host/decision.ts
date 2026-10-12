import { AIRTABLE_POLL_CRON } from "../config.ts";

/**
 * Decided host for Zap 364623444 steps 1–7.
 * Not deployed. Tests do not call Cloudflare.
 */
export const HOSTING_DECISION = {
  status: "decided",
  decided: true,
  host: "cloudflare-worker",
  trigger: "hourly-airtable-poll",
  execution: "cloudflare-workflows",
  queue: "instructor-onboarding-intake",
  deadLetterQueue: "instructor-onboarding-intake-dlq",
  idempotency: "workflow-instance-id",
  durableStore: "kv-created-time-watermark",
  pollCron: AIRTABLE_POLL_CRON,
  xeroAuth: "oauth-refresh-token",
  dryRunDefault: true,
  dryRunInstanceSuffix: "-dry",
} as const;
