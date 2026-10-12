# xero-provisioning

Balance Moves (Bondi) provisioning workflows that replace Zapier zaps. Nothing here is deployed, and nothing here talks to live Xero, Slack, Gmail, or Airtable unless a person wires credentials on purpose.

## Instructor onboarding

Rebuild of Zapier Zap **364623444**, "Create Xero Contact and Employee from Airtable rows" (published v10). Steps 8–9 (Jira) are out of scope. Thiago said they are not needed. The published map has no custom-code step, so there is no placeholder for one.

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
| Seven `step.do` steps | `workflows/instructor-onboarding/src/run.ts` |
| Retry settings, one per step | `workflows/instructor-onboarding/src/host/step-config.ts` |
| Worker entry (HTTP, queue, cron, Workflow) | `workflows/instructor-onboarding/src/host/worker.ts` |
| Airtable automation script | `workflows/instructor-onboarding/airtable/on-record-created.js` |
| Wrangler config (queue, DLQ, cron) | `workflows/instructor-onboarding/wrangler.jsonc` |
| Super fund table | `workflows/instructor-onboarding/src/lookups/super-funds.ts` |
| Gender table | `workflows/instructor-onboarding/src/lookups/gender.ts` |
| Employee payload | `workflows/instructor-onboarding/src/mappings/employee.ts` |
| Contact payload | `workflows/instructor-onboarding/src/mappings/contact.ts` |
| Slack and email copy | `workflows/instructor-onboarding/src/messages/` |
| In-memory fakes | `workflows/instructor-onboarding/src/fakes.ts` |
| Reference HTTP adapters | `workflows/instructor-onboarding/src/host/http.ts` |
| Hosting decision | `workflows/instructor-onboarding/src/host/decision.ts` |
| Tests | `workflows/instructor-onboarding/test/` |

### How it runs

Cloudflare Workflows runs the seven steps. Each step is one `step.do` with its own retry settings, so a failure retries only that step. Local steps (parse, super fund, gender) do not retry. Xero, Slack, and email retry with their own delay and timeout.

Each step stays short. The employee step is one create, using `XERO_WEEKLY_PAYROLL_CALENDAR_ID` so it does not list calendars or page employees. The contact step is one upsert, keyed by `ContactNumber`. Slack is one post. Email is one send. A cold OAuth token refresh can happen immediately before the Xero or Gmail call. That refresh is not a separate step.

`runInstructorOnboarding(airtableRecord, deps)` is the same seven steps, used by tests and `npm run dry-run` with fakes. `deps.mode` is `live` or `shadow`. Shadow builds every payload and does **not** create employees, update contacts, post to Slack, or send email.

```bash
cd workflows/instructor-onboarding
npm ci
npm test
npm run typecheck
npm run dry-run
```

`npm run dry-run` prints a summary from in-memory fakes. It does not read credentials.

### Hosting — decided, not deployed

**Host: one Cloudflare Worker**, with a Queue and a Workflow. This workflow is Airtable → Xero Payroll AU → Xero contacts → Slack → email. Those are HTTPS calls. It does not touch Mindbody.

1. An Airtable automation ("when a record is created") runs `airtable/on-record-created.js`. The script POSTs the new row to the Worker's `/intake` route with `Authorization: Bearer <INGRESS_TOKEN>`.
2. The Worker checks the token and sends the row to the queue `instructor-onboarding-intake`.
3. The queue consumer starts one Workflow instance. The instance id is the Airtable record id. A second delivery does not start a second run (`workflow-instance-id`). The consumer acks that duplicate. Other start failures retry, then land on `instructor-onboarding-intake-dlq` (`max_retries` 5).
4. The Workflow runs the seven steps.
5. A daily cron (`0 21 * * *`, 21:00 UTC) lists Instructors rows that never reached the queue and enqueues them. See the safety net below.

D1 and KV are not used (`no-durable-store`).

### DRY_RUN

`DRY_RUN` defaults **on**. `wrangler.jsonc` sets the var to `"true"`. Only the exact string `"false"` allows Xero, Slack, and Gmail writes. Unset still means dry run.

While it is on, the Workflow parses the real Airtable row from the queue message and runs the super-fund and gender lookups. It does not call Xero, Slack, or Gmail. Each step logs `dry-run-would-send`. The log omits the TFN, bank account number, BSB, ABN, and super fund member number, and records whether each of those fields is present. Slack and email previews in that log are masked. A live post to #management is still the Zap checklist, with those values included.

