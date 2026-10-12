# xero-provisioning

Balance Moves (Bondi) provisioning workflows that replace Zapier zaps. Nothing here is deployed, and nothing here talks to live Xero, Slack, Gmail, or Airtable unless a person wires credentials on purpose.

## Instructor onboarding

Rebuild of Zapier Zap **364623444**, "Create Xero Contact and Employee from Airtable rows" (published v10). Steps 8–9 (Jira) are out of scope. Thiago said they are not needed.

When a new row appears in Airtable base **Instructor Onboarding** (`appePgXVPIIkgnvBQ`), table **Instructors** (`tblageJRycUMiyKGr`), the workflow:

1. Reads that record (attachments included, no view, no filter).
2. Looks up the Airtable formula field `Super Fund` to a Xero super fund UUID. No fallback.
3. Maps gender: Male `M`, Female `F`, Non-Binary `I`, Not Stated empty. No fallback.
4. Creates a Xero Payroll AU employee: contractor, active, non-employee basis, weekly payroll calendar.
5. Creates or updates a Xero contact in the **Contractors** group.
6. Posts to Slack `#management` (`C09BK6Y2WHL`) as a bot.
7. Emails the instructor from `admin@balancemoves.com.au`, from name "Thiago & Yvette", cc and bcc `admin@`.

Package: [`workflows/instructor-onboarding`](workflows/instructor-onboarding).

| Piece | Path |
| --- | --- |
| Pipeline (steps 1–7 plus the code slot) | `workflows/instructor-onboarding/src/run.ts` |
| Poll trigger | `workflows/instructor-onboarding/src/poll.ts` |
| Super fund table | `workflows/instructor-onboarding/src/lookups/super-funds.ts` |
| Gender table | `workflows/instructor-onboarding/src/lookups/gender.ts` |
| Employee payload | `workflows/instructor-onboarding/src/mappings/employee.ts` |
| Contact payload | `workflows/instructor-onboarding/src/mappings/contact.ts` |
| Slack and email copy | `workflows/instructor-onboarding/src/messages/` |
| Custom-code slot | `workflows/instructor-onboarding/src/custom-code.ts` |
| In-memory fakes | `workflows/instructor-onboarding/src/fakes.ts` |
| Reference HTTP adapters | `workflows/instructor-onboarding/src/host/http.ts` |
| Hosting proposal (not a decision) | `workflows/instructor-onboarding/src/host/proposal.ts` |
| Tests | `workflows/instructor-onboarding/test/` |

### How it runs

`runInstructorOnboarding(airtableRecord, deps)` is the per-record function. A poller or a webhook both call it. `runPollTick(deps)` lists the Instructors table once. The host decides the schedule.

`deps.mode` is `live` or `shadow`. Shadow builds every payload and does the lookups, then does **not** create employees, update contacts, post to Slack, or send email.

The runner does not import Cloudflare or Render. `HOSTING_PROPOSAL.decided` is `false`.

```bash
cd workflows/instructor-onboarding
npm ci
npm test
npm run typecheck
npm run dry-run
```

`npm run dry-run` prints a summary from in-memory fakes. It does not read credentials.

### Hosting and trigger — proposal, not a decision

**Proposed host: Cloudflare Workers.** This workflow is Airtable → Xero Payroll AU → Xero contacts → Slack → email. Those are HTTPS calls. It does not touch Mindbody. The shared-services note already puts Slack and email on Workers. A Worker cron (`*/2 * * * *`) or a Worker HTTP route can call the same functions.

**Alternative host: a Render web service** next to the Mindbody gateway, with a Render cron hitting the same `runPollTick`.

**Proposed trigger: Airtable polling every 2 minutes**, matching the live Zap (no view, no filter, attachments included). That avoids an Airtable automation change while parity is checked.

**Alternative trigger: an Airtable webhook** that posts the new record at `runInstructorOnboarding`. That is the better steady state (faster, fewer list calls) after switchover is explicitly approved.

Either host needs a **durable idempotency store** (`idempotency-store-required`). The in-memory store is for tests and `npm run dry-run` only. Cloudflare KV or Postgres on Render both fit the `WorkflowStore` port. The choice is open.

### Idempotency

Processing the same Airtable record twice does not create a second employee or a second contact.

- Employees: reuse the id already stored for that record. If the store is empty, reuse a single Xero employee with the same email (case-insensitive). Two matches abort. The Xero `Idempotency-Key` is `instructor-onboarding:{recordId}:employee`. The employee is **not** patched on a re-run (`employee-not-updated-on-rerun`), because the Zap step is Create, not update.
- Contacts: the Zap step is Create/Update. `ContactNumber` is `airtable:{recordId}` (`contact-number-airtable-record-id`). A contact the old Zap already created is found by exact name when that number is not set yet, then updated in place (`lookup-before-create`). Two name matches abort.
- Slack and email are not sent again after they have succeeded (`notifications-not-resent`).

