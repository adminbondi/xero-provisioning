export class WorkflowError extends Error {
  readonly step: string;

  constructor(step: string, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
    this.step = step;
  }
}

export class MissingFieldsError extends WorkflowError {
  readonly fields: readonly string[];

  constructor(fields: readonly string[]) {
    super("airtable-record", `Missing Airtable fields: ${fields.join(", ")}`);
    this.fields = fields;
  }
}

export class AirtableFieldTypeError extends WorkflowError {
  readonly field: string;

  constructor(field: string, type: string) {
    super(
      "airtable-record",
      `Airtable field "${field}" has type ${type}; this workflow expects text so leading zeros are not dropped.`,
    );
    this.field = field;
  }
}

export class UnknownSuperFundError extends WorkflowError {
  readonly superFund: string;

  constructor(superFund: string) {
    super(
      "super-fund",
      `No Xero super fund UUID for ${JSON.stringify(superFund)}. The Zap has no fallback.`,
    );
    this.superFund = superFund;
  }
}

export class UnknownGenderError extends WorkflowError {
  readonly gender: string;

  constructor(gender: string) {
    super("gender", `No Xero gender code for ${JSON.stringify(gender)}. The Zap has no fallback.`);
    this.gender = gender;
  }
}

export class PayrollCalendarError extends WorkflowError {
  constructor(message: string) {
    super("xero-employee", message);
  }
}

export class AmbiguousEmployeeError extends WorkflowError {
  constructor(email: string, count: number) {
    super(
      "xero-employee",
      `Found ${count} Xero employees with email ${JSON.stringify(email)}. Refusing to guess.`,
    );
  }
}

export class AmbiguousContactError extends WorkflowError {
  constructor(name: string, count: number) {
    super(
      "xero-contact",
      `Found ${count} Xero contacts named ${JSON.stringify(name)}. Refusing to guess.`,
    );
  }
}

export class CustomCodeError extends WorkflowError {
  constructor(message: string, cause?: unknown) {
    super("custom-code", message, { cause });
  }
}

export function serializeWorkflowError(error: unknown): {
  name: string;
  message: string;
  step?: string;
  fields?: readonly string[];
} {
  if (error instanceof MissingFieldsError) {
    return { name: error.name, message: error.message, step: error.step, fields: error.fields };
  }
  if (error instanceof WorkflowError) {
    return { name: error.name, message: error.message, step: error.step };
  }
  if (error instanceof Error) {
    return { name: error.name, message: error.message };
  }
  return { name: "Error", message: String(error) };
}
