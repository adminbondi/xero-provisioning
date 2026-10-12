import { AIRTABLE_BASE_ID, AIRTABLE_TABLE_ID } from "../config.ts";
import type { AirtablePort } from "../ports.ts";
import type { AirtableApiRecord } from "../types.ts";

export const SAFETY_NET_NOT_BEFORE_MESSAGE =
  "SAFETY_NET_NOT_BEFORE is not set. Refusing to list historical Instructors rows. Set it to the switchover time before the first daily check.";

export const SAFETY_NET_MAX_PAGES = 20;

export interface SafetyNetDeps {
  airtable: AirtablePort;
  notBefore: string | null;
  hasWorkflow(recordId: string): Promise<boolean>;
  enqueue(record: AirtableApiRecord): Promise<void>;
  baseId?: string;
  tableId?: string;
}

export interface SafetyNetItem {
  recordId: string;
  status: "enqueued" | "already-started" | "skipped" | "failed";
  error?: string;
}

export interface SafetyNetResult {
  blocked: boolean;
  reason?: string;
  truncated: boolean;
  results: SafetyNetItem[];
}

export async function runSafetyNet(deps: SafetyNetDeps): Promise<SafetyNetResult> {
  if (!deps.notBefore || Number.isNaN(Date.parse(deps.notBefore))) {
    return { blocked: true, reason: SAFETY_NET_NOT_BEFORE_MESSAGE, truncated: false, results: [] };
  }
  const cutoff = Date.parse(deps.notBefore);
  const results: SafetyNetItem[] = [];
  let offset: string | undefined;
  let pages = 0;
  let truncated = false;
  do {
    pages += 1;
    if (pages > SAFETY_NET_MAX_PAGES) {
      truncated = true;
      break;
    }
    const page = await deps.airtable.listRecords({
      baseId: deps.baseId ?? AIRTABLE_BASE_ID,
      tableId: deps.tableId ?? AIRTABLE_TABLE_ID,
      includeAttachments: true,
      view: null,
      filterByFormula: null,
      offset,
    });
    for (const raw of page.records) {
      if (!raw.createdTime || Number.isNaN(Date.parse(raw.createdTime))) {
        results.push({ recordId: raw.id, status: "failed", error: "Airtable record has no parseable createdTime." });
        continue;
      }
      if (Date.parse(raw.createdTime) <= cutoff) continue;
      try {
        if (await deps.hasWorkflow(raw.id)) {
          results.push({ recordId: raw.id, status: "already-started" });
          continue;
        }
        await deps.enqueue(raw);
        results.push({ recordId: raw.id, status: "enqueued" });
      } catch (error) {
        results.push({
          recordId: raw.id,
          status: "failed",
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    offset = page.offset;
  } while (offset);
  return { blocked: false, truncated, results };
}
