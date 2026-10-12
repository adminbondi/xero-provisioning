/**
 * DRY RUN — mock fetch only.
 * Every request is handled in-process. Global fetch is blocked.
 */
import "./block-network.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { sampleAirtableRecord } from "../src/fixtures/sample-instructor.ts";
import { createAirtablePort, createLivePorts, type LiveEnv } from "../src/host/http.ts";
import { signWebhookBody } from "../src/host/webhook-sign.ts";
import { AIRTABLE_BASE_ID, AIRTABLE_TABLE_ID, defaultConfig } from "../src/config.ts";
import { runInstructorOnboarding } from "../src/run.ts";

const WEBHOOK_URL = "https://patty-webhook.invalid/onboarding";
const WEBHOOK_SECRET = "test-webhook-secret";

const env: LiveEnv = {
  AIRTABLE_TOKEN: "test-airtable-token",
  XERO_CLIENT_ID: "test-xero-client-id",
  XERO_CLIENT_SECRET: "test-xero-client-secret",
  XERO_REFRESH_TOKEN: "test-xero-refresh-token",
  XERO_TENANT_ID: "test-xero-tenant",
  SLACK_BOT_TOKEN: "test-slack-bot-token",
  GMAIL_CLIENT_ID: "test-gmail-client-id",
  GMAIL_CLIENT_SECRET: "test-gmail-client-secret",
  GMAIL_REFRESH_TOKEN: "test-gmail-refresh-token",
};

function urlOf(input: Parameters<typeof fetch>[0]): string {
  if (input instanceof URL) return input.toString();
  if (typeof input === "string") return input;
  return input.url;
}

function decodeBase64Url(value: string): string {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat((4 - (value.length % 4)) % 4);
  return Buffer.from(padded, "base64").toString("utf8");
}

