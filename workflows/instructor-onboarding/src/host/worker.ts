/**
 * Cloudflare Worker for instructor onboarding.
 *
 * scheduled: once an hour, list new Instructors rows and enqueue them. One cron.
 * queue: starts one Workflow instance. Live id is the Airtable record id. Dry-run id is that id plus `-dry`.
 * fetch: POST /intake still accepts a row. POST /run processes one record id now.
 * The Airtable automation is not used.
 *
 * Tests do not import this file. They call the functions it uses, with fakes.
 */
import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { NonRetryableError } from "cloudflare:workflows";
import { parseAirtableRecord } from "../airtable/parse-record.ts";
import { AIRTABLE_BASE_ID, AIRTABLE_POLL_CRON, AIRTABLE_TABLE_ID, resolveConfig, slackChannelForRun } from "../config.ts";
import { isTerminalWorkflowError } from "../errors.ts";
import { payrollFieldPresence } from "../sensitive.ts";
import { pollNewInstructors } from "./airtable-poll.ts";
import { dryRunPorts } from "./dry-run-ports.ts";
import { bindFetch, createAirtablePort, createLivePorts, fetchAirtableRecord, missingLiveEnv, type LiveEnv } from "./http.ts";
import { dryRunEnabled, handleIntake } from "./intake.ts";
import { isolateOauthSession, kvRefreshTokenStore } from "./xero-refresh.ts";
import { handleManualRun, summariseParsed } from "./manual-run.ts";
import { readWorkflowPhase, startWorkflowForRecord } from "./queue-consumer.ts";
import { runOnboardingSteps, type RunDeps, type StepDo } from "../run.ts";
import type { AirtableApiRecord } from "../types.ts";
import type { KvNamespace, MessageBatch, QueueBinding, WorkflowBinding } from "cloudflare:workers";

export { AIRTABLE_POLL_CRON };

export interface Env extends LiveEnv {
  ONBOARDING_WORKFLOW: WorkflowBinding<AirtableApiRecord>;
  INTAKE_QUEUE: QueueBinding<AirtableApiRecord>;
  /** Created-time watermark, Slack send claims, and the Xero refresh token. Not the duplicate lock. */
  AIRTABLE_CURSOR: KvNamespace;
  INGRESS_TOKEN: string;
  /** Default true. Only the string "false" allows Xero, Slack, and Gmail writes. */
  DRY_RUN?: string;
  XERO_WEEKLY_PAYROLL_CALENDAR_ID: string;
  SAFETY_NET_NOT_BEFORE?: string;
  XERO_ORG_SHORTCODE?: string;
  /** Live Slack channel. Required when DRY_RUN is false. */
  SLACK_CHANNEL_ID?: string;
  /** Preview and dry-run Slack channel. Required when DRY_RUN is on. Never falls through to the live channel. */
  SLACK_DRY_RUN_CHANNEL_ID?: string;
  EMAIL_FROM?: string;
  EMAIL_FROM_NAME?: string;
  EMAIL_CC?: string;
  EMAIL_BCC?: string;
  START_DATE_TIMEZONE?: string;
  AIRTABLE_BASE_ID?: string;
  AIRTABLE_TABLE_ID?: string;
  CONFLUENCE_GUIDE_URL?: string;
  /** Placeholder. DRY_RUN does not POST. Unset until Thiago provides the Patty routine URL. */
  PATTY_WEBHOOK_URL?: string;
  PATTY_WEBHOOK_SIGNING_SECRET?: string;
}

function envRecord(env: Env): Record<string, string | undefined> {
  return {
    AIRTABLE_TOKEN: env.AIRTABLE_TOKEN,
    XERO_CLIENT_ID: env.XERO_CLIENT_ID,
    XERO_CLIENT_SECRET: env.XERO_CLIENT_SECRET,
    XERO_REFRESH_TOKEN: env.XERO_REFRESH_TOKEN,
    XERO_TENANT_ID: env.XERO_TENANT_ID,
    SLACK_BOT_TOKEN: env.SLACK_BOT_TOKEN,
    GMAIL_CLIENT_ID: env.GMAIL_CLIENT_ID,
    GMAIL_CLIENT_SECRET: env.GMAIL_CLIENT_SECRET,
    GMAIL_REFRESH_TOKEN: env.GMAIL_REFRESH_TOKEN,
    XERO_ORG_SHORTCODE: env.XERO_ORG_SHORTCODE,
    SLACK_CHANNEL_ID: env.SLACK_CHANNEL_ID,
    EMAIL_FROM: env.EMAIL_FROM,
    EMAIL_FROM_NAME: env.EMAIL_FROM_NAME,
    EMAIL_CC: env.EMAIL_CC,
    EMAIL_BCC: env.EMAIL_BCC,
    START_DATE_TIMEZONE: env.START_DATE_TIMEZONE,
    AIRTABLE_BASE_ID: env.AIRTABLE_BASE_ID,
    AIRTABLE_TABLE_ID: env.AIRTABLE_TABLE_ID,
    CONFLUENCE_GUIDE_URL: env.CONFLUENCE_GUIDE_URL,
    XERO_WEEKLY_PAYROLL_CALENDAR_ID: env.XERO_WEEKLY_PAYROLL_CALENDAR_ID,
    PATTY_WEBHOOK_URL: env.PATTY_WEBHOOK_URL,
    PATTY_WEBHOOK_SIGNING_SECRET: env.PATTY_WEBHOOK_SIGNING_SECRET,
  };
}

