import { isWorkflowAlreadyExists, workflowInstanceId } from "./intake.ts";
import type { AirtableApiRecord } from "../types.ts";

export type StartWorkflow = (instanceId: string, record: AirtableApiRecord) => Promise<void>;

export async function startWorkflowForRecord(
  record: AirtableApiRecord,
  start: StartWorkflow,
): Promise<"started" | "duplicate"> {
  const instanceId = workflowInstanceId(record.id);
  try {
    await start(instanceId, record);
    return "started";
  } catch (error) {
    if (isWorkflowAlreadyExists(error)) return "duplicate";
    throw error;
  }
}
