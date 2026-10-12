import { emailsMatch } from "../match.ts";
import { signWebhookBody } from "./webhook-sign.ts";
import type {
  AirtableListArgs,
  AirtablePort,
  ContactMatch,
  EmailPort,
  EmployeeDetails,
  PayrollCalendar,
  Ports,
  SlackPort,
  SuperMembershipRef,
  WebhookPort,
  XeroContactPort,
  XeroEmployeePort,
} from "../ports.ts";
import type {
  AirtableApiRecord,
  OutboundEmail,
  PattyWebhookPayload,
  SlackMessage,
  XeroContactPayload,
  XeroEmployeePayload,
  XeroPayTemplate,
} from "../types.ts";

const PAYROLL_BASE = "https://api.xero.com/payroll.xro/1.0";
const ACCOUNTING_BASE = "https://api.xero.com/api.xro/2.0";
const XERO_TOKEN_URL = "https://identity.xero.com/connect/token";
const GMAIL_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GMAIL_SEND_URL = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";
const SLACK_POST_URL = "https://slack.com/api/chat.postMessage";
const PAGE_CAP = 50;

export const REQUIRED_LIVE_ENV = [
  "AIRTABLE_TOKEN",
  "XERO_CLIENT_ID",
  "XERO_CLIENT_SECRET",
  "XERO_REFRESH_TOKEN",
  "XERO_TENANT_ID",
  "SLACK_BOT_TOKEN",
  "GMAIL_CLIENT_ID",
  "GMAIL_CLIENT_SECRET",
  "GMAIL_REFRESH_TOKEN",
] as const;

export type LiveEnvName = (typeof REQUIRED_LIVE_ENV)[number];
export type LiveEnv = Record<LiveEnvName, string>;

export interface LivePortHooks {
  onXeroRefreshToken?: (refreshToken: string) => Promise<void>;
  onGmailRefreshToken?: (refreshToken: string) => Promise<void>;
}

export function missingLiveEnv(env: Readonly<Record<string, string | undefined>>): LiveEnvName[] {
  return REQUIRED_LIVE_ENV.filter((name) => !env[name]);
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Expected a JSON object from the upstream API.");
  }
  return value as Record<string, unknown>;
}

function asArray(value: unknown, key: string): Record<string, unknown>[] {
  const record = asRecord(value);
  const items = record[key];
  if (!Array.isArray(items)) return [];
  return items.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object");
}

function redact(text: string): string {
  return text
    .replace(/"access_token"\s*:\s*"[^"]*"/g, '"access_token":"[redacted]"')
    .replace(/"refresh_token"\s*:\s*"[^"]*"/g, '"refresh_token":"[redacted]"')
    .replace(/"TaxFileNumber"\s*:\s*"[^"]*"/g, '"TaxFileNumber":"[redacted]"')
    .slice(0, 300);
}

async function readBody(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return "";
  }
}

async function parseJson(response: Response): Promise<unknown> {
  const text = await readBody(response);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} from ${response.url}: ${redact(text)}`);
  }
  if (!text) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(`HTTP ${response.status} from ${response.url} was not JSON.`);
  }
}

interface TokenResult {
  accessToken: string;
  refreshToken?: string;
}

export async function refreshOAuthToken(
  fetchImpl: typeof fetch,
  url: string,
  params: Record<string, string>,
): Promise<TokenResult> {
  const response = await fetchImpl(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
  });
  const json = asRecord(await parseJson(response));
  if (typeof json.access_token !== "string" || json.access_token.length === 0) {
    throw new Error(`Token endpoint ${url} did not return an access_token.`);
  }
  return {
    accessToken: json.access_token,
    refreshToken: typeof json.refresh_token === "string" ? json.refresh_token : undefined,
  };
}

function cacheToken(load: () => Promise<string>): () => Promise<string> {
  let pending: Promise<string> | null = null;
  return () => {
    if (!pending) {
      pending = load().catch((error: unknown) => {
        pending = null;
        throw error;
      });
    }
    return pending;
  };
}

async function listPages(
  fetchPage: (page: number) => Promise<Record<string, unknown>[]>,
): Promise<Record<string, unknown>[]> {
  const all: Record<string, unknown>[] = [];
  for (let page = 1; page <= PAGE_CAP; page += 1) {
    const batch = await fetchPage(page);
    all.push(...batch);
    if (batch.length < 100) return all;
  }
  throw new Error(`Upstream list exceeded ${PAGE_CAP} pages.`);
}

function xeroHeaders(token: string, tenantId: string): Headers {
  const headers = new Headers();
  headers.set("Authorization", `Bearer ${token}`);
  headers.set("Xero-Tenant-Id", tenantId);
  headers.set("Accept", "application/json");
  return headers;
}

export function createAirtablePort(options: { fetch: typeof fetch; token: string }): AirtablePort {
  return {
    async listRecords(args: AirtableListArgs) {
      if (args.view !== null || args.filterByFormula !== null || args.includeAttachments !== true) {
        throw new Error("Airtable list must include attachments and must not set a view or filter.");
      }
      const url = new URL(`https://api.airtable.com/v0/${args.baseId}/${args.tableId}`);
      url.searchParams.set("pageSize", "100");
      if (args.offset) url.searchParams.set("offset", args.offset);
      const response = await options.fetch(url, {
        headers: { Authorization: `Bearer ${options.token}` },
      });
      const json = asRecord(await parseJson(response));
      return {
        records: asAirtableRecords(json.records),
        offset: typeof json.offset === "string" ? json.offset : undefined,
      };
    },
  };
}

