/**
 * Behaviours copied from Zap 364623444 that look wrong or incomplete.
 * The workflow keeps them. It does not "fix" them.
 */
export interface FlaggedItem {
  id: string;
  summary: string;
}

export const ODDITIES: readonly FlaggedItem[] = [
  {
    id: "employee-state-hardcoded-nsw",
    summary:
      "Employee home address region is always NSW. The contact postal state uses the Airtable State field.",
  },
  {
    id: "super-fund-no-fallback",
    summary: "Super fund lookup is an exact string match. Unknown funds fail the run. There is no default fund.",
  },
  {
    id: "gender-no-fallback",
    summary: "Gender lookup is exact (Male, Female, Non-Binary, Not Stated). Anything else fails the run.",
  },
  {
    id: "gender-not-stated-empty",
    summary:
      "Not Stated maps to an empty gender string. Xero's enum also has N. Empty is what the Zap map says, and it may be rejected by the API.",
  },
  {
    id: "start-date-zapier-expression",
    summary:
      'Employee StartDate comes from the Zapier expression "{{=)}}", which the map describes as "today" and marks for verification. Resolved here as the current date in Australia/Sydney. That timezone is an assumption.',
  },
  {
    id: "contact-bank-bsb-concat",
    summary:
      "Contact bank details are BSB and account concatenated with no separator into BankAccountDetails (Zapier field BankAccountNumber).",
  },
  {
    id: "contact-mobile-plus61-prefix",
    summary:
      'Contact mobile is the literal prefix "+61" concatenated with the Airtable mobile, so 0412… becomes +610412…. That is not valid E.164. The proposed format drops the trunk 0 (0412… becomes +61412…). Not applied. Employee mobile stays the raw Airtable value.',
  },
  {
    id: "employee-bank-left-empty",
    summary: "Employee bank account, BSB, middle name, phone, and job title are left empty even when Airtable has bank details.",
  },
  {
    id: "tax-scale-type-null",
    summary:
      "IncomeType is NONEMPLOYEE. TaxScaleType stays null, which is what the Zap sent.",
  },
  {
    id: "tfn-in-slack-and-email",
    summary: "The TFN is included in the #management Slack checklist and in the instructor confirmation email.",
  },
  {
    id: "no-view-or-filter",
    summary: "The Airtable trigger has no view and no filter. Every new Instructors row is eligible.",
  },
  {
    id: "attachments-included-but-unused",
    summary:
      "The trigger includes attachment metadata. Steps 2–7 never read it, and file bytes are not downloaded.",
  },
  {
    id: "airtable-field-names-unconfirmed",
    summary:
      "Airtable column names are the labels in the Zap map (First Name, DOB, City/Suburb, Account, and so on). They are not confirmed field ids.",
  },
  {
    id: "airtable-inbox-query-sh4iX",
    summary:
      "The Airtable inbox link uses the query parameter sh4iX as written in the map. Confirm the live URL before switchover.",
  },
  {
    id: "similar-super-fund-names-different-uuids",
    summary:
      "Cbus and Media Super Accumulation use different UUIDs even though the trustee wording is similar. Both mappings are preserved.",
  },
  {
    id: "message-text-reconstructed-from-summary",
    summary:
      "Slack copy is still reconstructed from the map summary. The instructor email body is Thiago's verbatim step 7 HTML. The admin@ Gmail signature HTML was not in that export and is not invented.",
  },
  {
    id: "country-literal-australia",
    summary: 'Address country is the literal "Australia", as the map says, not AU or AUSTRALIA.',
  },
  {
    id: "employee-not-updated-on-rerun",
    summary:
      "The employee create step does not patch name, tax, or address on a later run. The pay-template step sends the full desired template, so a retry replaces that template instead of appending lines. The contact step is Create/Update.",
  },
  {
    id: "slack-bank-line-is-account-number",
    summary:
      "The Slack checklist has a bank line and a BSB line. The map has no bank-name field, so the bank line is the account number.",
  },
];

/**
 * Safety behaviour this rebuild adds. These are not Zap oddities and they are not silent fixes of the mappings above.
 */
export const DESIGN_ADDITIONS: readonly FlaggedItem[] = [
  {
    id: "contact-number-airtable-record-id",
    summary:
      "Contacts are keyed by ContactNumber airtable:{recordId} (Xero's external id, max 50 characters) so a second run updates instead of inserting.",
  },
  {
    id: "workflow-instance-id",
    summary:
      "The Airtable record id is the Cloudflare Workflow instance id. A second queue delivery does not start a second run, so it does not create a second employee or contact. D1 and KV are not used for this.",
  },
  {
    id: "safety-net-not-before",
    summary:
      "The daily safety net lists nothing until SAFETY_NET_NOT_BEFORE is set. That stops the first check from turning every historical Instructors row into an employee.",
  },
  {
    id: "no-durable-store",
    summary:
      "Workflows persists each step result and retries only the failed step. The safety-net cutoff is an env var, not a moving cursor. D1 and KV are not part of this Worker.",
  },
  {
    id: "reject-numeric-airtable-fields",
    summary:
      "Text columns such as BSB still reject numbers so a leading zero is not dropped. TFN, ABN, Superannuation Member Number, and Bank Account Number are number columns in the live table, so those four are read as their integer text.",
  },
  {
    id: "notifications-not-resent",
    summary:
      "Slack and email are their own steps. A finished step is not run again, and a second queue delivery does not start another instance, so those messages are not sent twice.",
  },
  {
    id: "abn-on-tax-declaration",
    summary:
      "TaxDeclaration.ABN is the 11-digit Airtable ABN. The accounting contact TaxNumber is the same ABN.",
  },
  {
    id: "ivan-sgc-fixed-amount",
    summary:
      "PayTemplate SuperLines is one SGC line with CalculationType FIXEDAMOUNT, ExpenseAccountCode 478, LiabilityAccountCode 826, and no MinimumMonthlyEarnings. Weekly super at 12% stays on the existing payslip fix and is not put on this line.",
  },
  {
    id: "pay-template-full-replace",
    summary:
      "updateEmployee does not document whether PayTemplate merges or replaces. The step sends the full desired template so a retry does not wipe or duplicate lines.",
  },
  {
    id: "accounts-payable-tax-input",
    summary:
      "Payroll AU has no GST-registered flag. AccountsPayableTaxType is INPUT (GST on Expenses) for both YES and NO until Thiago confirms the split. The unconfirmed NO value is BAS Excluded (BASEXCLUDED).",
  },
  {
    id: "emergency-contact-webhook-only",
    summary:
      "Emergency contact cannot be set through the Payroll AU or Accounting API. It is only on the Patty webhook payload.",
  },
];
