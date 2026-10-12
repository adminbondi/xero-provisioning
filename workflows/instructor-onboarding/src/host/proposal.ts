import { POLL_INTERVAL_MS } from "../config.ts";

/**
 * Proposal only. Nothing in the runner imports Cloudflare or Render.
 * Thiago picks the host and the trigger.
 */
export const HOSTING_PROPOSAL = {
  status: "proposal",
  decided: false,
  host: {
    proposed: "cloudflare-workers",
    alternative: "render-web-service",
    reason:
      "The workflow is Airtable, Xero Payroll AU, Xero contacts, Slack, and email: HTTPS calls, no Mindbody. The shared-services note already places Slack and email on Cloudflare Workers. A Worker cron or a Worker HTTP route can call the same host-agnostic functions.",
  },
  trigger: {
    proposed: "airtable-poll",
    intervalMs: POLL_INTERVAL_MS,
    alternative: "airtable-webhook",
    reason:
      "The live Zap polls the Instructors table every 2 minutes with no view and no filter. Matching that avoids an Airtable automation change during switchover. The webhook entry point is the same per-record function, and is the better steady state once switchover is explicitly approved.",
  },
} as const;
