/**
 * DRY RUN — in-memory fakes only.
 * Does not read credentials and does not call Xero, Slack, Gmail, or Airtable.
 */
import { createFakePorts } from "./fakes.ts";
import { sampleAirtableRecord } from "./fixtures/sample-instructor.ts";
import { MemoryWorkflowStore } from "./idempotency.ts";
import { runInstructorOnboarding } from "./run.ts";

const fake = createFakePorts();
const store = new MemoryWorkflowStore();
const result = await runInstructorOnboarding(sampleAirtableRecord(), {
  ports: fake.ports,
  store,
  mode: "live",
  now: () => new Date("2026-10-12T01:00:00.000Z"),
});

console.log(
  JSON.stringify(
    {
      banner: "DRY RUN — in-memory fakes only. No Xero, Slack, Gmail, or Airtable calls.",
      recordId: result.recordId,
      employeeId: result.employee.employeeId,
      employeeCreated: result.employee.created,
      contactId: result.contact.contactId,
      contactCreated: result.contact.created,
      slackSent: result.slack.sent,
      slackChannel: result.slack.channel,
      emailSent: result.email.sent,
      emailTo: result.email.message.to,
      startDate: result.startDate.resolved,
      customCodeApplied: result.customCodeApplied,
      flags: result.flags,
    },
    null,
    2,
  ),
);
