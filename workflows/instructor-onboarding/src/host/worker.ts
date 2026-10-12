/**
 * Cloudflare Worker for instructor onboarding.
 *
 * fetch: Airtable automation posts the new row. The handler checks a bearer token and enqueues it.
 * queue: starts one Workflow instance. The instance id is the Airtable record id.
 * scheduled: daily safety net for rows that never reached the queue.
 *
 * Tests do not import this file. They call the functions it uses, with fakes.
 */
import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { NonRetryableError } from "cloudflare:workflows";
import { resolveConfig, SAFETY_NET_CRON } from "../config.ts";
import { isTerminalWorkflowError } from "../errors.ts";
import { createLivePorts, missingLiveEnv, type LiveEnv } from "./http.ts";
import { handleIntake } from "./intake.ts";
import { startWorkflowForRecord } from "./queue-consumer.ts";
import { runSafetyNet } from "./safety-net.ts";
import { runOnboardingSteps, type RunDeps, type StepDo } from "../run.ts";
import type { AirtableApiRecord } from "../types.ts";
import type { MessageBatch, QueueBinding, WorkflowBinding } from "cloudflare:workers";

export { SAFETY_NET_CRON };

export interface Env extends LiveEnv {
  ONBOARDING_WORKFLOW: WorkflowBinding<AirtableApiRecord>;
  INTAKE_QUEUE: QueueBinding<AirtableApiRecord>;
  INGRESS_TOKEN: string;
  XERO_WEEKLY_PAYROLL_CALENDAR_ID: string;
  SAFETY_NET_NOT_BEFORE?: string;
  XERO_ORG_SHORTCODE?: string;
  SLACK_CHANNEL_ID?: string;
  EMAIL_FROM?: string;
  EMAIL_FROM_NAME?: string;
  EMAIL_CC?: string;
  EMAIL_BCC?: string;
  START_DATE_TIMEZONE?: string;
  AIRTABLE_BASE_ID?: string;
  AIRTABLE_TABLE_ID?: string;
  CONFLUENCE_GUIDE_URL?: string;
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
  };
}

function liveDeps(env: Env): RunDeps {
  const missing = missingLiveEnv(envRecord(env));
  if (missing.length > 0) {
    throw new Error(`Missing Worker secrets: ${missing.join(", ")}`);
  }
  return {
    ports: createLivePorts(envRecord(env), fetch),
    mode: "live",
    config: resolveConfig(envRecord(env)),
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
    await runOnboardingSteps(event.payload, liveDeps(this.env), bindStep(step));
  }
}

async function onFetch(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname !== "/intake") {
    return Response.json({ error: "Not found." }, { status: 404 });
  }
  return handleIntake(request, {
    ingressToken: env.INGRESS_TOKEN,
    enqueue: (record) => env.INTAKE_QUEUE.send(record),
  });
}

async function onQueue(batch: MessageBatch<AirtableApiRecord>, env: Env): Promise<void> {
  for (const message of batch.messages) {
    try {
      const outcome = await startWorkflowForRecord(message.body, (id, record) =>
        env.ONBOARDING_WORKFLOW.create({ id, params: record }).then(() => undefined),
      );
      console.log(JSON.stringify({ event: outcome === "duplicate" ? "workflow-duplicate" : "workflow-started", recordId: message.body.id }));
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

async function onScheduled(env: Env): Promise<void> {
  const missing = missingLiveEnv(envRecord(env));
  if (missing.length > 0) {
    console.log(JSON.stringify({ event: "safety-net-blocked", message: `Missing secrets: ${missing.join(", ")}` }));
    return;
  }
  const ports = createLivePorts(envRecord(env), fetch);
  const result = await runSafetyNet({
    airtable: ports.airtable,
    notBefore: env.SAFETY_NET_NOT_BEFORE ?? null,
    baseId: env.AIRTABLE_BASE_ID,
    tableId: env.AIRTABLE_TABLE_ID,
    hasWorkflow: async (recordId) => {
      try {
        const instance = await env.ONBOARDING_WORKFLOW.get(recordId);
        await instance.status();
        return true;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (/not found/i.test(message)) return false;
        throw error;
      }
    },
    enqueue: (record) => env.INTAKE_QUEUE.send(record),
  });
  console.log(
    JSON.stringify({
      event: "safety-net",
      blocked: result.blocked,
      truncated: result.truncated,
      enqueued: result.results.filter((item) => item.status === "enqueued").length,
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
    console.log(JSON.stringify({ event: "safety-net-cron", cron: controller.cron }));
    return onScheduled(env);
  },
};
