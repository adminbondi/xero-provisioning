import type {
  AirtableApiRecord,
  OutboundEmail,
  PattyWebhookPayload,
  SlackMessage,
  XeroContactPayload,
  XeroEmployeePayload,
  XeroPayTemplate,
} from "./types.ts";

export interface AirtableListArgs {
  baseId: string;
  tableId: string;
  includeAttachments: true;
  view: null;
  filterByFormula: null;
  offset?: string;
}

export interface AirtablePort {
  listRecords(args: AirtableListArgs): Promise<{ records: AirtableApiRecord[]; offset?: string }>;
}

export interface PayrollCalendar {
  payrollCalendarId: string;
  name: string;
  calendarType: string;
}

export interface EmployeeMatch {
  employeeId: string;
  email: string;
}

export interface SuperMembershipRef {
  superMembershipId: string;
  superFundId: string;
  employeeNumber: string;
}

export interface EmployeeDetails {
  employeeId: string;
  gender: string | null;
  incomeType: string | null;
  superMemberships: SuperMembershipRef[];
}

export interface XeroEmployeePort {
  listPayrollCalendars(): Promise<PayrollCalendar[]>;
  findEmployeesByEmail(email: string): Promise<EmployeeMatch[]>;
  createEmployee(
    payload: XeroEmployeePayload,
    idempotencyKey: string,
  ): Promise<{ employeeId: string; created: boolean }>;
  /** One GET of `/Employees/{EmployeeID}`. */
  getEmployee(employeeId: string): Promise<EmployeeDetails>;
  /** One POST of `/Employees/{EmployeeID}` with the full PayTemplate. Replaces the stored template. */
  updatePayTemplate(employeeId: string, template: XeroPayTemplate): Promise<void>;
}

export interface ContactMatch {
  contactId: string;
  name: string;
  contactNumber: string | null;
}

export interface XeroContactPort {
  findContactByNumber(contactNumber: string): Promise<ContactMatch | null>;
  findContactsByName(name: string): Promise<ContactMatch[]>;
  upsertContact(
    payload: XeroContactPayload,
    existingContactId?: string,
  ): Promise<{ contactId: string; created: boolean }>;
}

export interface SlackPort {
  postMessage(message: SlackMessage): Promise<{ ts: string }>;
}

export interface EmailPort {
  send(message: OutboundEmail): Promise<{ messageId: string }>;
}

export interface WebhookPort {
  post(payload: PattyWebhookPayload): Promise<{ delivered: boolean }>;
}

export interface Ports {
  airtable: AirtablePort;
  employees: XeroEmployeePort;
  contacts: XeroContactPort;
  slack: SlackPort;
  email: EmailPort;
  webhook: WebhookPort;
}
