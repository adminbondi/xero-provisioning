import { employeeDetailsUrl } from "../config.ts";
import type { InstructorRecord, PattyWebhookPayload } from "../types.ts";

/**
 * Emergency contact cannot be set on the Payroll AU employee or the accounting contact.
 * It stays on this payload only.
 */
export function buildPattyWebhookPayload(input: {
  record: InstructorRecord;
  employeeId: string | null;
  contactId: string | null;
  orgShortCode: string;
}): PattyWebhookPayload {
  return {
    xeroEmployeeId: input.employeeId,
    xeroContactId: input.contactId,
    firstName: input.record.firstName,
    lastName: input.record.lastName,
    email: input.record.email,
    airtableRecordId: input.record.recordId,
    emergencyContactName: input.record.emergencyContactName,
    emergencyContactMobile: input.record.emergencyContactMobile,
    xeroEmployeeUrl: input.employeeId ? employeeDetailsUrl(input.employeeId, input.orgShortCode) : null,
  };
}
