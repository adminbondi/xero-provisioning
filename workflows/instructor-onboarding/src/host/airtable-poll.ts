import {
  AIRTABLE_BASE_ID,
  AIRTABLE_TABLE_ID,
  AIRTABLE_POLL_CALLS_PER_30_DAY_MONTH,
  AIRTABLE_POLL_CALLS_PER_31_DAY_MONTH,
} from "../config.ts";
import type { AirtablePort } from "../ports.ts";
import type { AirtableApiRecord } from "../types.ts";

/**
 * One KV key per mode holds the created-time watermark.
 * A dry-run poll must not move the live cursor: the live Workflow id is still free.
 * KV is one timestamp, not a table. D1 would be a database for that same cursor.
 * A growing set of record ids would still need this created-time filter to stay at one list call.
 */
export const AIRTABLE_CURSOR_KEY_DRY = "created-after:dry";
export const AIRTABLE_CURSOR_KEY_LIVE = "created-after:live";

/** Extra pages only. Five pages is 500 rows, which would already blow the monthly Airtable budget. */
export const AIRTABLE_POLL_MAX_PAGES = 5;

export const AIRTABLE_POLL_BLOCKED_MESSAGE =
  "SAFETY_NET_NOT_BEFORE is not set and there is no created-time watermark. Refusing to list historical Instructors rows.";

/** Steady-state list calls. One call per hourly run, no extra page. */
export const EXPECTED_AIRTABLE_CALLS = {
  perDay: 24,
  per30DayMonth: AIRTABLE_POLL_CALLS_PER_30_DAY_MONTH,
  per31DayMonth: AIRTABLE_POLL_CALLS_PER_31_DAY_MONTH,
} as const;

const CREATED_TIME_FILTER =
  /^IS_AFTER\(CREATED_TIME\(\), '(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z)'\)$/;

export function cursorKey(dryRun: boolean): string {
  return dryRun ? AIRTABLE_CURSOR_KEY_DRY : AIRTABLE_CURSOR_KEY_LIVE;
}

/** The only Airtable filter this Worker sends. No view. No per-record read. */
export function createdAfterFormula(createdAfter: string): string {
  const formula = `IS_AFTER(CREATED_TIME(), '${createdAfter}')`;
  if (!CREATED_TIME_FILTER.test(formula)) {
    throw new Error("Created-time watermark must be a UTC ISO timestamp.");
  }
  return formula;
}

export function isCreatedTimeFilter(formula: string): boolean {
  return CREATED_TIME_FILTER.test(formula);
}

export interface CursorStore {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
}

export function memoryCursor(initial: Record<string, string> = {}): CursorStore {
  const values = new Map(Object.entries(initial));
  return {
    async get(key: string): Promise<string | null> {
      return values.get(key) ?? null;
    },
    async put(key: string, value: string): Promise<void> {
      values.set(key, value);
    },
  };
}

export interface AirtablePollDeps {
  airtable: AirtablePort;
  cursor: CursorStore;
  dryRun: boolean;
  /** Initial cursor when KV has no watermark yet. Historical rows at or before this are not listed. */
  notBefore: string | null;
  enqueue(record: AirtableApiRecord): Promise<void>;
  baseId?: string;
  tableId?: string;
}

export interface AirtablePollResult {
  blocked: boolean;
  reason?: string;
  truncated: boolean;
  pages: number;
  enqueued: string[];
  watermark: string | null;
}

export async function pollNewInstructors(deps: AirtablePollDeps): Promise<AirtablePollResult> {
  const key = cursorKey(deps.dryRun);
  const stored = await deps.cursor.get(key);
  const cursor = stored && stored.length > 0 ? stored : deps.notBefore;
  if (!cursor || Number.isNaN(Date.parse(cursor))) {
    return { blocked: true, reason: AIRTABLE_POLL_BLOCKED_MESSAGE, truncated: false, pages: 0, enqueued: [], watermark: null };
  }
  let formula: string;
  try {
    formula = createdAfterFormula(cursor);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { blocked: true, reason: message, truncated: false, pages: 0, enqueued: [], watermark: stored };
  }

  const collected: AirtableApiRecord[] = [];
  let offset: string | undefined;
  let pages = 0;
  let truncated = false;
  do {
    pages += 1;
    if (pages > AIRTABLE_POLL_MAX_PAGES) {
      truncated = true;
      break;
    }
    const page = await deps.airtable.listRecords({
      baseId: deps.baseId ?? AIRTABLE_BASE_ID,
      tableId: deps.tableId ?? AIRTABLE_TABLE_ID,
      includeAttachments: true,
      view: null,
      filterByFormula: formula,
      offset,
    });
    collected.push(...page.records);
    offset = page.offset;
  } while (offset);

  const cursorMs = Date.parse(cursor);
  const ordered = collected
    .filter((record) => {
      const created = record.createdTime ? Date.parse(record.createdTime) : Number.NaN;
      return !Number.isNaN(created) && created > cursorMs;
    })
    .sort((left, right) => {
      const byTime = Date.parse(left.createdTime ?? "") - Date.parse(right.createdTime ?? "");
      if (byTime !== 0) return byTime;
      return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
    });

  const enqueued: string[] = [];
  let failed = false;
  for (const record of ordered) {
    try {
      await deps.enqueue(record);
      enqueued.push(record.id);
    } catch {
      failed = true;
      break;
    }
  }

  const incomplete = truncated || failed || collected.some((record) => !record.createdTime || Number.isNaN(Date.parse(record.createdTime)));
  let watermark = stored;
  if (!incomplete && ordered.length > 0 && enqueued.length === ordered.length) {
    const newest = ordered[ordered.length - 1]?.createdTime;
    if (newest) {
      await deps.cursor.put(key, newest);
      watermark = newest;
    }
  }

  return { blocked: false, truncated, pages: Math.min(pages, AIRTABLE_POLL_MAX_PAGES), enqueued, watermark };
}