function asAirtableRecords(value: unknown): AirtableApiRecord[] {
  if (!Array.isArray(value)) return [];
  const records: AirtableApiRecord[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    if (typeof record.id !== "string") continue;
    records.push({
      id: record.id,
      createdTime: typeof record.createdTime === "string" ? record.createdTime : undefined,
      fields: record.fields,
    });
  }
  return records;
}

export function createXeroEmployeePort(options: {
  fetch: typeof fetch;
  tenantId: string;
  getAccessToken: () => Promise<string>;
}): XeroEmployeePort {
  return {
    async listPayrollCalendars(): Promise<PayrollCalendar[]> {
      const token = await options.getAccessToken();
      const json = await parseJson(
        await options.fetch(`${PAYROLL_BASE}/PayrollCalendars`, { headers: xeroHeaders(token, options.tenantId) }),
      );
      return asArray(json, "PayrollCalendars").map((calendar) => ({
        payrollCalendarId: String(calendar.PayrollCalendarID ?? ""),
        name: String(calendar.Name ?? ""),
        calendarType: String(calendar.CalendarType ?? ""),
      }));
    },
    async findEmployeesByEmail(email: string) {
      const rows = await listPages(async (page) => {
        const token = await options.getAccessToken();
        const json = await parseJson(
          await options.fetch(`${PAYROLL_BASE}/Employees?page=${page}`, {
            headers: xeroHeaders(token, options.tenantId),
          }),
        );
        return asArray(json, "Employees");
      });
      return rows
        .filter((row) => typeof row.Email === "string" && emailsMatch(row.Email, email))
        .map((row) => ({ employeeId: String(row.EmployeeID ?? ""), email: String(row.Email) }));
    },
    async createEmployee(payload: XeroEmployeePayload, idempotencyKey: string) {
      const token = await options.getAccessToken();
      const headers = xeroHeaders(token, options.tenantId);
      headers.set("Content-Type", "application/json");
      headers.set("Idempotency-Key", idempotencyKey);
      const json = await parseJson(
        await options.fetch(`${PAYROLL_BASE}/Employees`, {
          method: "POST",
          headers,
          body: JSON.stringify({ Employees: [payload] }),
        }),
      );
      const created = asArray(json, "Employees")[0];
      if (!created || typeof created.EmployeeID !== "string") {
        throw new Error("Xero employee create did not return EmployeeID.");
      }
      return { employeeId: created.EmployeeID, created: true };
    },
    async getEmployee(employeeId: string): Promise<EmployeeDetails> {
      const token = await options.getAccessToken();
      const json = await parseJson(
        await options.fetch(`${PAYROLL_BASE}/Employees/${encodeURIComponent(employeeId)}`, {
          headers: xeroHeaders(token, options.tenantId),
        }),
      );
      const employee = asArray(json, "Employees")[0];
      if (!employee) throw new Error(`Xero employee GET did not return ${employeeId}.`);
      return {
        employeeId,
        gender: nullableString(employee.Gender),
        incomeType: nullableString(employee.IncomeType),
        superMemberships: asArray(employee, "SuperMemberships").map(readSuperMembership),
      };
    },
    async updatePayTemplate(employeeId: string, template: XeroPayTemplate) {
      const token = await options.getAccessToken();
      const headers = xeroHeaders(token, options.tenantId);
      headers.set("Content-Type", "application/json");
      await parseJson(
        await options.fetch(`${PAYROLL_BASE}/Employees/${encodeURIComponent(employeeId)}`, {
          method: "POST",
          headers,
          body: JSON.stringify({ Employees: [{ EmployeeID: employeeId, PayTemplate: template }] }),
        }),
      );
    },
  };
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function readSuperMembership(row: Record<string, unknown>): SuperMembershipRef {
  return {
    superMembershipId: typeof row.SuperMembershipID === "string" ? row.SuperMembershipID : "",
    superFundId: typeof row.SuperFundID === "string" ? row.SuperFundID : "",
    employeeNumber: typeof row.EmployeeNumber === "string" ? row.EmployeeNumber : "",
  };
}

export function createXeroContactPort(options: {
  fetch: typeof fetch;
  tenantId: string;
  getAccessToken: () => Promise<string>;
}): XeroContactPort {
  async function listContacts(): Promise<ContactMatch[]> {
    const rows = await listPages(async (page) => {
      const token = await options.getAccessToken();
      const json = await parseJson(
        await options.fetch(`${ACCOUNTING_BASE}/Contacts?page=${page}`, {
          headers: xeroHeaders(token, options.tenantId),
        }),
      );
      return asArray(json, "Contacts");
    });
    return rows.map((row) => ({
      contactId: String(row.ContactID ?? ""),
      name: String(row.Name ?? ""),
      contactNumber: typeof row.ContactNumber === "string" ? row.ContactNumber : null,
    }));
  }

  return {
    async findContactByNumber(contactNumber: string) {
      const contacts = await listContacts();
      return contacts.find((contact) => contact.contactNumber === contactNumber) ?? null;
    },
    async findContactsByName(name: string) {
      const contacts = await listContacts();
      return contacts.filter((contact) => contact.name === name);
    },
    async upsertContact(payload: XeroContactPayload, existingContactId?: string) {
      const token = await options.getAccessToken();
      const headers = xeroHeaders(token, options.tenantId);
      headers.set("Content-Type", "application/json");
      const body = existingContactId ? { ...payload, ContactID: existingContactId } : payload;
      const json = await parseJson(
        await options.fetch(`${ACCOUNTING_BASE}/Contacts`, {
          method: "POST",
          headers,
          body: JSON.stringify({ Contacts: [body] }),
        }),
      );
      const saved = asArray(json, "Contacts")[0];
      if (!saved || typeof saved.ContactID !== "string") {
        throw new Error("Xero contact upsert did not return ContactID.");
      }
      return { contactId: saved.ContactID, created: !existingContactId };
    },
  };
}

export function createPattyWebhookPort(options: {
  fetch: typeof fetch;
  url: string;
  signingSecret: string;
}): WebhookPort {
  return {
    async post(payload: PattyWebhookPayload) {
      if (!options.url) throw new Error("PATTY_WEBHOOK_URL is not set.");
      if (!options.signingSecret) throw new Error("PATTY_WEBHOOK_SIGNING_SECRET is not set.");
      const body = JSON.stringify(payload);
      const signature = await signWebhookBody(options.signingSecret, body);
      const response = await options.fetch(options.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Balance-Moves-Signature": signature,
        },
        body,
      });
      if (!response.ok) {
        throw new Error(`Patty webhook HTTP ${response.status}.`);
      }
      return { delivered: true };
    },
  };
}