test("dry-run HTTP adapters post the Zap payloads only to the injected fetch", async () => {
  const seen: Array<{ url: string; method: string; authorization: string | null; tenant: string | null; idempotency: string | null; body: string | null }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = urlOf(input);
    const headers = new Headers(init?.headers);
    const body = init?.body == null ? null : String(init.body);
    seen.push({
      url,
      method: init?.method ?? "GET",
      authorization: headers.get("authorization"),
      tenant: headers.get("xero-tenant-id"),
      idempotency: headers.get("idempotency-key"),
      body,
    });
    if (url.startsWith("https://identity.xero.com/connect/token")) {
      assert.match(body ?? "", /grant_type=refresh_token/);
      assert.match(body ?? "", /refresh_token=test-xero-refresh-token/);
      return Response.json({ access_token: "test-xero-access-token" });
    }
    if (url === "https://api.xero.com/payroll.xro/1.0/PayrollCalendars") {
      return Response.json({
        PayrollCalendars: [{ PayrollCalendarID: "cal-1", Name: "Weekly", CalendarType: "WEEKLY" }],
      });
    }
    if (url.startsWith("https://api.xero.com/payroll.xro/1.0/Employees?page=")) {
      return Response.json({ Employees: [] });
    }
    if (url === "https://api.xero.com/payroll.xro/1.0/Employees") {
      const parsed = JSON.parse(body ?? "null") as Array<{
        HomeAddress: { Region: string };
        IncomeType: string;
        EmploymentType: string;
        TaxDeclaration: {
          ABN: string;
          AustralianResidentForTaxPurposes: boolean;
          TaxFreeThresholdClaimed: boolean;
          HasHELPDebt: boolean;
          ResidencyStatus: string;
        };
        SuperMemberships: Array<{ SuperFundID: string }>;
      }>;
      assert.equal(Array.isArray(parsed), true);
      assert.equal(body?.includes('"Employees"'), false);
      const employee = parsed[0];
      assert.equal(employee?.HomeAddress.Region, "NSW");
      assert.equal(employee?.EmploymentType, "CONTRACTOR");
      assert.equal(employee?.IncomeType, "NONEMPLOYEE");
      assert.equal(employee?.TaxDeclaration.ABN, "12345678901");
      assert.equal(employee?.TaxDeclaration.AustralianResidentForTaxPurposes, true);
      assert.equal(employee?.TaxDeclaration.TaxFreeThresholdClaimed, false);
      assert.equal(employee?.TaxDeclaration.HasHELPDebt, false);
      assert.equal(employee?.TaxDeclaration.ResidencyStatus, "AUSTRALIANRESIDENT");
      assert.equal(employee?.SuperMemberships[0]?.SuperFundID, "4caabd49-1d08-4d8b-958b-d933a113e9c9");
      return Response.json({ Employees: [{ EmployeeID: "emp-http" }] });
    }
    if (url === "https://api.xero.com/payroll.xro/1.0/Employees/emp-http" && (init?.method ?? "GET") === "GET") {
      return Response.json({
        Employees: [
          {
            EmployeeID: "emp-http",
            Gender: "F",
            IncomeType: "NONEMPLOYEE",
            EmploymentType: "CONTRACTOR",
            PayrollCalendarID: "cal-1",
            TaxDeclaration: {
              TaxFileNumber: "123456782",
              ABN: "12345678901",
              ResidencyStatus: "AUSTRALIANRESIDENT",
            },
            SuperMemberships: [
              {
                SuperMembershipID: "membership-http",
                SuperFundID: "4caabd49-1d08-4d8b-958b-d933a113e9c9",
                EmployeeNumber: "SM-100200",
              },
            ],
            PayTemplate: {
              SuperLines: [
                {
                  ContributionType: "SGC",
                  CalculationType: "FIXEDAMOUNT",
                  ExpenseAccountCode: "478",
                  LiabilityAccountCode: "826",
                },
              ],
            },
          },
        ],
      });
    }
    if (url === "https://api.xero.com/payroll.xro/1.0/Employees/emp-http" && init?.method === "POST") {
      const parsed = JSON.parse(body ?? "null") as Array<{
        EmployeeID: string;
        PayTemplate: {
          EarningsLines: unknown[];
          LeaveLines: unknown[];
          SuperLines: Array<Record<string, unknown>>;
        };
      }>;
      assert.equal(Array.isArray(parsed), true);
      assert.equal(body?.includes('"Employees"'), false);
      const template = parsed[0]?.PayTemplate;
      assert.equal(parsed[0]?.EmployeeID, "emp-http");
      assert.deepEqual(template?.EarningsLines, []);
      assert.deepEqual(template?.LeaveLines, []);
      assert.equal(template?.SuperLines.length, 1);
      const line = template?.SuperLines[0];
      assert.equal(line?.ContributionType, "SGC");
      assert.equal(line?.CalculationType, "FIXEDAMOUNT");
      assert.equal(line?.ExpenseAccountCode, "478");
      assert.equal(line?.LiabilityAccountCode, "826");
      assert.equal(line?.SuperMembershipID, "membership-http");
      assert.equal("Percentage" in (line ?? {}), false);
      assert.equal("Amount" in (line ?? {}), false);
      assert.equal("MinimumMonthlyEarnings" in (line ?? {}), false);
      return Response.json({ Employees: [{ EmployeeID: "emp-http" }] });
    }
    if (url.startsWith("https://api.xero.com/api.xro/2.0/Contacts?page=")) {
      return Response.json({ Contacts: [] });
    }
    if (url === "https://api.xero.com/api.xro/2.0/Contacts") {
      const parsed = JSON.parse(body ?? "{}") as {
        Contacts: Array<{
          BankAccountDetails: string;
          TaxNumber: string;
          AccountsPayableTaxType: string;
          Phones: Array<{ PhoneNumber: string }>;
          ContactGroups: Array<{ Name: string }>;
        }>;
      };
      assert.equal(Array.isArray(parsed), false);
      assert.equal(parsed.Contacts[0]?.BankAccountDetails, "06200090817263");
      assert.equal(parsed.Contacts[0]?.TaxNumber, "12345678901");
      assert.equal(parsed.Contacts[0]?.AccountsPayableTaxType, "INPUT");
      assert.equal(parsed.Contacts[0]?.Phones[0]?.PhoneNumber, "+61 412345678");
      assert.equal("PurchasesDefaultAccountCode" in (parsed.Contacts[0] ?? {}), false);
      assert.equal(parsed.Contacts[0]?.ContactGroups[0]?.Name, "Contractors");
      return Response.json({ Contacts: [{ ContactID: "con-http" }] });
    }
    if (url === "https://api.xero.com/api.xro/2.0/Contacts/con-http") {
      return Response.json({
        Contacts: [
          {
            ContactID: "con-http",
            AccountsPayableTaxType: "INPUT",
            BankAccountDetails: "06200090817263",
            Phones: [{ PhoneType: "MOBILE", PhoneNumber: "+61 412345678" }],
          },
        ],
      });
    }
    if (url === "https://slack.com/api/chat.postMessage") {
      const parsed = JSON.parse(body ?? "{}") as { channel: string; text: string };
      assert.equal(parsed.channel, "C09BK6Y2WHL");
      assert.match(parsed.text, /emp-http/);
      assert.match(parsed.text, /con-http/);
      assert.match(parsed.text, /MISSING Emergency contact/);
      assert.match(parsed.text, /PASS Default purchase account/);
      assert.equal(parsed.text.includes("123456782"), false);
      assert.equal(parsed.text.includes("90817263"), false);
      assert.equal(parsed.text.includes("062000"), false);
      assert.equal(parsed.text.includes("12345678901"), false);
      assert.equal(parsed.text.includes("SM-100200"), false);
      assert.equal(parsed.text.includes("https://abr.business.gov.au/ABN"), false);
      return Response.json({ ok: true, ts: "1.2" });
    }
    if (url === "https://oauth2.googleapis.com/token") {
      assert.match(body ?? "", /refresh_token=test-gmail-refresh-token/);
      return Response.json({ access_token: "test-gmail-access-token" });
    }
    if (url === "https://gmail.googleapis.com/gmail/v1/users/me/messages/send") {
      const parsed = JSON.parse(body ?? "{}") as { raw: string };
      const raw = decodeBase64Url(parsed.raw);
      assert.match(raw, /From: "Thiago & Yvette" <admin@balancemoves.com.au>/);
      assert.match(raw, /To: avery.nguyen.example@example.com/);
      assert.match(raw, /Cc: admin@balancemoves.com.au/);
      assert.match(raw, /Bcc: admin@balancemoves.com.au/);
      assert.match(raw, /Subject: Instructor Onboarding: Please Confirm Your Details/);
      return Response.json({ id: "gmail-msg-1" });
    }
    if (url === WEBHOOK_URL) {
      assert.equal(init?.method, "POST");
      const signature = new Headers(init?.headers).get("x-balance-moves-signature");
      assert.equal(signature, await signWebhookBody(WEBHOOK_SECRET, body ?? ""));
      const parsed = JSON.parse(body ?? "{}") as {
        xeroEmployeeId: string;
        xeroContactId: string;
        emergencyContactName: string;
        emergencyContactMobile: string;
        airtableRecordId: string;
      };
      assert.equal(parsed.xeroEmployeeId, "emp-http");
      assert.equal(parsed.xeroContactId, "con-http");
      assert.equal(parsed.emergencyContactName, "Sam Nguyen");
      assert.equal(parsed.emergencyContactMobile, "0499888777");
      assert.equal(parsed.airtableRecordId, "recInstructor001");
      return Response.json({ ok: true });
    }
    throw new Error(`unexpected url ${url}`);
  };

  const ports = createLivePorts(
    { ...env, PATTY_WEBHOOK_URL: WEBHOOK_URL, PATTY_WEBHOOK_SIGNING_SECRET: WEBHOOK_SECRET },
    fetchImpl,
  );
  const result = await runInstructorOnboarding(sampleAirtableRecord(), {
    ports,
    mode: "live",
    now: () => new Date("2026-10-12T13:30:00.000Z"),
    config: { ...defaultConfig(), payrollCalendarId: "cal-weekly" },
    instanceId: "recInstructor001-retry-1",
  });
  assert.equal(result.employee.employeeId, "emp-http");
  assert.equal(result.contact.contactId, "con-http");
  assert.equal(result.email.message.to, "avery.nguyen.example@example.com");
  const employeePost = seen.find((call) => call.url === "https://api.xero.com/payroll.xro/1.0/Employees" && call.method === "POST");
  assert.equal(employeePost?.authorization, "Bearer test-xero-access-token");
  assert.equal(employeePost?.tenant, "test-xero-tenant");
  assert.equal(employeePost?.idempotency, "instructor-onboarding:recInstructor001-retry-1:employee");
  assert.equal(seen.some((call) => call.url.includes("api.xero.com") && call.authorization === "Bearer test-xero-access-token"), true);

  const airtableFetch: typeof fetch = async (input, init) => {
    const url = urlOf(input);
    assert.equal(url.includes("filterByFormula"), false);
    assert.equal(url.includes("view="), false);
    assert.match(url, new RegExp(`api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_TABLE_ID}`));
    assert.match(url, /pageSize=100/);
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer test-airtable-token");
    return Response.json({ records: [{ id: "recFromAirtable", createdTime: "2026-10-12T00:00:00.000Z", fields: {} }] });
  };
  const listed = await createAirtablePort({ fetch: airtableFetch, token: "test-airtable-token" }).listRecords({
    baseId: AIRTABLE_BASE_ID,
    tableId: AIRTABLE_TABLE_ID,
    includeAttachments: true,
    view: null,
    filterByFormula: null,
  });
  assert.equal(listed.records[0]?.id, "recFromAirtable");
});

