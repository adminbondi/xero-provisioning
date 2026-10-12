import { emailsMatch } from "./match.ts";
import type {
  AirtableListArgs,
  AirtablePort,
  ContactMatch,
  EmailPort,
  EmployeeDetails,
  EmployeeMatch,
  PayrollCalendar,
  Ports,
  SlackPort,
  SuperMembershipRef,
  WebhookPort,
  XeroContactPort,
  XeroEmployeePort,
} from "./ports.ts";
import type {
  AirtableApiRecord,
  OutboundEmail,
  PattyWebhookPayload,
  SlackMessage,
  XeroContactPayload,
  XeroEmployeePayload,
  XeroPayTemplate,
} from "./types.ts";

export interface FakeCall {
  port: string;
  method: string;
  detail?: unknown;
}

export interface ReadbackOverride {
  gender?: string | null;
  incomeType?: string | null;
  superMemberships?: SuperMembershipRef[];
}

export interface FakeEmployee {
  employeeId: string;
  email: string;
  idempotencyKey: string | null;
  payload: XeroEmployeePayload | null;
  gender: string | null;
  incomeType: string | null;
  superMemberships: SuperMembershipRef[];
  /** Replaced wholesale by updatePayTemplate. A second call does not append lines. */
  payTemplate: XeroPayTemplate | null;
}

export interface FakeContact {
  contactId: string;
  name: string;
  contactNumber: string | null;
  payload: XeroContactPayload | null;
}

export interface FakeOptions {
  calendars?: PayrollCalendar[];
  employees?: Array<{ employeeId: string; email: string }>;
  contacts?: Array<{ contactId: string; name: string; contactNumber: string | null }>;
  airtableRecords?: AirtableApiRecord[];
  failUpsertContact?: number;
  failCreateEmployee?: number;
  failSlack?: number;
  failEmail?: number;
  /** Applied to getEmployee so a test can simulate Xero dropping Gender or IncomeType. */
  readback?: ReadbackOverride;
}

const DEFAULT_CALENDAR: PayrollCalendar = {
  payrollCalendarId: "cal-weekly",
  name: "Weekly",
  calendarType: "WEEKLY",
};

export interface FakeBundle {
  ports: Ports;
  employees: FakeEmployee[];
  contacts: FakeContact[];
  slack: SlackMessage[];
  emails: OutboundEmail[];
  webhooks: PattyWebhookPayload[];
  calls: FakeCall[];
  airtableRecords: AirtableApiRecord[];
}

