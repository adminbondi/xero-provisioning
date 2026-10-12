import { bearerMatches, workflowInstanceId } from "./intake.ts";
import type { PayrollFieldPresence } from "../sensitive.ts";
import type { AirtableApiRecord, WorkflowSuccess } from "../types.ts";

/**
 * POST /run processes one Airtable record id immediately.
 * It does not read or write the hourly KV cursors (`created-after:dry`, `created-after:live`).
 * The Workflow instance id is the dedupe lock. A second call does not run again.
 * Dry run may execute the shadow pipeline for the response. Live only starts the Workflow.
 */

export interface ManualShadowSummary {
  matchDisposition: "create" | "skip-email" | "hold-name";
  matchReason: "dry-run" | "no-match" | "email" | "name";
  employeeIds: string[];
  contactIds: string[];
  employeeAction: string;
  contactAction: string;
  slackChannel: string;
  slackSent: boolean;
  held: boolean;
  present: PayrollFieldPresence;
}

export interface ManualRunDeps {
  ingressToken: string;
  dryRun: boolean;
  slackChannelId: string;
  loadRecord(recordId: string): Promise<AirtableApiRecord>;
  startWorkflow(record: AirtableApiRecord): Promise<"started" | "duplicate">;
  /** Dry-run only. Live leaves this unset so the request does not write to Xero. */
  runShadow?(record: AirtableApiRecord): Promise<ManualShadowSummary>;
}

/** Whitelisted summary. The Xero payload is not copied onto the response. */
export function summariseParsed(result: WorkflowSuccess, present: PayrollFieldPresence): ManualShadowSummary {
  return {
    matchDisposition: result.match.disposition,
    matchReason: result.match.reason,
    employeeIds: [...result.match.employeeIds],
    contactIds: [...result.match.contactIds],
    employeeAction: result.employee.action,
    contactAction: result.contact.action,
    slackChannel: result.slack.channel,
    slackSent: result.slack.sent,
    held: result.match.disposition === "hold-name",
    present,
  };
}

export async function handleManualRun(request: Request, deps: ManualRunDeps): Promise<Response> {
  if (request.method !== "POST") {
    return Response.json({ error: "POST /run only." }, { status: 405 });
  }
  if (!deps.ingressToken) {
    return Response.json({ error: "Ingress token is not configured." }, { status: 503 });
  }
  const allowed = await bearerMatches(request.headers.get("authorization"), deps.ingressToken);
  if (!allowed) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Body must be JSON." }, { status: 400 });
  }
  const recordId = recordIdFromBody(body);
  if (recordId instanceof Response) return recordId;
  let record: AirtableApiRecord;
  try {
    record = await deps.loadRecord(recordId);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Airtable record could not be loaded.";
    return Response.json({ error: message }, { status: 502 });
  }
  if (record.id !== recordId) {
    return Response.json({ error: "Airtable returned a different record." }, { status: 502 });
  }
  const instanceId = workflowInstanceId(record.id, deps.dryRun);
  let outcome: "started" | "duplicate";
  try {
    outcome = await deps.startWorkflow(record);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Workflow could not be started.";
    return Response.json({ error: message }, { status: 502 });
  }
  if (outcome === "duplicate") {
    return Response.json(manualBody(deps, record.id, instanceId, true, null), { status: 200 });
  }
  let summary: ManualShadowSummary | null = null;
  if (deps.dryRun && deps.runShadow) {
    try {
      summary = await deps.runShadow(record);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Dry run failed.";
      return Response.json({ error: message, recordId: record.id, instanceId, duplicate: false }, { status: 422 });
    }
  }
  return Response.json(manualBody(deps, record.id, instanceId, false, summary), { status: 202 });
}

function manualBody(
  deps: ManualRunDeps,
  recordId: string,
  instanceId: string,
  duplicate: boolean,
  summary: ManualShadowSummary | null,
): Record<string, unknown> {
  return {
    accepted: true,
    dryRun: deps.dryRun,
    duplicate,
    recordId,
    instanceId,
    slackChannel: summary?.slackChannel ?? deps.slackChannelId,
    matchDisposition: summary?.matchDisposition ?? null,
    matchReason: summary?.matchReason ?? null,
    employeeIds: summary?.employeeIds ?? [],
    contactIds: summary?.contactIds ?? [],
    employeeAction: summary?.employeeAction ?? null,
    contactAction: summary?.contactAction ?? null,
    slackSent: summary?.slackSent ?? false,
    held: summary?.held ?? false,
    present: summary?.present ?? null,
  };
}

function recordIdFromBody(value: unknown): string | Response {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return Response.json({ error: "Body must be a JSON object with recordId." }, { status: 400 });
  }
  const recordId = (value as { recordId?: unknown }).recordId;
  if (typeof recordId !== "string" || recordId.trim() !== recordId || recordId.length === 0) {
    return Response.json({ error: "recordId must be a string." }, { status: 400 });
  }
  try {
    workflowInstanceId(recordId);
  } catch (error) {
    const message = error instanceof Error ? error.message : "recordId is not a Workflow instance id.";
    return Response.json({ error: message }, { status: 400 });
  }
  return recordId;
}
