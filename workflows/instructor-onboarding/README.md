# Instructor onboarding

Rebuild of Zapier Zap 364623444, steps 1–7, for Balance Moves (Bondi). Jira steps 8–9 are not implemented.

The repo README at the root has the full write-up: what the workflow does, the hosting **proposal**, switchover (do not switch the Zap off without Thiago's explicit go), env vars, and the oddities. This file is the package map.

## Run

```bash
npm ci
npm test
npm run typecheck
npm run dry-run
```

`npm run dry-run` uses in-memory fakes only. Tests block global `fetch`.

| Piece | Path |
| --- | --- |
| Pipeline | `src/run.ts` |
| Poll trigger | `src/poll.ts` |
| Super funds | `src/lookups/super-funds.ts` |
| Gender | `src/lookups/gender.ts` |
| Employee / contact mappings | `src/mappings/` |
| Slack and email | `src/messages/` |
| Custom-code slot | `src/custom-code.ts` |
| Fakes | `src/fakes.ts` |
| HTTP adapters (injected fetch) | `src/host/http.ts` |
| Hosting proposal (`decided: false`) | `src/host/proposal.ts` |
| Tests | `test/` |

Proposed host: Cloudflare Workers. Alternative: Render. Proposed trigger: Airtable poll every 2 minutes. Alternative: webhook. Not decided.

## Required env vars

| Variable | System | Purpose |
| --- | --- | --- |
| `AIRTABLE_TOKEN` | Airtable | Read Instructors in base `appePgXVPIIkgnvBQ`. |
| `XERO_CLIENT_ID` | Xero | OAuth client. |
| `XERO_CLIENT_SECRET` | Xero | OAuth client secret. |
| `XERO_REFRESH_TOKEN` | Xero | Refresh token. Rotated tokens need `onXeroRefreshToken`. |
| `XERO_TENANT_ID` | Xero | Balance Moves tenant. |
| `SLACK_BOT_TOKEN` | Slack | Post to `#management` as the bot. |
| `GMAIL_CLIENT_ID` | Google | Send as `admin@balancemoves.com.au`. |
| `GMAIL_CLIENT_SECRET` | Google | OAuth client secret. |
| `GMAIL_REFRESH_TOKEN` | Google | Refresh token for that mailbox. |

Optional: `XERO_ORG_SHORTCODE`, `SLACK_CHANNEL_ID`, `EMAIL_FROM`, `EMAIL_FROM_NAME`, `EMAIL_CC`, `EMAIL_BCC`, `START_DATE_TIMEZONE`, `AIRTABLE_BASE_ID`, `AIRTABLE_TABLE_ID`, `CONFLUENCE_GUIDE_URL`. Defaults are the Zap's public values.

No secrets belong in this repo. A Xero demo company is a possible later sandbox and is not connected here.

## Oddities preserved

- `employee-state-hardcoded-nsw`
- `super-fund-no-fallback`
- `gender-no-fallback`
- `gender-not-stated-empty`
- `start-date-zapier-expression`
- `contact-bank-bsb-concat`
- `contact-mobile-plus61-prefix`
- `employee-bank-left-empty`
- `income-type-and-tax-scale-null`
- `abn-on-contact-not-employee`
- `tfn-in-slack-and-email`
- `no-view-or-filter`
- `attachments-included-but-unused`
- `possible-missing-code-step` — map has no code step; slot is a no-op after gender lookup
- `airtable-field-names-unconfirmed`
- `airtable-inbox-query-sh4iX`
- `similar-super-fund-names-different-uuids`
- `message-text-reconstructed-from-summary`
- `country-literal-australia`
- `employee-not-updated-on-rerun`
- `slack-bank-line-is-account-number`

## Design additions

- `contact-number-airtable-record-id`
- `lookup-before-create`
- `poll-cursor-required`
- `idempotency-store-required`
- `reject-numeric-airtable-fields`
- `notifications-not-resent`
