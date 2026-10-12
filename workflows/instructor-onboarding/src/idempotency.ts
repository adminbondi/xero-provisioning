export interface IdempotencyRecord {
  airtableRecordId: string;
  employeeId?: string;
  contactId?: string;
  slackSent: boolean;
  emailSent: boolean;
}

export interface PollCursor {
  createdAfter: string | null;
}

export interface WorkflowStore {
  getRun(recordId: string): Promise<IdempotencyRecord | null>;
  saveRun(record: IdempotencyRecord): Promise<void>;
  getCursor(): Promise<PollCursor>;
  setCursor(cursor: { createdAfter: string }): Promise<void>;
}

export function blankRun(recordId: string): IdempotencyRecord {
  return { airtableRecordId: recordId, slackSent: false, emailSent: false };
}

export function isRunComplete(run: IdempotencyRecord | null): boolean {
  return Boolean(run?.employeeId && run.contactId && run.slackSent && run.emailSent);
}

export class MemoryWorkflowStore implements WorkflowStore {
  readonly runs = new Map<string, IdempotencyRecord>();
  private cursor: PollCursor = { createdAfter: null };

  async getRun(recordId: string): Promise<IdempotencyRecord | null> {
    const found = this.runs.get(recordId);
    return found ? structuredClone(found) : null;
  }

  async saveRun(record: IdempotencyRecord): Promise<void> {
    this.runs.set(record.airtableRecordId, structuredClone(record));
  }

  async getCursor(): Promise<PollCursor> {
    return structuredClone(this.cursor);
  }

  async setCursor(cursor: { createdAfter: string }): Promise<void> {
    if (!/^\d{4}-\d{2}-\d{2}T/.test(cursor.createdAfter) || Number.isNaN(Date.parse(cursor.createdAfter))) {
      throw new Error("Cursor createdAfter must be an ISO-8601 timestamp.");
    }
    this.cursor = { createdAfter: cursor.createdAfter };
  }
}