A live poll with no `createdAfter` cursor lists nothing (`poll-cursor-required`). The first tick must not turn every historical Instructors row into an employee. Set the cursor to the switchover instant. Records created at or before that timestamp are ignored.

### Switchover from Zapier

**Do not switch this on, and do not turn Zap 364623444 off, without Thiago's explicit go.** This repository does not perform switchover.

1. Compare Slack and email copy with the live Zap. The map summarised them (`message-text-reconstructed-from-summary`).
2. Decide the oddities below that need a product call.
3. Pick a host and a trigger. Put secrets in that host's secret store. Do not commit them.
4. Plug in a durable store for run state, the poll cursor, and rotated OAuth refresh tokens.
5. Set `createdAfter` to the switchover time, or subscribe the webhook only for records created after that time.
6. Run `mode: "shadow"` against fixtures, or later against read-only credentials, and compare payloads with a recent Zap run.
7. After the explicit go: turn the Zap **off**, then enable this trigger. **Do not run both.** Both would duplicate the Slack post and the email, and could duplicate an employee if email lookup misses.

### Oddities preserved (not fixed)

These match the Zap map. The code does not "correct" them.

| Id | What the Zap does |
| --- | --- |
| `employee-state-hardcoded-nsw` | Employee home state is always NSW. The contact uses the Airtable State field. |
| `super-fund-no-fallback` | Unknown super fund fails the run. Exact string match, no default. |
| `gender-no-fallback` | Unknown gender fails the run. |
| `gender-not-stated-empty` | Not Stated is an empty string, not Xero's `N`. The API may reject it. |
| `start-date-zapier-expression` | StartDate is the Zapier expression `{{=)}}`, which the map calls "today" and says to verify. Resolved as the current date in `Australia/Sydney`. That timezone is an assumption. |
| `contact-bank-bsb-concat` | Contact `BankAccountDetails` is BSB and account concatenated with no separator. |
| `contact-mobile-plus61-prefix` | Contact mobile is `+61` plus the raw mobile, so `0412…` becomes `+610412…`. Employee mobile is unchanged. |
| `employee-bank-left-empty` | Employee BSB, account, middle name, phone, and job title are empty. |
| `income-type-and-tax-scale-null` | Employment type CONTRACTOR and basis NONEMPLOYEE, but IncomeType and TaxScaleType are JSON null. |
| `abn-on-contact-not-employee` | ABN is the contact tax number only. It is not on the employee tax declaration. |
| `tfn-in-slack-and-email` | The TFN is in the #management message and in the instructor email. |
| `no-view-or-filter` | Every new Instructors row is eligible. |
| `attachments-included-but-unused` | Attachment metadata is kept. Bytes are not downloaded. Steps 2–7 do not read them. |
| `possible-missing-code-step` | See below. |
| `airtable-field-names-unconfirmed` | Column names are the map's labels, not confirmed field ids. |
| `airtable-inbox-query-sh4iX` | Inbox link query key is `sh4iX`, as written. Confirm the live URL. |
| `similar-super-fund-names-different-uuids` | Cbus and Media Super Accumulation keep different UUIDs. |
| `message-text-reconstructed-from-summary` | Slack and email wording is reconstructed from the summary, not a verbatim Zap export. |
| `country-literal-australia` | Country is the literal `Australia`. |
| `employee-not-updated-on-rerun` | Re-runs reuse the employee and do not patch it. Contacts are updated. |
| `slack-bank-line-is-account-number` | The checklist's bank line is the account number. The map has no bank name. |

Airtable labels used: First Name, Last Name, DOB, Email, Gender, Mobile, Super Fund, Superannuation Member Number, TFN, Residential Address, City/Suburb, State, Postal Code, ABN, BSB, Account. DOB must already be `YYYY-MM-DD`. Values are not trimmed.

### Design additions

Safety around the Zap, not silent mapping fixes.

| Id | What this rebuild adds |
| --- | --- |
| `contact-number-airtable-record-id` | Stable Xero `ContactNumber`. |
| `lookup-before-create` | Email lookup for employees, name lookup for contacts the Zap may already have created. |
| `poll-cursor-required` | Live poll refuses to scan history until `createdAfter` is set. |
| `idempotency-store-required` | Production must persist the store. Memory is for tests and dry run. |
| `reject-numeric-airtable-fields` | Numbers are rejected so a numeric BSB cannot lose its leading zero. |
| `notifications-not-resent` | Slack and email send once per record. |

### Possible missing code step

Thiago thinks the Zap had a small custom code step. The read-only map of published v10 has no code step between 1 and 7. **Nothing was invented to fill that gap.**

The pipeline is an ordered list. After gender lookup, and before the employee create, `customCode` runs. The default is `passthroughCustomCode`. A follow-up can pass another function, or splice a step into `createDefaultSteps()`, without rewriting the Xero, Slack, or email steps. The slot receives the parsed record (including attachment metadata), the super fund UUID, the gender code, and the resolved start date, and may replace them.

If that missing step downloaded attachment bytes or wrote Xero ids back to Airtable, it is not here. The map does not show an Airtable update.

