import type { AirtableApiRecord } from "../types.ts";

const SAMPLE: AirtableApiRecord = {
  id: "recInstructor001",
  createdTime: "2026-10-12T01:00:00.000Z",
  fields: {
    "First Name": "Avery",
    "Last Name": "Nguyen",
    DOB: "1992-04-18",
    Email: "avery.nguyen.example@example.com",
    Gender: "Female",
    Mobile: "0412345678",
    "Super Fund": "AustralianSuper",
    "Superannuation Fund Name": "STA0100AU - AustralianSuper",
    "Superannuation Member Number": "SM-100200",
    TFN: "123456782",
    "Residential Address": "1 Example Street",
    "City/Suburb": "Bondi Beach",
    State: "VIC",
    "Postal Code": "2026",
    ABN: "12345678901",
    "ABN Registered for GST": [{ name: "YES" }],
    BSB: "062000",
    Account: "90817263",
    "Bank Account Number": "55556666",
    "Emergency Contact Name": "Sam Nguyen",
    "Emergency Contact Mobile": "0499888777",
    Certificate: [{ id: "att1", url: "https://example.invalid/cert.pdf", filename: "cert.pdf" }],
  },
};

/** Fake instructor used by tests and the local dry-run script. Not a real person. */
export function sampleAirtableRecord(): AirtableApiRecord {
  return structuredClone(SAMPLE);
}