The dry-run Workflow instance id is `{Airtable record id}-dry`, not the bare record id. Cloudflare instance ids cannot contain `:`, so this is the usable form of a `:dry` suffix. A dry run does not consume the live id. The same record can be run live later, after `DRY_RUN` is set to `false`, because that live instance id is still free. A second dry run of the same record does not start another dry instance.

Turning `DRY_RUN` off is a later explicit change. This pull request does not deploy.

After merge, the first production check is still a dry run:

1. Deploy with `DRY_RUN=true` (the committed default).
2. Set `SAFETY_NET_NOT_BEFORE` to that deploy instant, in UTC, before the cron can list older rows.
3. Post one Instructors row to `/intake` and read the seven `dry-run-would-send` logs.
4. Confirm the instance id ends in `-dry` and that Xero, Slack, and Gmail received no writes.
5. Leave `DRY_RUN` on until Thiago says to turn it off. He is turning Zap 364623444 off first. Do not run a live write before that later go.

- Duplicate prevention is the Workflow instance id, which Cloudflare keeps after the run finishes. A second `create({ id: recordId })` does not start another run.
- Step retries are stored by Workflows. A failed contact step does not create the employee again.
- The safety-net cutoff is the env var `SAFETY_NET_NOT_BEFORE`, set once at switchover. It is not a moving cursor, so it does not need a database.

Xero auth is an OAuth refresh token, not a Custom Connection. If Xero returns a new refresh token, the adapter throws. There is nowhere to store the replacement. That is deliberate: a token store would be the only reason to add KV, and it is not built.

### Airtable automation

Create the automation on the Instructors table. Trigger: record created. Action: run a script, using `workflows/instructor-onboarding/airtable/on-record-created.js`.

Inputs (Airtable automation variables, not committed):

| Input | Value |
| --- | --- |
| `recordId` | Record id from the trigger |
| `workerUrl` | `https://<worker-host>/intake` |
| `ingressToken` | Same secret as `INGRESS_TOKEN` |

The script turns single selects into their name and dates into `YYYY-MM-DD`, which is the shape the parser already expects from the Airtable REST API. Do not paste the token into the file.

### Queue and secrets

Not run by this pull request. From `workflows/instructor-onboarding`, when someone is ready to provision Cloudflare (still not switchover):

```bash
npx wrangler queues create instructor-onboarding-intake
npx wrangler queues create instructor-onboarding-intake-dlq
npx wrangler secret put INGRESS_TOKEN
npx wrangler secret put AIRTABLE_TOKEN
npx wrangler secret put XERO_CLIENT_ID
npx wrangler secret put XERO_CLIENT_SECRET
npx wrangler secret put XERO_REFRESH_TOKEN
npx wrangler secret put XERO_TENANT_ID
npx wrangler secret put SLACK_BOT_TOKEN
npx wrangler secret put GMAIL_CLIENT_ID
npx wrangler secret put GMAIL_CLIENT_SECRET
npx wrangler secret put GMAIL_REFRESH_TOKEN
npx wrangler secret put XERO_WEEKLY_PAYROLL_CALENDAR_ID
npx wrangler secret put SAFETY_NET_NOT_BEFORE
```

`wrangler.jsonc` binds the queue, the dead-letter queue, the Workflow class `InstructorOnboardingWorkflow`, and the daily cron. Do not deploy from this pull request.

`XERO_WEEKLY_PAYROLL_CALENDAR_ID` is the id of the one WEEKLY payroll calendar. `resolveWeeklyPayrollCalendar` can read it once from Xero; the workflow step does not. If that id is missing, the employee step fails before any Xero write.

### Idempotency

A second queue delivery for the same Airtable record does not start a second Workflow, so it does not create a second employee or contact and does not send Slack or email again (`notifications-not-resent`).

- Employees: one POST with `Idempotency-Key` `instructor-onboarding:{recordId}:employee`. The step does not page the employee list (that is a long loop). A retried step hits the same key and does not insert another employee. The employee is **not** patched (`employee-not-updated-on-rerun`).
- Contacts: one POST. `ContactNumber` is `airtable:{recordId}` (`contact-number-airtable-record-id`). A retry updates that contact. The step does not search by name.
- Records the old Zap already created, with no idempotency key and no `ContactNumber`, are not matched. Do not run this beside the Zap, and do not backfill history.

### Safety net

The cron is for rows that never reached the queue. It is not the trigger.

