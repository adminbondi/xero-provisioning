# xero-provisioning

Balance Moves (Bondi) provisioning workflows that replace Zapier zaps. Nothing here is deployed, and nothing here talks to live Xero, Slack, Gmail, or Airtable unless a person wires credentials on purpose.

## Instructor onboarding

Rebuild of Zapier Zap **364623444**, "Create Xero Contact and Employee from Airtable rows" (published v10). Steps 8–9 (Jira) are out of scope. Thiago said they are not needed. The published map has no custom-code step, so there is no placeholder for one.

When a new row appears in Airtable base **Instructor Onboarding** (`appePgXVPIIkgnvBQ`), table **Instructors** (`tblageJRycUMiyKGr`), the workflow:

1. Reads that record from the hourly list (attachments included, no view, created-time filter only).
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
| Hourly Airtable poll | `workflows/instructor-onboarding/src/host/airtable-poll.ts` |
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

Cloudflare Workflows runs the Zap's seven steps, then an employee read and a pay-template finalise. The Patty webhook step is removed. Each remaining step is one `step.do` with its own retry settings, so a failure retries only that step. Local steps (parse, super fund, gender) do not retry. Xero, Slack, and email retry with their own delay and timeout.

Each step stays short. The employee step is one create, using `XERO_WEEKLY_PAYROLL_CALENDAR_ID` so it does not list calendars or page employees. The contact step is one upsert, keyed by `ContactNumber`. Slack is one post. Email is one send. A cold OAuth token refresh can happen immediately before the Xero or Gmail call. That refresh is not a separate step.

`runInstructorOnboarding(airtableRecord, deps)` is that pipeline, used by tests and `npm run dry-run` with fakes. `deps.mode` is `live` or `shadow`. Shadow builds every payload and does **not** create employees, update contacts, post to Slack, or send email.

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

1. Once an hour (`0 * * * *`, UTC) the Worker lists Instructors rows created after its watermark and sends each new row to the queue `instructor-onboarding-intake`. Airtable's free plan cannot run scripts, so there is no record-created automation.
2. The queue consumer starts one Workflow instance. The instance id is the Airtable record id. A second delivery does not start a second run (`workflow-instance-id`) when that instance is still running or already finished. An errored or terminated instance starts `{record id}-retry-1` instead. The consumer acks a duplicate. Other start failures retry, then land on `instructor-onboarding-intake-dlq` (`max_retries` 5).
3. The Workflow runs the seven Zap steps, then an employee read and a pay-template finalise. The Patty webhook step is removed.
4. `POST /intake` still accepts a manual row. It is not the trigger.

KV stores that created-time watermark and the Xero refresh token (`xero-refresh-token`). D1 is not used. Neither value is the Xero duplicate lock.

### DRY_RUN

`DRY_RUN` defaults **on** when the var is unset. Only the exact string `"false"` allows Xero, Slack, and Gmail writes. The top-level `wrangler.jsonc` does not set `DRY_RUN` or `SAFETY_NET_NOT_BEFORE`. Those live values stay put only when production deploy uses `npx wrangler deploy --keep-vars`. A plain deploy would replace every var with the file and wipe them. The old dry-run defaults are under `env.preview` only.

While it is on, the Workflow parses the real Airtable row from the queue message and runs the super-fund and gender lookups. It does not call Xero, Slack, or Gmail. Each step logs `dry-run-would-send`. The log omits the TFN, bank account number, BSB, ABN, and super fund member number, and records whether each of those fields is present. Slack and email previews in that log are masked. A live post to #management is still the Zap checklist, with those values included.

The dry-run Workflow instance id is `{Airtable record id}-dry`, not the bare record id. Cloudflare instance ids cannot contain `:`, so this is the usable form of a `:dry` suffix. A dry run does not consume the live id. The same record can be run live later, after `DRY_RUN` is set to `false`, because that live instance id is still free. A second dry run of the same record does not start another dry instance.

Turning `DRY_RUN` off is a later explicit change. This pull request does not deploy.

After merge, do not change the live `DRY_RUN` or `SAFETY_NET_NOT_BEFORE` values:

1. Deploy production with `npx wrangler deploy --keep-vars`. Do not rely on the top-level file to set `DRY_RUN` or `SAFETY_NET_NOT_BEFORE`.
2. Leave the live `SAFETY_NET_NOT_BEFORE` value in place. The poll uses that env value as the initial cursor when KV has no watermark.
3. Set `AIRTABLE_TOKEN` as a Worker secret. Let the hourly poll list one new Instructors row and read the `dry-run-would-send` logs.
4. Confirm the instance id ends in `-dry` and that Xero, Slack, and Gmail received no writes.
5. Do not turn live `DRY_RUN` on or off from this branch. That still needs a separate go.