export function createSlackPort(options: { fetch: typeof fetch; token: string }): SlackPort {
  return {
    async postMessage(message: SlackMessage) {
      const response = await options.fetch(SLACK_POST_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${options.token}`,
          "Content-Type": "application/json; charset=utf-8",
        },
        body: JSON.stringify({ channel: message.channel, text: message.text }),
      });
      const json = asRecord(await parseJson(response));
      if (json.ok !== true) {
        throw new Error(`Slack chat.postMessage failed: ${typeof json.error === "string" ? json.error : "unknown"}`);
      }
      return { ts: typeof json.ts === "string" ? json.ts : "" };
    },
  };
}

export function buildRfc822(message: OutboundEmail): string {
  return [
    `From: ${JSON.stringify(message.fromName)} <${message.from}>`,
    `To: ${message.to}`,
    `Cc: ${message.cc.join(", ")}`,
    `Bcc: ${message.bcc.join(", ")}`,
    `Subject: ${message.subject}`,
    "MIME-Version: 1.0",
    "Content-Type: text/html; charset=UTF-8",
    "",
    message.html,
  ].join("\r\n");
}

export function toBase64Url(value: string): string {
  return Buffer.from(value, "utf8").toString("base64").replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

export function createGmailPort(options: { fetch: typeof fetch; getAccessToken: () => Promise<string> }): EmailPort {
  return {
    async send(message: OutboundEmail) {
      const token = await options.getAccessToken();
      const json = asRecord(
        await parseJson(
          await options.fetch(GMAIL_SEND_URL, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ raw: toBase64Url(buildRfc822(message)) }),
          }),
        ),
      );
      if (typeof json.id !== "string") {
        throw new Error("Gmail send did not return a message id.");
      }
      return { messageId: json.id };
    },
  };
}

export function createLivePorts(
  env: Readonly<Record<string, string | undefined>>,
  fetchImpl: typeof fetch,
  hooks: LivePortHooks = {},
): Ports {
  const missing = missingLiveEnv(env);
  if (missing.length > 0) {
    throw new Error(`Missing env vars: ${missing.join(", ")}`);
  }
  const live = env as LiveEnv;
  const xeroRefresh = live.XERO_REFRESH_TOKEN;
  const gmailRefresh = live.GMAIL_REFRESH_TOKEN;
  const getXeroToken = cacheToken(async () => {
    const token = await refreshOAuthToken(fetchImpl, XERO_TOKEN_URL, {
      grant_type: "refresh_token",
      refresh_token: xeroRefresh,
      client_id: live.XERO_CLIENT_ID,
      client_secret: live.XERO_CLIENT_SECRET,
    });
    if (token.refreshToken && token.refreshToken !== xeroRefresh) {
      if (!hooks.onXeroRefreshToken) {
        throw new Error("Xero returned a new refresh token but no onXeroRefreshToken handler is configured.");
      }
      await hooks.onXeroRefreshToken(token.refreshToken);
    }
    return token.accessToken;
  });
  const getGmailToken = cacheToken(async () => {
    const token = await refreshOAuthToken(fetchImpl, GMAIL_TOKEN_URL, {
      grant_type: "refresh_token",
      refresh_token: gmailRefresh,
      client_id: live.GMAIL_CLIENT_ID,
      client_secret: live.GMAIL_CLIENT_SECRET,
    });
    if (token.refreshToken && token.refreshToken !== gmailRefresh) {
      if (!hooks.onGmailRefreshToken) {
        throw new Error("Gmail returned a new refresh token but no onGmailRefreshToken handler is configured.");
      }
      await hooks.onGmailRefreshToken(token.refreshToken);
    }
    return token.accessToken;
  });
  return {
    airtable: createAirtablePort({ fetch: fetchImpl, token: live.AIRTABLE_TOKEN }),
    employees: createXeroEmployeePort({
      fetch: fetchImpl,
      tenantId: live.XERO_TENANT_ID,
      getAccessToken: getXeroToken,
    }),
    contacts: createXeroContactPort({
      fetch: fetchImpl,
      tenantId: live.XERO_TENANT_ID,
      getAccessToken: getXeroToken,
    }),
    slack: createSlackPort({ fetch: fetchImpl, token: live.SLACK_BOT_TOKEN }),
    email: createGmailPort({ fetch: fetchImpl, getAccessToken: getGmailToken }),
    webhook: createPattyWebhookPort({
      fetch: fetchImpl,
      url: env.PATTY_WEBHOOK_URL ?? "",
      signingSecret: env.PATTY_WEBHOOK_SIGNING_SECRET ?? "",
    }),
  };
}
