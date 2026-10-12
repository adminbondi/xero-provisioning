/**
 * Airtable automation script for the Instructors table.
 *
 * Trigger: When a record is created.
 * Action: Run a script.
 *
 * Automation inputs (do not paste the token into this file):
 *   recordId      — the triggering record id
 *   workerUrl     — the Worker URL ending in /intake
 *   ingressToken  — the same value as the Worker secret INGRESS_TOKEN
 *
 * The script sends REST-shaped field values. Single selects become their name.
 * Dates become YYYY-MM-DD. Attachments are passed through. The Worker parses
 * that body the same way it parses an Airtable REST record.
 *
 * This file is not executed by the tests or by the Worker.
 */

const { recordId, workerUrl, ingressToken } = input.config();

if (!recordId || !workerUrl || !ingressToken) {
  throw new Error("Set recordId, workerUrl, and ingressToken on the automation.");
}

const table = base.getTable("Instructors");
const record = await table.selectRecordAsync(recordId);
if (!record) {
  throw new Error(`Instructors record ${recordId} was not found.`);
}

function cellValue(field) {
  const value = record.getCellValue(field);
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  if (value && typeof value === "object" && !Array.isArray(value) && typeof value.name === "string") {
    return value.name;
  }
  return value;
}

const fields = {};
for (const field of table.fields) {
  const value = cellValue(field);
  if (value != null) fields[field.name] = value;
}

const response = await fetch(workerUrl, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${ingressToken}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    id: record.id,
    fields,
  }),
});

if (!response.ok) {
  const text = await response.text();
  throw new Error(`Worker intake failed (${response.status}): ${text.slice(0, 200)}`);
}