It lists the Instructors table with attachments, no view, and no filter (`no-view-or-filter` is still how the list is called). It then skips rows created at or before `SAFETY_NET_NOT_BEFORE`. If that variable is unset or not a timestamp, it lists nothing (`safety-net-not-before`). For each later row it asks the Workflow binding whether an instance with that record id exists. Missing instances are enqueued. Existing instances, including ones that already failed, are left alone: Cloudflare does not reuse an instance id.

### Switchover from Zapier

**Do not switch this on, and do not turn Zap 364623444 off, without Thiago's explicit go.** This repository does not perform switchover.

1. Compare Slack copy with the live Zap. The instructor email body is the verbatim step 7 HTML (`message-text-reconstructed-from-summary`). The Gmail signature HTML was not in that export.
2. Decide the oddities below that are still product calls. The `+61` mobile prefix is one of them. Behavior is unchanged.
3. Put secrets in Wrangler. Do not commit them. Copy the weekly payroll calendar id into `XERO_WEEKLY_PAYROLL_CALENDAR_ID`.
4. Set `SAFETY_NET_NOT_BEFORE` to the switchover instant. Leave it unset until then so the cron cannot scan history.
5. Install the Airtable automation only when the go is explicit, or point it at a Worker that is not processing live.
6. Run `mode: "shadow"` against fixtures, or later against read-only credentials, and compare payloads with a recent Zap run.
7. After the explicit go: turn the Zap **off**, then enable the automation. **Do not run both.** This workflow does not look up existing employees by email, so running both can create a second employee.

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
| `contact-mobile-plus61-prefix` | Contact mobile is `+61` plus the raw mobile, so `0412…` becomes `+610412…`. Proposed E.164 drops the trunk 0, so `0412345678` would be `+61412345678`. Not applied. Employee mobile is unchanged. |
| `employee-bank-left-empty` | Employee BSB, account, middle name, phone, and job title are empty. |
| `income-type-and-tax-scale-null` | Employment type CONTRACTOR and basis NONEMPLOYEE, but IncomeType and TaxScaleType are JSON null. |
| `abn-on-contact-not-employee` | ABN is the contact tax number only. It is not on the employee tax declaration. |
| `tfn-in-slack-and-email` | The TFN is in the #management message and in the instructor email. |
| `no-view-or-filter` | Every new Instructors row is eligible. The safety-net list uses the same request shape. |
| `attachments-included-but-unused` | Attachment metadata is kept. Bytes are not downloaded. Steps 2–7 do not read them. |
| `airtable-field-names-unconfirmed` | Column names are the map's labels, not confirmed field ids. |
| `airtable-inbox-query-sh4iX` | Inbox link query key is `sh4iX`, as written. Confirm the live URL. |
| `similar-super-fund-names-different-uuids` | Cbus and Media Super Accumulation keep different UUIDs. |
| `message-text-reconstructed-from-summary` | Slack wording is still reconstructed from the summary. The instructor email body is the verbatim step 7 HTML. The Gmail signature HTML was not in that export. |
| `country-literal-australia` | Country is the literal `Australia`. |
| `employee-not-updated-on-rerun` | The employee step is Create. It does not patch an employee. Contacts are updated by `ContactNumber`. |
| `slack-bank-line-is-account-number` | The checklist's bank line is the account number. The map has no bank name. |

Airtable labels used: First Name, Last Name, DOB, Email, Gender, Mobile, Super Fund, Superannuation Member Number, TFN, Residential Address, City/Suburb, State, Postal Code, ABN, BSB, Account. DOB must already be `YYYY-MM-DD`. Values are not trimmed.

### Design additions

Safety around the Zap, not silent mapping fixes.

| Id | What this rebuild adds |
| --- | --- |
| `contact-number-airtable-record-id` | Stable Xero `ContactNumber`. |
| `workflow-instance-id` | One Workflow instance per Airtable record. A second delivery does not start a second run. |
| `safety-net-not-before` | The daily check lists nothing until `SAFETY_NET_NOT_BEFORE` is set. |
| `no-durable-store` | No D1 or KV. Workflows stores step results. The cutoff is an env var. |
| `reject-numeric-airtable-fields` | Text columns such as BSB still reject numbers. TFN, ABN, member number, and Bank Account Number are live number columns and are read as integer text. |
| `notifications-not-resent` | A finished Slack or email step is not run again, and a duplicate queue message does not start another instance. |

### Open decisions