- Duplicate prevention for Xero is the Workflow instance id, which Cloudflare keeps after the run finishes. A second `create({ id: recordId })` does not start another run while that instance is running or complete. A failed instance can start `{recordId}-retry-1`. The new run still skips an employee that already exists by email or name.
- The hourly poll's duplicate prevention is a KV created-time watermark, separate for dry run and live. A dry-run poll does not consume the live cursor.
- Step retries are stored by Workflows. A failed contact step does not create the employee again.

Xero auth is an OAuth refresh token, not a Custom Connection. A rotated token is stored in KV and read back before the next grant, following payroll `xero_api/token_store.py` (`shared_oauth_access_token` and `RenderRefreshTokenStore.persist_refresh_token`). The secret is used only when KV is empty. The token value is not logged.

### Airtable poll

Airtable's free plan cannot run scripts, so the record-created automation is dropped. Do not install one. `AIRTABLE_TOKEN` is a Worker secret and is never committed. Tests use fakes and do not need a real token.

The only cron is `0 * * * *`. Each run is one list call: base `appePgXVPIIkgnvBQ`, table `tblageJRycUMiyKGr`, `filterByFormula` `IS_AFTER(CREATED_TIME(), watermark)`, attachments included, no view, page size 100. A further page is requested only when that response has an offset. There is no per-record Airtable read. New rows go to the existing intake queue, then the Workflow.

Steady state, with no extra page: **720 Airtable list calls in a 30-day month** (24 × 30) and **744 in a 31-day month** (24 × 31). That is under the free plan's about 1,000 calls a month.

