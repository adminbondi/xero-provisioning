# Instructor onboarding

Rebuild of Zapier Zap 364623444, steps 1–7, for Balance Moves (Bondi). Jira steps 8–9 are not implemented. There is no custom-code step: the published map has none, and the placeholder slot has been removed.

Host (decided, not deployed): one Cloudflare Worker. An Airtable automation posts the new row to `POST /intake`. The Worker puts it on a Queue. The consumer starts one [Cloudflare Workflow](https://developers.cloudflare.com/workflows/) instance per record, using the Airtable record id as the instance id. Each of the seven steps is its own `step.do`. A daily cron is the safety net for rows that never reached the queue. D1 and KV are not used.

The repo README has the full write-up, including why there is no durable store, the `+61` mobile oddity (behavior unchanged; proposed E.164 is `+614…`), and switchover (do not switch the Zap off without Thiago's explicit go).

## Run

```bash
npm ci
npm test
npm run typecheck
npm run dry-run
```

`npm run dry-run` uses in-memory fakes only. Tests block global `fetch`. Nothing here is deployed.

| Piece | Path |
| --- | --- |
| Seven workflow steps | `src/run.ts` |
| Step retry settings | `src/host/step-config.ts` |
| Worker (fetch, queue, cron, Workflow class) | `src/host/worker.ts` |
| Intake auth | `src/host/intake.ts` |
| Queue consumer | `src/host/queue-consumer.ts` |
| Daily safety net | `src/host/safety-net.ts` |
| Wrangler config | `wrangler.jsonc` |
| Airtable automation script | `airtable/on-record-created.js` |
| Super funds | `src/lookups/super-funds.ts` |
| Gender | `src/lookups/gender.ts` |
| Employee / contact mappings | `src/mappings/` |
| Slack and email | `src/messages/` |
| Fakes | `src/fakes.ts` |
| HTTP adapters (injected fetch) | `src/host/http.ts` |
| Hosting decision | `src/host/decision.ts` |
| Tests | `test/` |

## Queue and secrets

Do not run these against a live account from this pull request. They are the setup, for later.

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

`DRY_RUN` is already `"true"` in `wrangler.jsonc`. Do not change it to `false` in this setup.

`XERO_WEEKLY_PAYROLL_CALENDAR_ID` is the single WEEKLY payroll calendar id. The employee step posts once and does not list calendars. `SAFETY_NET_NOT_BEFORE` is an ISO timestamp. The daily check ignores rows created at or before it. The cron in `wrangler.jsonc` is `0 21 * * *` (21:00 UTC).

Xero auth is an OAuth refresh token, not a Custom Connection. If Xero returns a new refresh token, the step fails instead of dropping it. There is no KV row to store the replacement.

## Airtable automation

In the Instructors table, add an automation: when a record is created, run `airtable/on-record-created.js`. Set three inputs: `recordId` (the triggering record), `workerUrl` (the Worker origin plus `/intake`), and `ingressToken` (the same value as `INGRESS_TOKEN`). Do not paste the token into the script file.

## Required env vars

| Variable | System | Purpose |
| --- | --- | --- |
| `INGRESS_TOKEN` | Worker | Bearer token the Airtable script sends to `POST /intake`. |
| `AIRTABLE_TOKEN` | Airtable | Safety-net read of Instructors in base `appePgXVPIIkgnvBQ`. |
| `XERO_CLIENT_ID` | Xero | OAuth client. |
| `XERO_CLIENT_SECRET` | Xero | OAuth client secret. |
| `XERO_REFRESH_TOKEN` | Xero | Refresh token. A rotated token is refused, not stored. |
| `XERO_TENANT_ID` | Xero | Balance Moves tenant. |
| `XERO_WEEKLY_PAYROLL_CALENDAR_ID` | Xero | Weekly payroll calendar. Keeps the employee step to one POST. |
| `SLACK_BOT_TOKEN` | Slack | Post to `#management` as the bot. |
| `GMAIL_CLIENT_ID` | Google | Send as `admin@balancemoves.com.au`. |
| `GMAIL_CLIENT_SECRET` | Google | OAuth client secret. |
| `GMAIL_REFRESH_TOKEN` | Google | Refresh token for that mailbox. `GET /oauth/google/callback` stores it after Google redirects. The response and logs do not include the code or the token. |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare | Lets that callback write the refresh token. Not required for dry run. |
| `CLOUDFLARE_API_TOKEN` | Cloudflare | Same. Workers script write permission. Not required for dry run. |
| `SAFETY_NET_NOT_BEFORE` | Worker | Switchover timestamp. Unset means the daily check lists nothing. |
| `DRY_RUN` | Worker | Default `true`. Only `false` allows Xero, Slack, and Gmail writes. |

`DRY_RUN` is on for the first deploy. A dry run logs each step's would-send payload and does not write. Its Workflow instance id is `{record id}-dry` (Cloudflare ids cannot contain `:`). That does not use the live id, so the same record can be replayed live after `DRY_RUN` is set to `false`. A second dry run of the same record does not start another instance.

After merge: deploy with `DRY_RUN=true`, set `SAFETY_NET_NOT_BEFORE` to the deploy instant in UTC, post one row to `/intake`, and read the `dry-run-would-send` logs. Do not set `DRY_RUN` to `false` until a later go. Thiago is turning the Zap off first.

Optional: `XERO_ORG_SHORTCODE`, `SLACK_CHANNEL_ID`, `EMAIL_FROM`, `EMAIL_FROM_NAME`, `EMAIL_CC`, `EMAIL_BCC`, `START_DATE_TIMEZONE`, `AIRTABLE_BASE_ID`, `AIRTABLE_TABLE_ID`, `CONFLUENCE_GUIDE_URL`. Defaults are the Zap's public values.

No secrets belong in this repo. A Xero demo company is a possible later sandbox and is not connected here.

## Oddities preserved

- `employee-state-hardcoded-nsw`
- `super-fund-no-fallback`
- `gender-no-fallback`
- `gender-not-stated-empty`
- `start-date-zapier-expression`
- `contact-bank-bsb-concat`
- `contact-mobile-plus61-prefix` — still `+61` plus the raw mobile (`0412…` becomes `+610412…`). Proposed E.164 drops the trunk 0 (`+614…`). Not applied.
- `employee-bank-left-empty`
- `income-type-and-tax-scale-null`
- `abn-on-contact-not-employee`
- `tfn-in-slack-and-email`
- `no-view-or-filter`
- `attachments-included-but-unused`
- `airtable-field-names-unconfirmed`
- `airtable-inbox-query-sh4iX`
- `similar-super-fund-names-different-uuids`
- `message-text-reconstructed-from-summary`
- `country-literal-australia`
- `employee-not-updated-on-rerun`
- `slack-bank-line-is-account-number`

## Design additions

- `contact-number-airtable-record-id`
- `workflow-instance-id`
- `safety-net-not-before`
- `no-durable-store`
- `reject-numeric-airtable-fields`
- `notifications-not-resent`