Settled, and not repeated here as choices: Cloudflare Worker + Queue + Workflows, Airtable automation into the queue, Workflow instance id instead of D1 or KV, OAuth refresh token (not a Xero Custom Connection), no custom-code step, daily safety net, `+61` mapping left as the Zap wrote it.

Still open:

1. Switchover: explicit go, Zap off before this is on, and the `SAFETY_NET_NOT_BEFORE` timestamp.
2. `contact-mobile-plus61-prefix`: keep `+610412…`, or apply the proposed `+614…` form. The code still concatenates.
3. Xero demo company: optional later sandbox. Not connected from these tests.
4. Product calls on the other oddities: NSW on the employee, `{{=)}}` and the Sydney timezone assumption, BSB+account concatenation, null income type / ABN not on the employee, empty gender for Not Stated, TFN in Slack and email, reconstructed message text, `sh4iX` link, unconfirmed Airtable column names.
5. If the Xero refresh token rotates on every use, KV would be the smallest place to store the new token. That store is not built, and it would not be the duplicate lock. Confirm the token is long-lived.
6. Whether any historical Instructors rows should ever be backfilled. The default is no.

### Environment variables

No secrets in the repo. Live adapters throw if a required variable is missing. They only call a `fetch` you pass in. Tests use fakes or an injected fetch.

| Variable | System | Purpose |
| --- | --- | --- |
| `INGRESS_TOKEN` | Worker | Bearer token on `POST /intake`. Compared with a hash, not `===`. |
| `AIRTABLE_TOKEN` | Airtable | Safety-net read of the Instructors table (`data.records:read` on base `appePgXVPIIkgnvBQ`). |
| `XERO_CLIENT_ID` | Xero | OAuth client for the Balance Moves org. |
| `XERO_CLIENT_SECRET` | Xero | OAuth client secret. |
| `XERO_REFRESH_TOKEN` | Xero | Refresh token. A rotated token throws. It is not written to KV. |
| `XERO_TENANT_ID` | Xero | Balance Moves tenant id. Sent as `Xero-Tenant-Id`. |
| `XERO_WEEKLY_PAYROLL_CALENDAR_ID` | Xero | Weekly calendar id. The employee step does not look it up. |
| `SLACK_BOT_TOKEN` | Slack | Bot token that can `chat.postMessage` to `#management`. |
| `GMAIL_CLIENT_ID` | Google | OAuth client that can send as `admin@balancemoves.com.au`. |
| `GMAIL_CLIENT_SECRET` | Google | OAuth client secret. |
| `GMAIL_REFRESH_TOKEN` | Google | Refresh token for that mailbox. |
| `SAFETY_NET_NOT_BEFORE` | Worker | ISO timestamp. Unset blocks the daily check. |

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

Payroll and accounting scopes the token needs: employees write, contacts write. Slack needs to post as a bot. Gmail needs to send. The safety net needs Airtable read.

### Tests

```bash
npm test --prefix workflows/instructor-onboarding
```

Unit tests cover each step. Required cases: unknown super fund, missing fields, a failed contact step that does not create a second employee, and a second queue delivery that does not start a second workflow. `test/dry-run.e2e.test.ts` is the dry run through steps 1–7 on fakes. `test/http-adapters.test.ts` drives the HTTP adapters with an injected fetch. `test/block-network.ts` replaces global `fetch` so a test cannot reach the network by accident.

**Xero demo company:** a later opt-in job could hit a Xero demo company with CI secrets. Do not point that at the live Balance Moves tenant. This PR does not connect to a demo org or a live org. The default is mocks and fakes only.

### Airtable field → Xero

| Airtable label | Employee | Contact |
| --- | --- | --- |
| First Name, Last Name | FirstName, LastName | Name "First Last", primary person |
| DOB | DateOfBirth | |
| Email | Email | EmailAddress |
| Gender | step 3 code | |
| Mobile | Mobile, unchanged | `+61` + Mobile (proposed `+614…` is not applied) |
| Super Fund | SuperMemberships.SuperFundID | named in Slack and email |
| Superannuation Member Number | SuperMemberships.EmployeeNumber | |
| TFN | TaxDeclaration.TaxFileNumber | |
| Residential Address, City/Suburb, Postal Code | HomeAddress | POBOX postal address |
| State | ignored; region is NSW | Region |
| ABN | not sent | TaxNumber |
| BSB, Account | left empty | concatenated BankAccountDetails |
| (none) | EmploymentType CONTRACTOR, Status ACTIVE, basis NONEMPLOYEE, residency AUSTRALIANRESIDENT, country Australia, StartDate today | group Contractors |
