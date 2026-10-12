import { isWorkflowAlreadyExists, isWorkflowNotFound, workflowInstanceId } from "./intake.ts";
import type { AirtableApiRecord } from "../types.ts";

export type StartWorkflow = (instanceId: string, record: AirtableApiRecord) => Promise<void>;

/** Cloudflare Workflow instance status. Only a failed instance may be started again. */
export type InstancePhase =
  | "queued"
  | "running"
  | "paused"
  | "errored"
  | "terminated"
  | "complete"
  | "waiting"
  | "unknown";

export interface WorkflowStart {
  result: "started" | "duplicate" | "rerun";
  instanceId: string;
}

const FAILED_PHASE = new Set<InstancePhase>(["errored", "terminated"]);
const RETRY_CAP = 5;

function phaseOf(value: unknown): InstancePhase {
  if (typeof value === "string") return value as InstancePhase;
  if (value && typeof value === "object" && "status" in value) {
    const status = (value as { status?: unknown }).status;
    if (typeof status === "string") return status as InstancePhase;
  }
  return "unknown";
}

export async function readWorkflowPhase(
  getInstance: (id: string) => Promise<{ status: () => Promise<unknown> }>,
  id: string,
): Promise<InstancePhase> {
  try {
    const instance = await getInstance(id);
    return phaseOf(await instance.status());
  } catch (error) {
    if (isWorkflowNotFound(error)) return "unknown";
    throw error;
  }
}

function retryInstanceId(base: string, attempt: number): string {
  const instanceId = `${base}-retry-${attempt}`;
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(instanceId)) {
    throw new Error("Retry Workflow instance id is not valid.");
  }
  return instanceId;
}

/**
 * Start one Workflow for this record.
 * A finished or running instance is a duplicate.
 * An errored or terminated instance starts `{id}-retry-N` so the row can run again.
 * Employee dedupe stays the Xero email and name check, not this id.
 */
export async function startWorkflowForRecord(
  record: AirtableApiRecord,
  start: StartWorkflow,
  options?: { dryRun?: boolean; instanceStatus?: (instanceId: string) => Promise<InstancePhase> },
): Promise<WorkflowStart> {
  const base = workflowInstanceId(record.id, options?.dryRun === true);
  try {
    await start(base, record);
    return { result: "started", instanceId: base };
  } catch (error) {
    if (!isWorkflowAlreadyExists(error)) throw error;
    if (!options?.instanceStatus) return { result: "duplicate", instanceId: base };
    const status = await options.instanceStatus(base);
    if (!FAILED_PHASE.has(status)) return { result: "duplicate", instanceId: base };
    for (let attempt = 1; attempt <= RETRY_CAP; attempt += 1) {
      const retryId = retryInstanceId(base, attempt);
      try {
        await start(retryId, record);
        return { result: "rerun", instanceId: retryId };
      } catch (retryError) {
        if (!isWorkflowAlreadyExists(retryError)) throw retryError;
        const retryStatus = await options.instanceStatus(retryId);
        if (!FAILED_PHASE.has(retryStatus)) return { result: "duplicate", instanceId: retryId };
      }
    }
    throw new Error("Failed Workflow retries are exhausted for this record.");
  }
}
