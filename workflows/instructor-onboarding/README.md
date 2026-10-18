# Instructor onboarding

Rebuild of Zapier Zap 364623444, steps 1–7, for Balance Moves (Bondi). Jira steps 8–9 are not implemented. There is no custom-code step: the published map has none, and the placeholder slot has been removed.

Host (decided, not deployed): one Cloudflare Worker. Once an hour it lists new rows in Airtable and puts each one on a Queue. The consumer starts one [Cloudflare Workflow](https://developers.cloudflare.com/workflows/) instance per record, using the Airtable record id as the instance id. Each Zap step is its own `step.do`, followed by an employee read, a pay-template finalise, and a Patty webhook. Airtable's free plan cannot run scripts, so there is no Airtable automation. This hourly cron is the only cron. It replaces the automation and the daily safety net. KV stores the created-time watermark. D1 is not used.

The repo README has the full write-up, including the watermark, the `+61` mobile oddity (behavior unchanged; proposed E.164 is `+614…`), and switchover (do not switch the Zap off without Thiago's explicit go).

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
| Hourly Airtable poll | `src/host/airtable-poll.ts` |
| Wrangler config | `wrangler.jsonc` |
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
npx wrangler kv namespace create AIRTABLE_CURSOR
```

`DRY_RUN` and `SAFETY_NET_NOT_BEFORE` are not in the top-level `wrangler.jsonc` vars. A plain `wrangler deploy` replaces every var with that file and would wipe the live values. Production deploys must use `npx wrangler deploy --keep-vars`. The `env.preview` block keeps dry-run defaults for a non-production env only. Do not deploy from this pull request.

`XERO_WEEKLY_PAYROLL_CALENDAR_ID` is the single WEEKLY payroll calendar id. The employee step posts once and does not list calendars. `SAFETY_NET_NOT_BEFORE` is the initial created-time cursor. Until that timestamp or a KV watermark exists, the poll lists nothing. The only cron in `wrangler.jsonc` is `0 * * * *` (minute 0 of every hour, UTC).

`AIRTABLE_TOKEN` is a Worker secret (`npx wrangler secret put AIRTABLE_TOKEN`). It is never committed. Tests do not need it. Put the namespace id from `kv namespace create` into `wrangler.jsonc` before a deploy. The placeholder id is not a real namespace.

Each hourly run is one Airtable list call, filtered with `IS_AFTER(CREATED_TIME(), watermark)`, page size 100, no view, and no per-record read. A second page is requested only when Airtable returns an offset. Steady state does not page: **720 list calls in a 30-day month** (24 × 30) and **744 in a 31-day month** (24 × 31). Both sit under Airtable's about 1,000 calls a month.

Xero auth is an OAuth refresh token, not a Custom Connection. It follows payroll `xero_api/token_store.py` (`shared_oauth_access_token` and `RenderRefreshTokenStore.persist_refresh_token`). The Worker store is the existing `AIRTABLE_CURSOR` KV key `xero-refresh-token`. That key is read before the `XERO_REFRESH_TOKEN` secret. A rotated token is saved and read back before any Xero call. The same isolate shares one refresh, and one `invalid_grant` re-reads the store a single time. The token value is not logged. KV also holds the created-time watermark.

## Airtable

Airtable's free plan cannot run scripts, so the record-created automation is not used. Do not install one. New rows are found by the hourly poll and sent through the existing queue, then the Workflow. `POST /intake` remains for a manual post. The Workflow instance id is still the duplicate lock for Xero.

## Required env vars

| Variable | System | Purpose |
| --- | --- | --- |
| `INGRESS_TOKEN` | Worker | Bearer token for a manual `POST /intake`. The hourly poll does not use it. |
| `AIRTABLE_TOKEN` | Airtable | Worker secret. Hourly read of Instructors in base `appePgXVPIIkgnvBQ`. Never commit it. |
| `XERO_CLIENT_ID` | Xero | OAuth client. |
| `XERO_CLIENT_SECRET` | Xero | OAuth client secret. |
| `XERO_REFRESH_TOKEN` | Xero | Refresh token secret. Used only when KV has no stored token. A rotated token is written to KV and read back. |
| `XERO_TENANT_ID` | Xero | Balance Moves tenant. |
| `XERO_WEEKLY_PAYROLL_CALENDAR_ID` | Xero | Weekly payroll calendar. Keeps the employee step to one POST. |
| `SLACK_BOT_TOKEN` | Slack | Post to `#management` as the bot. |
| `GMAIL_CLIENT_ID` | Google | Send as `admin@balancemoves.com.au`. |
| `GMAIL_CLIENT_SECRET` | Google | OAuth client secret. |
| `GMAIL_REFRESH_TOKEN` | Google | Refresh token for that mailbox. |
| `SAFETY_NET_NOT_BEFORE` | Worker | Initial created-time cursor. Unset, with no KV watermark, means the poll lists nothing. |
| `DRY_RUN` | Worker | Default `true`. Only `false` allows Xero, Slack, Gmail, and webhook writes. |
| `PATTY_WEBHOOK_URL` | Patty | Placeholder. Not set. A dry run logs the payload and does not POST. |
| `PATTY_WEBHOOK_SIGNING_SECRET` | Patty | Bearer token and HMAC key. Sent as `Authorization: Bearer` plus the exact value, not trimmed. Not set. |

`DRY_RUN` is on for the first deploy. A dry run logs each step's would-send payload and does not write. Those logs omit the TFN, bank account number, BSB, ABN, and super fund member number, and instead say whether each field is present. The dry-run Slack and email previews are masked the same way. A live #management Slack post is still the Zap text. Its Workflow instance id is `{record id}-dry` (Cloudflare ids cannot contain `:`). The dry-run poll uses its own KV watermark, so it does not consume the live cursor or the live instance id. A second dry run of the same record does not start another instance.

Do not deploy this pull request. When a production deploy does happen, use `npx wrangler deploy --keep-vars` so live `DRY_RUN` and `SAFETY_NET_NOT_BEFORE` stay as they are. Do not put those two keys back in the top-level vars.

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
- `tax-scale-type-null`
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
- `abn-on-tax-declaration`
- `ivan-sgc-fixed-amount`
- `pay-template-full-replace`
- `accounts-payable-tax-input`
- `emergency-contact-webhook-only`
- `xero-email-skip-name-hold` — email match skips the create and is logged. A name-only match is held for a person to check and is not created. `POST /run` runs one Airtable record id with the ingress token, respects dry run and the Workflow instance id, and does not move the KV watermark. Slack uses `SLACK_DRY_RUN_CHANNEL_ID` while dry run is on and `SLACK_CHANNEL_ID` only for a live run.