### Open decisions for Thiago

1. Host: Workers (proposal) or Render (alternative), and where the idempotency store lives.
2. Trigger: 2-minute poll (proposal) or Airtable webhook.
3. Switchover: explicit go, Zap off before this is on, cursor timestamp.
4. Xero demo company: optional later sandbox. Not connected from these tests.
5. Product calls on the oddities: NSW on the employee, `{{=)}}` and the Sydney timezone assumption, BSB+account concatenation, `+61` prefix, null income type / ABN not on the employee, empty gender for Not Stated, TFN in Slack and email, reconstructed message text, `sh4iX` link, unconfirmed Airtable column names, whether a re-run should patch the employee.
6. Whether a custom code step existed, and what it did.
7. Xero and Gmail auth: this code refreshes an OAuth refresh token. Say if Balance Moves uses a Xero Custom Connection instead.
8. Whether any historical Instructors rows should ever be backfilled. The default is no.

### Environment variables

No secrets in the repo. Live adapters throw if a required variable is missing. They only call a `fetch` you pass in.

| Variable | System | Purpose |
| --- | --- | --- |
| `AIRTABLE_TOKEN` | Airtable | Read the Instructors table (personal access token, `data.records:read` on base `appePgXVPIIkgnvBQ`). |
| `XERO_CLIENT_ID` | Xero | OAuth client for the Balance Moves org. |
| `XERO_CLIENT_SECRET` | Xero | OAuth client secret. |
| `XERO_REFRESH_TOKEN` | Xero | Refresh token. If Xero rotates it, pass `onXeroRefreshToken` and store the new value. The adapter refuses to drop a rotated token. |
| `XERO_TENANT_ID` | Xero | Balance Moves tenant id. Sent as `Xero-Tenant-Id`. |
| `SLACK_BOT_TOKEN` | Slack | Bot token that can `chat.postMessage` to `#management`. |
| `GMAIL_CLIENT_ID` | Google | OAuth client that can send as `admin@balancemoves.com.au`. |
| `GMAIL_CLIENT_SECRET` | Google | OAuth client secret. |
| `GMAIL_REFRESH_TOKEN` | Google | Refresh token for that mailbox. Rotated tokens need `onGmailRefreshToken`. |

Optional overrides (defaults are the Zap's public ids and copy, not secrets):

| Variable | Default |
| --- | --- |
| `XERO_ORG_SHORTCODE` | `!hGL34` (deep links only) |
| `SLACK_CHANNEL_ID` | `C09BK6Y2WHL` |
| `EMAIL_FROM` | `admin@balancemoves.com.au` |
| `EMAIL_FROM_NAME` | `Thiago & Yvette` |
| `EMAIL_CC` / `EMAIL_BCC` | `admin@balancemoves.com.au` |
| `START_DATE_TIMEZONE` | `Australia/Sydney` |
| `AIRTABLE_BASE_ID` | `appePgXVPIIkgnvBQ` |
| `AIRTABLE_TABLE_ID` | `tblageJRycUMiyKGr` |
| `CONFLUENCE_GUIDE_URL` | `https://balancemovesbondi.atlassian.net/wiki/x/CgBmH` |

Payroll and accounting scopes the token needs: employees and payroll settings (calendars) read/write, contacts read/write. Slack needs to post as a bot. Gmail needs to send.

### Tests

```bash
npm test --prefix workflows/instructor-onboarding
```

Unit tests cover each step. Required cases: unknown super fund, missing fields, and a second run that does not create duplicates. `test/dry-run.e2e.test.ts` is the dry run through steps 1–7 on fakes. `test/http-adapters.test.ts` drives the HTTP adapters with an injected fetch. `test/block-network.ts` replaces global `fetch` so a test cannot reach the network by accident.

**Xero demo company:** a later opt-in job could hit a Xero demo company with CI secrets. Do not point that at the live Balance Moves tenant. This PR does not connect to a demo org or a live org. The default is mocks and fakes only.

### Airtable field → Xero

| Airtable label | Employee | Contact |
| --- | --- | --- |
| First Name, Last Name | FirstName, LastName | Name "First Last", primary person |
| DOB | DateOfBirth | |
| Email | Email | EmailAddress |
| Gender | step 3 code | |
| Mobile | Mobile, unchanged | `+61` + Mobile |
| Super Fund | SuperMemberships.SuperFundID | named in Slack and email |
| Superannuation Member Number | SuperMemberships.EmployeeNumber | |
| TFN | TaxDeclaration.TaxFileNumber | |
| Residential Address, City/Suburb, Postal Code | HomeAddress | POBOX postal address |
| State | ignored; region is NSW | Region |
| ABN | not sent | TaxNumber |
| BSB, Account | left empty | concatenated BankAccountDetails |
| (none) | EmploymentType CONTRACTOR, Status ACTIVE, basis NONEMPLOYEE, residency AUSTRALIANRESIDENT, country Australia, StartDate today | group Contractors |
