import { ADDRESS_COUNTRY, EMPLOYEE_HOME_STATE } from "../config.ts";
import type { InstructorRecord, XeroEmployeePayload } from "../types.ts";

export function buildEmployeePayload(input: {
  record: InstructorRecord;
  genderCode: string;
  superFundId: string;
  payrollCalendarId: string;
  startDate: string;
}): XeroEmployeePayload {
  const { record } = input;
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
    IncomeType: null,
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
      ResidencyStatus: "AUSTRALIANRESIDENT",
      TaxScaleType: null,
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

export function employeeIdempotencyKey(recordId: string): string {
  const key = `instructor-onboarding:${recordId}:employee`;
  if (key.length > 128) {
    throw new Error("Employee idempotency key exceeds Xero's 128 character limit.");
  }
  return key;
}
