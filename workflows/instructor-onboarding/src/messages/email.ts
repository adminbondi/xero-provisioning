import { abrAbnUrl, EMAIL_SUBJECT, STUDIO_ADDRESS, STUDIO_PHONE, STUDIO_WEB, type WorkflowConfig } from "../config.ts";
import type { InstructorRecord, OutboundEmail } from "../types.ts";

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function buildInstructorEmail(record: InstructorRecord, config: WorkflowConfig): OutboundEmail {
  const abr = abrAbnUrl(record.abn);
  const html = [
    `<p>Hello ${escapeHtml(record.firstName)},</p>`,
    "<p>Welcome. Please review &amp; reply confirming:</p>",
    "<p><strong>Tax Details</strong></p>",
    "<ul>",
    `<li>Bank account: ${escapeHtml(record.account)}</li>`,
    `<li>BSB: ${escapeHtml(record.bsb)}</li>`,
    `<li>ABN: ${escapeHtml(record.abn)}</li>`,
    `<li>ABR: <a href="${escapeHtml(abr)}">${escapeHtml(abr)}</a></li>`,
    `<li>TFN: ${escapeHtml(record.tfn)}</li>`,
    "</ul>",
    "<p><strong>Superannuation</strong></p>",
    "<ul>",
    `<li>Fund: ${escapeHtml(record.superFund)}</li>`,
    `<li>Member no: ${escapeHtml(record.memberNumber)}</li>`,
    "</ul>",
    `<p>Yvette &amp; Thiago<br>${STUDIO_PHONE}<br>${STUDIO_WEB}<br>${STUDIO_ADDRESS}</p>`,
  ].join("\n");
  return {
    from: config.emailFrom,
    fromName: config.emailFromName,
    to: record.email,
    cc: [config.emailCc],
    bcc: [config.emailBcc],
    subject: EMAIL_SUBJECT,
    html,
  };
}