export function createFakePorts(options: FakeOptions = {}): FakeBundle {
  const calls: FakeCall[] = [];
  const employees: FakeEmployee[] = (options.employees ?? []).map((employee, index) => ({
    employeeId: employee.employeeId,
    email: employee.email,
    idempotencyKey: null,
    payload: null,
    gender: null,
    incomeType: null,
    superMemberships: [
      {
        superMembershipId: `membership-seed-${index + 1}`,
        superFundId: "",
        employeeNumber: "",
      },
    ],
    payTemplate: null,
  }));
  const contacts: FakeContact[] = (options.contacts ?? []).map((contact) => ({
    contactId: contact.contactId,
    name: contact.name,
    contactNumber: contact.contactNumber,
    payload: null,
  }));
  const slack: SlackMessage[] = [];
  const emails: OutboundEmail[] = [];
  const webhooks: PattyWebhookPayload[] = [];
  const readback = options.readback;
  const airtableRecords = options.airtableRecords ?? [];
  const calendars = options.calendars ?? [DEFAULT_CALENDAR];
  let contactFailures = options.failUpsertContact ?? 0;
  let employeeFailures = options.failCreateEmployee ?? 0;
  let slackFailures = options.failSlack ?? 0;
  let emailFailures = options.failEmail ?? 0;

  const airtable: AirtablePort = {
    async listRecords(args: AirtableListArgs) {
      calls.push({ port: "airtable", method: "listRecords", detail: args });
      if (args.offset) {
        return { records: [] };
      }
      return { records: airtableRecords.map((record) => structuredClone(record)) };
    },
  };

  const employeePort: XeroEmployeePort = {
    async listPayrollCalendars() {
      calls.push({ port: "employees", method: "listPayrollCalendars" });
      return structuredClone(calendars);
    },
    async findEmployeesByEmail(email: string): Promise<EmployeeMatch[]> {
      calls.push({ port: "employees", method: "findEmployeesByEmail", detail: { email } });
      return employees
        .filter((employee) => emailsMatch(employee.email, email))
        .map((employee) => ({ employeeId: employee.employeeId, email: employee.email }));
    },
    async createEmployee(payload: XeroEmployeePayload, idempotencyKey: string) {
      calls.push({ port: "employees", method: "createEmployee", detail: { idempotencyKey, payload } });
      if (employeeFailures > 0) {
        employeeFailures -= 1;
        throw new Error("forced employee failure");
      }
      const existing = employees.find((employee) => employee.idempotencyKey === idempotencyKey);
      if (existing) {
        return { employeeId: existing.employeeId, created: false };
      }
      const employeeId = `employee-${employees.length + 1}`;
      const membership = payload.SuperMemberships[0];
      employees.push({
        employeeId,
        email: payload.Email,
        idempotencyKey,
        payload: structuredClone(payload),
        gender: payload.Gender,
        incomeType: payload.IncomeType,
        superMemberships: [
          {
            superMembershipId: `membership-${employees.length + 1}`,
            superFundId: membership?.SuperFundID ?? "",
            employeeNumber: membership?.EmployeeNumber ?? "",
          },
        ],
        payTemplate: null,
      });
      return { employeeId, created: true };
    },
    async getEmployee(employeeId: string): Promise<EmployeeDetails> {
      calls.push({ port: "employees", method: "getEmployee", detail: { employeeId } });
      const employee = employees.find((item) => item.employeeId === employeeId);
      if (!employee) throw new Error(`Employee ${employeeId} was not found.`);
      return {
        employeeId,
        gender: readback && "gender" in readback ? (readback.gender ?? null) : employee.gender,
        incomeType: readback && "incomeType" in readback ? (readback.incomeType ?? null) : employee.incomeType,
        superMemberships: readback?.superMemberships
          ? structuredClone(readback.superMemberships)
          : structuredClone(employee.superMemberships),
      };
    },
    async updatePayTemplate(employeeId: string, template: XeroPayTemplate) {
      calls.push({ port: "employees", method: "updatePayTemplate", detail: { employeeId, template } });
      const employee = employees.find((item) => item.employeeId === employeeId);
      if (!employee) throw new Error(`Employee ${employeeId} was not found.`);
      employee.payTemplate = structuredClone(template);
    },
  };

  const contactPort: XeroContactPort = {
    async findContactByNumber(contactNumber: string): Promise<ContactMatch | null> {
      calls.push({ port: "contacts", method: "findContactByNumber", detail: { contactNumber } });
      const found = contacts.find((contact) => contact.contactNumber === contactNumber);
      return found
        ? { contactId: found.contactId, name: found.name, contactNumber: found.contactNumber }
        : null;
    },
    async findContactsByName(name: string): Promise<ContactMatch[]> {
      calls.push({ port: "contacts", method: "findContactsByName", detail: { name } });
      return contacts
        .filter((contact) => contact.name === name)
        .map((contact) => ({
          contactId: contact.contactId,
          name: contact.name,
          contactNumber: contact.contactNumber,
        }));
    },
    async upsertContact(payload: XeroContactPayload, existingContactId?: string) {
      calls.push({
        port: "contacts",
        method: "upsertContact",
        detail: { existingContactId: existingContactId ?? null, payload },
      });
      if (contactFailures > 0) {
        contactFailures -= 1;
        throw new Error("forced contact failure");
      }
      const found = existingContactId
        ? contacts.find((contact) => contact.contactId === existingContactId)
        : contacts.find((contact) => contact.contactNumber === payload.ContactNumber);
      if (found) {
        found.name = payload.Name;
        found.contactNumber = payload.ContactNumber;
        found.payload = structuredClone(payload);
        return { contactId: found.contactId, created: false };
      }
      if (existingContactId) {
        throw new Error(`Contact ${existingContactId} was not found.`);
      }
      const contactId = `contact-${contacts.length + 1}`;
      contacts.push({
        contactId,
        name: payload.Name,
        contactNumber: payload.ContactNumber,
        payload: structuredClone(payload),
      });
      return { contactId, created: true };
    },
  };

  const slackPort: SlackPort = {
    async postMessage(message: SlackMessage) {
      calls.push({ port: "slack", method: "postMessage", detail: message });
      if (slackFailures > 0) {
        slackFailures -= 1;
        throw new Error("forced slack failure");
      }
      slack.push(structuredClone(message));
      return { ts: `${slack.length}.0` };
    },
  };

  const webhookPort: WebhookPort = {
    async post(payload: PattyWebhookPayload) {
      calls.push({ port: "webhook", method: "post", detail: payload });
      webhooks.push(structuredClone(payload));
      return { delivered: true };
    },
  };

  const emailPort: EmailPort = {
    async send(message: OutboundEmail) {
      calls.push({ port: "email", method: "send", detail: { to: message.to, subject: message.subject } });
      if (emailFailures > 0) {
        emailFailures -= 1;
        throw new Error("forced email failure");
      }
      emails.push(structuredClone(message));
      return { messageId: `email-${emails.length}` };
    },
  };

  return {
    ports: {
      airtable,
      employees: employeePort,
      contacts: contactPort,
      slack: slackPort,
      email: emailPort,
      webhook: webhookPort,
    },
    employees,
    contacts,
    slack,
    emails,
    webhooks,
    calls,
    airtableRecords,
  };
}
