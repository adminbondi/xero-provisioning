import { UnknownGenderError } from "../errors.ts";

/** Exact Airtable gender → Xero gender code. Not Stated is an empty string. No fallback. */
export const GENDER_ENTRIES: readonly (readonly [string, string])[] = [
  ["Male", "M"],
  ["Female", "F"],
  ["Non-Binary", "I"],
  ["Not Stated", ""],
];

const GENDER_BY_LABEL: ReadonlyMap<string, string> = new Map(GENDER_ENTRIES);

export function lookupGender(value: string): string {
  if (!GENDER_BY_LABEL.has(value)) {
    throw new UnknownGenderError(value);
  }
  return GENDER_BY_LABEL.get(value) ?? "";
}
