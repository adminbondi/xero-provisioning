export interface AirtableApiRecord {
  id: string;
  createdTime?: string;
  fields?: unknown;
}

export interface AirtableAttachment {
  field: string;
  id: string | null;
  url: string;
  filename: string;
}

export interface InstructorRecord {
  recordId: string;
  createdTime: string | null;
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  email: string;
  gender: string;
  mobile: string;
  superFund: string;
  memberNumber: string;
  tfn: string;
  residentialAddress: string;
  city: string;
  state: string;
  postalCode: string;
  abn: string;
  /** Form answer YES, NO, or empty. It does not choose the contact tax type until Thiago confirms. */
  abnRegisteredForGst: "YES" | "NO" | "";
  bsb: string;
  account: string;
  emergencyContactName: string;
  emergencyContactMobile: string;
  attachments: AirtableAttachment[];
  rawFields: Record<string, unknown>;
}

export interface XeroEmployeePayload {
  FirstName: string;
  LastName: string;
  DateOfBirth: string;
  Email: string;
  Gender: string;
  Mobile: string;
  MiddleNames: null;
  Phone: null;
  JobTitle: null;
  EmploymentType: "CONTRACTOR";
  Status: "ACTIVE";
  IncomeType: "NONEMPLOYEE";
  StartDate: string;
  PayrollCalendarID: string;
  SuperMemberships: [
    {
      SuperFundID: string;
      EmployeeNumber: string;
    },
  ];
  TaxDeclaration: {
    EmploymentBasis: "NONEMPLOYEE";
    TaxFileNumber: string;
    ABN: string;
    AustralianResidentForTaxPurposes: true;
    ResidencyStatus: "AUSTRALIANRESIDENT";
    TaxScaleType: null;
    TaxFreeThresholdClaimed: false;
    HasHELPDebt: false;
  };
  HomeAddress: {
    AddressLine1: string;
    City: string;
    Region: "NSW";
    PostalCode: string;
    Country: "Australia";
  };
  BankAccounts: [];
}

export interface XeroContactPayload {
  Name: string;
  FirstName: string;
  LastName: string;
  EmailAddress: string;
  ContactNumber: string;
  TaxNumber: string;
  /**
   * GST on Expenses. Payroll AU has no GST-registered flag.
   * YES and NO both stay INPUT until Thiago confirms the split.
   */
  AccountsPayableTaxType: "INPUT";
  BankAccountDetails: string;
  Phones: [
    {
      PhoneType: "MOBILE";
      PhoneNumber: string;
      PhoneAreaCode: "";
      PhoneCountryCode: "";
    },
  ];
  Addresses: [
    {
      AddressType: "POBOX";
      AddressLine1: string;
      City: string;
      Region: string;
      PostalCode: string;
      Country: "Australia";
    },
  ];
  ContactGroups: [{ Name: "Contractors" }];
}

/** One SGC line. No percentage, amount, or minimum monthly earnings. */
export interface XeroSuperLine {
  SuperMembershipID: string | null;
  ContributionType: "SGC";
  CalculationType: "FIXEDAMOUNT";
  ExpenseAccountCode: "478";
  LiabilityAccountCode: "826";
}

/**
 * Full desired pay template. A PayTemplate update is treated as a replace,
 * so earnings, deductions, reimbursements, and leave are sent empty.
 */
export interface XeroPayTemplate {
  EarningsLines: [];
  DeductionLines: [];
  SuperLines: [XeroSuperLine];
  ReimbursementLines: [];
  LeaveLines: [];
}

export interface PattyWebhookPayload {
  xeroEmployeeId: string | null;
  xeroContactId: string | null;
  firstName: string;
  lastName: string;
  email: string;
  airtableRecordId: string;
  emergencyContactName: string;
  emergencyContactMobile: string;
  xeroEmployeeUrl: string | null;
}

export interface OutboundEmail {
  from: string;
  fromName: string;
  to: string;
  cc: string[];
  bcc: string[];
  subject: string;
  html: string;
}

export interface SlackMessage {
  channel: string;
  text: string;
}

export type RunMode = "live" | "shadow";

export interface WorkflowSuccess {
  ok: true;
  mode: RunMode;
  recordId: string;
  steps: string[];
  superFundId: string;
  genderCode: string;
  startDate: {
    zapierExpression: string;
    timeZone: string;
    resolved: string;
  };
  match: {
    disposition: "create" | "skip-email" | "hold-name";
    reason: "dry-run" | "no-match" | "email" | "name";
    employeeIds: string[];
    contactIds: string[];
  };
  employee: {
    action: "create" | "reuse" | "skip-email" | "hold-name";
    employeeId: string | null;
    created: boolean;
    payload: XeroEmployeePayload;
  };
  contact: {
    action: "create" | "update" | "skip-email" | "hold-name";
    contactId: string | null;
    created: boolean;
    payload: XeroContactPayload;
  };
  slack: SlackMessage & { sent: boolean };
  email: { sent: boolean; message: OutboundEmail };
  employeeRead: {
    checked: boolean;
    employeeId: string | null;
    superMembershipId: string | null;
    gender: string | null;
    incomeType: string | null;
    genderUnset: boolean;
    incomeTypeUnset: boolean;
  };
  payTemplate: {
    updated: boolean;
    template: XeroPayTemplate;
  };
  webhook: {
    posted: boolean;
    payload: PattyWebhookPayload;
  };
  flags: string[];
}
