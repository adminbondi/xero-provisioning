import type { AirtableApiRecord } from "../types.ts";

/** Workflow instance ids: 1–100 characters, letters, digits, dashes, underscores. A colon is not allowed. */
const WORKFLOW_INSTANCE_ID = /^[A-Za-z0-9_-]{1,100}$/;

/** Distinct from the live id. Cloudflare rejects `:`, so this is the `-dry` equivalent of a `:dry` suffix. */
export const DRY_RUN_INSTANCE_SUFFIX = "-dry";

/**
 * Dry run is the default. Only the exact string "false" turns writes on.
 * Unset, empty, and "true" all stay in dry run so the first deploy cannot write by accident.
 */
export function dryRunEnabled(value: string | undefined): boolean {
  return value?.trim().toLowerCase() !== "false";
}

export function workflowInstanceId(recordId: string, dryRun = false): string {
  if (!WORKFLOW_INSTANCE_ID.test(recordId)) {
    throw new Error("Airtable record id cannot be used as a Workflow instance id.");
  }
  if (!dryRun) return recordId;
  const instanceId = `${recordId}${DRY_RUN_INSTANCE_SUFFIX}`;
  if (!WORKFLOW_INSTANCE_ID.test(instanceId) || instanceId === recordId) {
    throw new Error("Dry-run Workflow instance id must not be the bare Airtable record id.");
  }
  return instanceId;
}

export function isWorkflowAlreadyExists(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return /already exists/i.test(error.message) || /instance\.already_exists/i.test(error.message);
}

export function isWorkflowNotFound(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return /not found/i.test(error.message) || /instance\.not_found/i.test(error.message);
}

export interface IntakeMessage {
  record: AirtableApiRecord;
}

export function parseIntakeBody(value: unknown): AirtableApiRecord {
  if (!value || typeof value !== "object") {
    throw new Error("Intake body must be an Airtable record.");
  }
  const body = value as { id?: unknown; createdTime?: unknown; fields?: unknown };
  if (typeof body.id !== "string") {
    throw new Error("Intake body needs a string id.");
  }
  workflowInstanceId(body.id);
  if (body.fields == null || typeof body.fields !== "object" || Array.isArray(body.fields)) {
    throw new Error("Intake body needs a fields object.");
  }
  const record: AirtableApiRecord = {
    id: body.id,
    fields: body.fields as Record<string, unknown>,
  };
  if (body.createdTime != null) {
    if (typeof body.createdTime !== "string") throw new Error("createdTime must be a string.");
    record.createdTime = body.createdTime;
  }
  return record;
}

/**
 * Hash both sides before comparing so a length mismatch does not leak the secret.
 * An empty expected token never matches.
 */
export async function bearerMatches(authorization: string | null, expected: string): Promise<boolean> {
  if (!expected) return false;
  const provided = authorization?.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : "";
  const encoder = new TextEncoder();
  const [providedHash, expectedHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(provided)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  return hashesEqual(providedHash, expectedHash);
}

function hashesEqual(left: ArrayBuffer, right: ArrayBuffer): boolean {
  const subtle = crypto.subtle as {
    timingSafeEqual?: (a: ArrayBuffer, b: ArrayBuffer) => boolean;
  };
  if (typeof subtle.timingSafeEqual === "function") {
    return subtle.timingSafeEqual(left, right);
  }
  const a = new Uint8Array(left);
  const b = new Uint8Array(right);
  let diff = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i += 1) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

export interface IntakeDeps {
  ingressToken: string;
  enqueue(record: AirtableApiRecord): Promise<void>;
}

export async function handleIntake(request: Request, deps: IntakeDeps): Promise<Response> {
  if (request.method !== "POST") {
    return Response.json({ error: "POST /intake only." }, { status: 405 });
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
  let record: AirtableApiRecord;
  try {
    record = parseIntakeBody(body);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid intake body.";
    return Response.json({ error: message }, { status: 400 });
  }
  await deps.enqueue(record);
  return Response.json({ accepted: true, recordId: record.id }, { status: 202 });
}