function workflowDeps(env: Env): RunDeps {
  const dryRun = dryRunEnabled(env.DRY_RUN);
  const config = resolveConfig(envRecord(env));
  config.slackChannelId = slackChannelForRun(env, dryRun);
  if (dryRun) {
    return { ports: dryRunPorts(), mode: "shadow", config };
  }
  const missing = missingLiveEnv(envRecord(env));
  if (missing.length > 0) {
    throw new Error(`Missing Worker secrets: ${missing.join(", ")}`);
  }
  return {
    ports: createLivePorts(envRecord(env), bindFetch(fetch), {
      slackOnce: env.AIRTABLE_CURSOR,
      xeroRefresh: kvRefreshTokenStore(env.AIRTABLE_CURSOR),
      oauthSession: isolateOauthSession,
    }),
    mode: "live",
    config,
  };
}

function bindStep(step: WorkflowStep): StepDo {
  return {
    do(name, config, callback) {
      return step.do(name, config, async () => {
        try {
          return await callback();
        } catch (error) {
          if (isTerminalWorkflowError(error)) {
            const message = error instanceof Error ? error.message : String(error);
            throw new NonRetryableError(message);
          }
          throw error;
        }
      });
    },
  };
}

export class InstructorOnboardingWorkflow extends WorkflowEntrypoint<Env, AirtableApiRecord> {
  async run(event: WorkflowEvent<AirtableApiRecord>, step: WorkflowStep): Promise<void> {
    await runOnboardingSteps(event.payload, workflowDeps(this.env), bindStep(step));
  }
}

async function onFetch(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === "/run") return onManualRun(request, env);
  if (url.pathname !== "/intake") {
    return Response.json({ error: "Not found." }, { status: 404 });
  }
  return handleIntake(request, {
    ingressToken: env.INGRESS_TOKEN,
    enqueue: (record) => env.INTAKE_QUEUE.send(record),
  });
}

async function onManualRun(request: Request, env: Env): Promise<Response> {
  const dryRun = dryRunEnabled(env.DRY_RUN);
  let slackChannelId: string;
  try {
    slackChannelId = slackChannelForRun(env, dryRun);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Slack channel is not configured.";
    return Response.json({ error: message }, { status: 503 });
  }
  if (!env.AIRTABLE_TOKEN) {
    return Response.json({ error: "AIRTABLE_TOKEN is not set." }, { status: 503 });
  }
  return handleManualRun(request, {
    ingressToken: env.INGRESS_TOKEN,
    dryRun,
    slackChannelId,
    loadRecord: (recordId) =>
      fetchAirtableRecord({
        fetch: bindFetch(fetch),
        token: env.AIRTABLE_TOKEN,
        baseId: env.AIRTABLE_BASE_ID || AIRTABLE_BASE_ID,
        tableId: env.AIRTABLE_TABLE_ID || AIRTABLE_TABLE_ID,
        recordId,
      }),
    startWorkflow: (record) => startRecord(env, record, dryRun),
    runShadow: dryRun
      ? async (record) => {
          const parsed = parseAirtableRecord(record);
          const result = await runOnboardingSteps(record, workflowDeps(env));
          return summariseParsed(result, payrollFieldPresence(parsed));
        }
      : undefined,
  });
}

async function onQueue(batch: MessageBatch<AirtableApiRecord>, env: Env): Promise<void> {
  for (const message of batch.messages) {
    try {
      const dryRun = dryRunEnabled(env.DRY_RUN);
      const outcome = await startRecord(env, message.body, dryRun);
      console.log(
        JSON.stringify({
          event: outcome.result === "duplicate" ? "workflow-duplicate" : outcome.result === "rerun" ? "workflow-rerun" : "workflow-started",
          recordId: message.body.id,
          instanceId: outcome.instanceId,
          dryRun,
        }),
      );
      message.ack();
    } catch (error) {
      console.log(
        JSON.stringify({
          event: "workflow-start-failed",
          recordId: message.body?.id,
          message: error instanceof Error ? error.message : String(error),
        }),
      );
      message.retry();
    }
  }
}

function startRecord(env: Env, record: AirtableApiRecord, dryRun: boolean) {
  return startWorkflowForRecord(
    record,
    (id, payload) => env.ONBOARDING_WORKFLOW.create({ id, params: payload }).then(() => undefined),
    {
      dryRun,
      instanceStatus: (id) => readWorkflowPhase((instanceId) => env.ONBOARDING_WORKFLOW.get(instanceId), id),
    },
  );
}

async function onScheduled(cron: string, env: Env): Promise<void> {
  if (cron !== AIRTABLE_POLL_CRON) return;
  if (!env.AIRTABLE_TOKEN) {
    console.log(JSON.stringify({ event: "airtable-poll-blocked", message: "AIRTABLE_TOKEN is not set." }));
    return;
  }
  const dryRun = dryRunEnabled(env.DRY_RUN);
  const result = await pollNewInstructors({
    airtable: createAirtablePort({ fetch: bindFetch(fetch), token: env.AIRTABLE_TOKEN }),
    cursor: env.AIRTABLE_CURSOR,
    dryRun,
    notBefore: env.SAFETY_NET_NOT_BEFORE ?? null,
    baseId: env.AIRTABLE_BASE_ID,
    tableId: env.AIRTABLE_TABLE_ID,
    enqueue: (record) => env.INTAKE_QUEUE.send(record),
  });
  console.log(
    JSON.stringify({
      event: "airtable-poll",
      dryRun,
      blocked: result.blocked,
      truncated: result.truncated,
      pages: result.pages,
      enqueued: result.enqueued.length,
    }),
  );
}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return onFetch(request, env);
  },
  queue(batch: MessageBatch<AirtableApiRecord>, env: Env): Promise<void> {
    return onQueue(batch, env);
  },
  scheduled(controller: { cron: string }, env: Env): Promise<void> {
    return onScheduled(controller.cron, env);
  },
};
