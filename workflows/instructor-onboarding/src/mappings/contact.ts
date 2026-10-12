import { ADDRESS_COUNTRY, CONTRACTORS_GROUP_NAME } from "../config.ts";
import { WorkflowError } from "../errors.ts";
import type { InstructorRecord, XeroContactPayload } from "../types.ts";

export function instructorFullName(record: Pick<InstructorRecord, "firstName" | "lastName">): string {
  return `${record.firstName} ${record.lastName}`;
}

/** Zap mapping: Mobile is "+61" concatenated with the Airtable mobile. No digit stripping. */
export function contactMobile(mobile: string): string {
  return `+61${mobile}`;
}

/**
 * Proposed E.164 for an Australian mobile, not used by the contact payload.
 * 0412345678 would become +61412345678 (the trunk 0 is dropped). Returns null when the value is not 04 plus 8 digits.
 */
export function proposedE164Mobile(mobile: string): string | null {
  if (!/^04\d{8}$/.test(mobile)) return null;
  return `+61${mobile.slice(1)}`;
}

/** Zap mapping: BankAccountNumber is BSB concatenated with account. No separator. */
export function contactBankAccount(bsb: string, account: string): string {
  return `${bsb}${account}`;
}

export function contactNumberFor(recordId: string): string {
  const value = `airtable:${recordId}`;
  if (value.length > 50) {
    throw new WorkflowError(
      "xero-contact",
      `ContactNumber is ${value.length} characters; Xero allows 50.`,
    );
  }
  return value;
}

/**
 * Payroll AU has no GST-registered flag.
 * Proposed, and not confirmed by Thiago: form "ABN Registered for GST" YES means
 * AccountsPayableTaxType INPUT (GST on Expenses), and NO means BASEXCLUDED (BAS Excluded).
 * Until he confirms, both answers stay INPUT. When in doubt, keep the GST.
 */
export function accountsPayableTaxType(abnRegisteredForGst: string): "INPUT" {
  void abnRegisteredForGst;
  return "INPUT";
}

export function buildContactPayload(record: InstructorRecord): XeroContactPayload {
  return {
    Name: instructorFullName(record),
    FirstName: record.firstName,
    LastName: record.lastName,
    EmailAddress: record.email,
    ContactNumber: contactNumberFor(record.recordId),
    TaxNumber: record.abn,
    AccountsPayableTaxType: accountsPayableTaxType(record.abnRegisteredForGst),
    BankAccountDetails: contactBankAccount(record.bsb, record.account),
    Phones: [
      {
        PhoneType: "MOBILE",
        PhoneNumber: contactMobile(record.mobile),
        PhoneAreaCode: "",
        PhoneCountryCode: "",
      },
    ],
    Addresses: [
      {
        AddressType: "POBOX",
        AddressLine1: record.residentialAddress,
        City: record.city,
        Region: record.state,
        PostalCode: record.postalCode,
        Country: ADDRESS_COUNTRY,
      },
    ],
    ContactGroups: [{ Name: CONTRACTORS_GROUP_NAME }],
  };
}