test("live ports refuse to start when a secret is missing, and refuse a dropped Xero refresh token", async () => {
  const fetchImpl: typeof fetch = async () => {
    throw new Error("fetch should not run");
  };
  assert.throws(() => createLivePorts({ AIRTABLE_TOKEN: "test-only" }, fetchImpl), /XERO_CLIENT_ID/);

  const rotating: typeof fetch = async (input) => {
    const url = urlOf(input);
    if (url.startsWith("https://identity.xero.com/connect/token")) {
      return Response.json({ access_token: "test-xero-access-token", refresh_token: "rotated-test-refresh-token" });
    }
    throw new Error(`unexpected url ${url}`);
  };
  const ports = createLivePorts(env, rotating);
  await assert.rejects(ports.employees.listPayrollCalendars(), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.equal(error.message.includes("rotated-test-refresh-token"), false);
    assert.match(error.message, /onXeroRefreshToken/);
    return true;
  });

  let saved = "";
  const handled: typeof fetch = async (input) => {
    const url = urlOf(input);
    if (url.startsWith("https://identity.xero.com/connect/token")) {
      return Response.json({ access_token: "test-xero-access-token", refresh_token: "rotated-test-refresh-token" });
    }
    if (url.endsWith("/PayrollCalendars")) {
      return Response.json({ PayrollCalendars: [] });
    }
    throw new Error(`unexpected url ${url}`);
  };
  const withHook = createLivePorts(env, handled, {
    onXeroRefreshToken: async (token) => {
      saved = token;
    },
  });
  assert.deepEqual(await withHook.employees.listPayrollCalendars(), []);
  assert.equal(saved, "rotated-test-refresh-token");
});

test("the Airtable adapter rejects a view or a filter", async () => {
  const fetchImpl: typeof fetch = async () => {
    throw new Error("fetch should not run");
  };
  const airtable = createAirtablePort({ fetch: fetchImpl, token: "test-airtable-token" });
  await assert.rejects(
    () =>
      airtable.listRecords({
        baseId: AIRTABLE_BASE_ID,
        tableId: AIRTABLE_TABLE_ID,
        includeAttachments: true,
        view: "Grid view" as unknown as null,
        filterByFormula: null,
      }),
    /must not set a view/,
  );
});
