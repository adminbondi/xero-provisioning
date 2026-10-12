import { AIRTABLE_BASE_ID, AIRTABLE_TABLE_ID, POLL_INTERVAL_MS } from "./config.ts";
import { serializeWorkflowError } from "./errors.ts";
import { isRunComplete } from "./idempotency.ts";
import type { AirtablePort } from "./ports.ts";
import { runInstructorOnboarding, type RunDeps } from "./run.ts";
import type { AirtableApiRecord, WorkflowSuccess } from "./types.ts";

export { POLL_INTERVAL_MS };

export const CURSOR_REQUIRED_MESSAGE =
  "Poll cursor is not set. Refusing to list historical Instructors rows. Set createdAfter to the switchover time before the first live tick.";

export interface PollItemResult {
  recordId: string;
  status: "processed" | "skipped" | "failed";
  outcome?: WorkflowSuccess;
  error?: ReturnType<typeof serializeWorkflowError>;
}

export interface PollTickResult {
  blocked: boolean;
  reason?: string;
  results: PollItemResult[];
}

export async function listAllInstructorRecords(
  airtable: AirtablePort,
  baseId: string = AIRTABLE_BASE_ID,
  tableId: string = AIRTABLE_TABLE_ID,
): Promise<AirtableApiRecord[]> {
  const records: AirtableApiRecord[] = [];
  let offset: string | undefined;
  do {
    const page = await airtable.listRecords({
      baseId,
      tableId,
      includeAttachments: true,
      view: null,
      filterByFormula: null,
      offset,
    });
    records.push(...page.records);
    offset = page.offset;
  } while (offset);
  return records;
}

export async function runPollTick(deps: RunDeps): Promise<PollTickResult> {
  const cursor = await deps.store.getCursor();
  if (deps.mode === "live" && !cursor.createdAfter) {
    return { blocked: true, reason: CURSOR_REQUIRED_MESSAGE, results: [] };
  }
  const config = deps.config;
  const records = await listAllInstructorRecords(
    deps.ports.airtable,
    config?.airtableBaseId,
    config?.airtableTableId,
  );
  const results: PollItemResult[] = [];
  for (const raw of records) {
    if (cursor.createdAfter) {
      if (!raw.createdTime || Number.isNaN(Date.parse(raw.createdTime))) {
        results.push({
          recordId: raw.id,
          status: "failed",
          error: { name: "MissingCreatedTime", message: "Airtable record has no parseable createdTime." },
        });
        continue;
      }
      if (Date.parse(raw.createdTime) <= Date.parse(cursor.createdAfter)) {
        continue;
      }
    }
    const prior = await deps.store.getRun(raw.id);
    if (deps.mode === "live" && isRunComplete(prior)) {
      results.push({ recordId: raw.id, status: "skipped" });
      continue;
    }
    try {
      const outcome = await runInstructorOnboarding(raw, deps);
      results.push({ recordId: raw.id, status: "processed", outcome });
    } catch (error) {
      results.push({ recordId: raw.id, status: "failed", error: serializeWorkflowError(error) });
    }
  }
  return { blocked: false, results };
}
