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
  bsb: string;
  account: string;
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
  IncomeType: null;
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
    ResidencyStatus: "AUSTRALIANRESIDENT";
    TaxScaleType: null;
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
  employee: {
    action: "create" | "reuse";
    employeeId: string | null;
    created: boolean;
    payload: XeroEmployeePayload;
  };
  contact: {
    action: "create" | "update";
    contactId: string | null;
    created: boolean;
    payload: XeroContactPayload;
  };
  slack: SlackMessage & { sent: boolean };
  email: { sent: boolean; message: OutboundEmail };
  flags: string[];
}
