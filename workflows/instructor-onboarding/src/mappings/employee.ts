import { ADDRESS_COUNTRY, EMPLOYEE_HOME_STATE } from "../config.ts";
import { InvalidAbnError } from "../errors.ts";
import type { InstructorRecord, XeroEmployeePayload, XeroPayTemplate } from "../types.ts";

export const SUPER_EXPENSE_ACCOUNT_CODE = "478" as const;
export const SUPER_LIABILITY_ACCOUNT_CODE = "826" as const;

export function buildEmployeePayload(input: {
  record: InstructorRecord;
  genderCode: string;
  superFundId: string;
  payrollCalendarId: string;
  startDate: string;
}): XeroEmployeePayload {
  const { record } = input;
  if (!/^\d{11}$/.test(record.abn)) {
    throw new InvalidAbnError(record.abn.length);
  }
  return {
    FirstName: record.firstName,
    LastName: record.lastName,
    DateOfBirth: record.dateOfBirth,
    Email: record.email,
    Gender: input.genderCode,
    Mobile: record.mobile,
    MiddleNames: null,
    Phone: null,
    JobTitle: null,
    EmploymentType: "CONTRACTOR",
    Status: "ACTIVE",
    IncomeType: "NONEMPLOYEE",
    StartDate: input.startDate,
    PayrollCalendarID: input.payrollCalendarId,
    SuperMemberships: [
      {
        SuperFundID: input.superFundId,
        EmployeeNumber: record.memberNumber,
      },
    ],
    TaxDeclaration: {
      EmploymentBasis: "NONEMPLOYEE",
      TaxFileNumber: record.tfn,
      ABN: record.abn,
      AustralianResidentForTaxPurposes: true,
      ResidencyStatus: "AUSTRALIANRESIDENT",
      TaxScaleType: null,
      TaxFreeThresholdClaimed: false,
      HasHELPDebt: false,
    },
    HomeAddress: {
      AddressLine1: record.residentialAddress,
      City: record.city,
      Region: EMPLOYEE_HOME_STATE,
      PostalCode: record.postalCode,
      Country: ADDRESS_COUNTRY,
    },
    BankAccounts: [],
  };
}

/**
 * Ivan Iglesias's pay template is the standard.
 * Weekly super at 12% is applied per payslip by the existing payroll fix.
 * Fixed Amount is left blank on purpose. The end check does not treat that blank as missing.
 * Ivan's contact also has no default purchase account, so the contact omits PurchasesDefaultAccountCode.
 *
 * Payroll AU `updateEmployee` only says it updates properties on one employee.
 * It does not say whether PayTemplate merges or replaces. The published example sends
 * a complete PayTemplate, so this is the full desired template: one SGC line and no
 * earnings, deduction, reimbursement, or leave lines. A retry sends this same object.
 */
export function buildPayTemplate(superMembershipId: string | null): XeroPayTemplate {
  return {
    EarningsLines: [],
    DeductionLines: [],
    ReimbursementLines: [],
    LeaveLines: [],
    SuperLines: [
      {
        SuperMembershipID: superMembershipId,
        ContributionType: "SGC",
        CalculationType: "FIXEDAMOUNT",
        ExpenseAccountCode: SUPER_EXPENSE_ACCOUNT_CODE,
        LiabilityAccountCode: SUPER_LIABILITY_ACCOUNT_CODE,
      },
    ],
  };
}

/**
 * Xero stores this key against the exact request body.
 * A retry instance must not reuse the failed instance's key, or Xero returns
 * "Idempotency Key is used with a different request."
 * The first live instance id is the Airtable record id, so that key is unchanged.
 */
export function employeeIdempotencyKey(instanceId: string): string {
  const key = `instructor-onboarding:${instanceId}:employee`;
  if (key.length > 128) {
    throw new Error("Employee idempotency key exceeds Xero's 128 character limit.");
  }
  return key;
}