Why KV, not D1: the cursor is one timestamp. D1 would be a database for that value. A set of processed record ids would still need this created-time filter to stay at one list call an hour, and the set would grow without a bound. The dry-run watermark and the live watermark are different keys, so a dry run does not mark the row finished for Xero.

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
npx wrangler kv namespace create AIRTABLE_CURSOR
```

`wrangler.jsonc` binds the queue, the dead-letter queue, the Workflow class `InstructorOnboardingWorkflow`, the `AIRTABLE_CURSOR` KV namespace, and one cron (`0 * * * *`). Replace the placeholder namespace id before a deploy. Do not deploy from this pull request. `AIRTABLE_TOKEN` is set with `wrangler secret put` above. It is not a GitHub Actions secret and it is not in the repo.

`XERO_WEEKLY_PAYROLL_CALENDAR_ID` is the id of the one WEEKLY payroll calendar. `resolveWeeklyPayrollCalendar` can read it once from Xero; the workflow step does not. If that id is missing, the employee step fails before any Xero write.

### Idempotency

A second queue delivery for the same Airtable record does not start a second Workflow, so it does not create a second employee or contact and does not send Slack or email again (`notifications-not-resent`).

- Employees and contacts: before either create, look up Xero by email, then by name (`xero-email-skip-name-hold`). An email match skips both creates and logs the Airtable record id and the Xero ids. A name-only match is held and flagged in Slack for a person to check. It is not created, and it is not silently skipped. Dry run does not call Xero.
- When nothing matches, the employee POST uses `Idempotency-Key` `instructor-onboarding:{instanceId}:employee`. The first live instance id is the Airtable record id, so that key is `instructor-onboarding:{recordId}:employee`. A retried step in the same instance hits the same key. A new instance, such as `{recordId}-retry-1`, uses its own key so Xero does not refuse the corrected request. The create step does not patch name, tax, or address (`employee-not-updated-on-rerun`). A later step GETs the employee and POSTs the full pay template. Payroll AU employee create and pay-template update bodies are a bare JSON array. The accounting contact POST stays `{Contacts:[...]}`.
- When nothing matches, the contact POST uses `ContactNumber` `airtable:{recordId}` (`contact-number-airtable-record-id`). A retry of that contact updates it.
- Do not run this beside the Zap, and do not backfill history. The hourly poll only picks up rows created after `SAFETY_NET_NOT_BEFORE`. `POST /run` with the ingress token processes one record id immediately and does not move that cursor.

### Hourly poll

The hourly cron is the trigger. It replaces the Airtable automation and the daily safety net. There is not a second cron. The daily cron `0 21 * * *` was never attached.

If `SAFETY_NET_NOT_BEFORE` is unset and KV has no watermark, the poll lists nothing (`safety-net-not-before`). Otherwise it lists with the created-time filter and no view (`no-view-or-filter` is the Zap's shape; the poll adds only that created-time filter). Rows come back with their fields, including attachment metadata. The poll enqueues the row. It does not read the record again. The queue starts the Workflow. A record id that already has a Workflow instance is acked as a duplicate and does not write to Xero.

### Switchover from Zapier

**Do not switch this on, and do not turn Zap 364623444 off, without Thiago's explicit go.** This repository does not perform switchover.

1. Compare Slack copy with the live Zap. The instructor email body is the verbatim step 7 HTML (`message-text-reconstructed-from-summary`). The Gmail signature HTML was not in that export.
2. Decide the oddities below that are still product calls. The `+61` mobile prefix is one of them. Behavior is unchanged.
3. Put secrets in Wrangler. Do not commit them. Copy the weekly payroll calendar id into `XERO_WEEKLY_PAYROLL_CALENDAR_ID`.
4. Set `SAFETY_NET_NOT_BEFORE` to the switchover instant. Leave it unset until then so the poll cannot scan history. Set `AIRTABLE_TOKEN` as a Worker secret. Do not commit it.
5. Do not install an Airtable automation. The free plan cannot run scripts.
6. Run `mode: "shadow"` against fixtures, or later against read-only credentials, and compare payloads with a recent Zap run.
7. After the explicit go: turn the Zap **off**, then let the hourly poll run. **Do not run both.** An email already in Xero is skipped. A name match without that email is held for a person to check. Attaching the cron may need a free cron slot on the Workers Free plan.

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
| `contact-mobile-plus61-prefix` | Contact mobile drops a leading 0 and is `+61 ` plus the rest, so `0400 000 000` becomes `+61 400 000 000`. Compact E.164 (`0412345678` → `+61412345678`) is not applied. Employee mobile is unchanged. |
| `employee-bank-left-empty` | Employee BSB, account, middle name, phone, and job title are empty. |
| `tax-scale-type-null` | IncomeType is NONEMPLOYEE. TaxScaleType stays null. |
| `tfn-in-slack-and-email` | The Slack checklist reports TFN as PASS or MISSING and does not include the number. The instructor email still includes the TFN. |
| `no-view-or-filter` | The Zap had no view and no filter, so every new row was eligible. The poll still sets no view. It filters only by created time. |
| `attachments-included-but-unused` | Attachment metadata is kept. Bytes are not downloaded. Steps 2–7 do not read them. |
| `airtable-field-names-unconfirmed` | Column names are the map's labels, not confirmed field ids. |
| `airtable-inbox-query-sh4iX` | Inbox link query key is `sh4iX`, as written. Confirm the live URL. |
| `similar-super-fund-names-different-uuids` | Cbus and Media Super Accumulation keep different UUIDs. |
| `message-text-reconstructed-from-summary` | The completion Slack message is the onboarding checklist. Sensitive values are PASS or MISSING. The instructor email body is the verbatim step 7 HTML. The Gmail signature HTML was not in that export. |
| `country-literal-australia` | Country is the literal `Australia`. |
| `employee-not-updated-on-rerun` | The create step does not patch name, tax, or address. The pay-template step sends the full desired template so a retry replaces it. Contacts are updated by `ContactNumber`. |
| `slack-bank-line-is-account-number` | The checklist reports bank details as PASS or MISSING and does not print the account number. The map has no bank name. |

Airtable labels used: First Name, Last Name, DOB, Email, Gender, Mobile, Super Fund, Superannuation Member Number, TFN, Residential Address, City/Suburb, State, Postal Code, ABN, BSB, Account. DOB must already be `YYYY-MM-DD`. Values are not trimmed.

### Design additions

Safety around the Zap, not silent mapping fixes.

| Id | What this rebuild adds |
| --- | --- |
| `contact-number-airtable-record-id` | Stable Xero `ContactNumber`. |
| `workflow-instance-id` | One Workflow instance per Airtable record. A second delivery does not start a second run. |
| `safety-net-not-before` | The hourly poll lists nothing until `SAFETY_NET_NOT_BEFORE` is set or a KV watermark exists. |
| `no-durable-store` | Workflows stores step results. KV stores only the created-time watermark. D1 is not used. |
| `reject-numeric-airtable-fields` | Text columns such as BSB still reject numbers. TFN, ABN, member number, and Bank Account Number are live number columns and are read as integer text. |
| `notifications-not-resent` | A finished Slack or email step is not run again, and a duplicate queue message does not start another instance. |
| `abn-on-tax-declaration` | `TaxDeclaration.ABN` is the 11-digit Airtable ABN. The contact `TaxNumber` is the same ABN. |
| `ivan-sgc-fixed-amount` | One SGC line, `FIXEDAMOUNT`, expense `478`, liability `826`, no Amount and no 12%. A blank Fixed Amount is intentional and is not a failed check. The contact omits a default purchase account. Weekly 12% super stays on the existing payslip fix. |
| `pay-template-full-replace` | `updateEmployee` does not document merge versus replace. The step sends the full desired template. |
| `accounts-payable-tax-input` | No GST flag on Payroll AU. `AccountsPayableTaxType` is `INPUT` for both YES and NO until Thiago confirms. The unconfirmed NO value is BAS Excluded (`BASEXCLUDED`). |
| `emergency-contact-webhook-only` | Payroll AU has no emergency-contact field. The Patty webhook step is removed. The end check always reports it MISSING. |
| `xero-email-skip-name-hold` | Email match skips the create and is logged. Name-only match is held for a person to check and is not created. |

### Open decisions

Settled, and not repeated here as choices: Cloudflare Worker + Queue + Workflows, hourly Airtable poll into the queue (no automation script), Workflow instance id as the Xero lock, KV watermark for the poll, OAuth refresh token (not a Xero Custom Connection), no custom-code step. Contact mobile is `+61 ` plus the Airtable value with a leading 0 removed. Compact `+614…` is not applied. Dry-run logs mask TFN, bank account, BSB, ABN, and member number. The completion Slack post is the checklist: each sensitive value is PASS or MISSING, and a missing line uses the attention header. `SLACK_CHANNEL_ID` is the live channel. `SLACK_DRY_RUN_CHANNEL_ID` is required while dry run is on, including preview and held-match alerts. Dry run does not fall through to the live channel. `POST /run` is the authenticated one-record run. It respects dry run and the Workflow instance id, and it does not move the KV watermark. `SAFETY_NET_NOT_BEFORE` stays an env var. The poll uses that value as the initial cursor.

Still open:

1. Switchover: explicit go, Zap off before this is on, and the `SAFETY_NET_NOT_BEFORE` timestamp.
2. `contact-mobile-plus61-prefix`: the spaced `+61 ` form is applied. Compact `+614…` stays unused.
3. Xero demo company: optional later sandbox. Not connected from these tests.
4. Product calls on the other oddities: NSW on the employee, `{{=)}}` and the Sydney timezone assumption, BSB+account concatenation, null TaxScaleType, empty gender for Not Stated, TFN in Slack and email, reconstructed Slack text, `sh4iX` link, unconfirmed Airtable column names. The YES/NO GST split is still open: both stay `INPUT` until Thiago confirms.
5. If the Xero refresh token rotates on every use, KV would be the smallest place to store the new token. That store is not built, and it would not be the duplicate lock. Confirm the token is long-lived.
6. Whether any historical Instructors rows should ever be backfilled. The default is no.

### Environment variables

No secrets in the repo. Live adapters throw if a required variable is missing. They only call a `fetch` you pass in. Tests use fakes or an injected fetch.

| Variable | System | Purpose |
| --- | --- | --- |
| `INGRESS_TOKEN` | Worker | Bearer token on `POST /intake`. Compared with a hash, not `===`. |
| `AIRTABLE_TOKEN` | Airtable | Worker secret. Hourly list of Instructors (`data.records:read` on base `appePgXVPIIkgnvBQ`). Never committed. Tests do not use a real token. |
| `XERO_CLIENT_ID` | Xero | OAuth client for the Balance Moves org. |
| `XERO_CLIENT_SECRET` | Xero | OAuth client secret. |
| `XERO_REFRESH_TOKEN` | Xero | Refresh token secret. Used only when KV has no stored token. A rotated token is written to KV and read back. |
| `XERO_TENANT_ID` | Xero | Balance Moves tenant id. Sent as `Xero-Tenant-Id`. |
| `XERO_WEEKLY_PAYROLL_CALENDAR_ID` | Xero | Weekly calendar id. The employee step does not look it up. |
| `SLACK_BOT_TOKEN` | Slack | Bot token that can `chat.postMessage` to `#management`. |
| `GMAIL_CLIENT_ID` | Google | OAuth client that can send as `admin@balancemoves.com.au`. |
| `GMAIL_CLIENT_SECRET` | Google | OAuth client secret. |
| `GMAIL_REFRESH_TOKEN` | Google | Refresh token for that mailbox. |
| `SAFETY_NET_NOT_BEFORE` | Worker | Initial created-time cursor. Unset, with no KV watermark, blocks the poll. |

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

Payroll and accounting scopes the token needs: employees write, contacts write. Slack needs to post as a bot. Gmail needs to send. The hourly poll needs Airtable read.

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
| Mobile | Mobile, unchanged | `+61 ` + Mobile with a leading 0 removed (compact `+614…` is not applied) |
| Super Fund | SuperMemberships.SuperFundID | named in Slack and email |
| Superannuation Member Number | SuperMemberships.EmployeeNumber | |
| TFN | TaxDeclaration.TaxFileNumber | |
| Residential Address, City/Suburb, Postal Code | HomeAddress | POBOX postal address |
| State | ignored; region is NSW | Region |
| ABN | not sent | TaxNumber |
| BSB, Account | left empty | concatenated BankAccountDetails |
| (none) | EmploymentType CONTRACTOR, Status ACTIVE, basis NONEMPLOYEE, residency AUSTRALIANRESIDENT, country Australia, StartDate today | group Contractors |
