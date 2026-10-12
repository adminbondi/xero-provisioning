export function emailsMatch(left: string, right: string): boolean {
  return left.localeCompare(right, "en", { sensitivity: "accent" }) === 0;
}

/** Trimmed, case-insensitive. Empty strings do match each other; callers skip a blank name. */
export function namesMatch(left: string, right: string): boolean {
  return left.trim().localeCompare(right.trim(), "en", { sensitivity: "accent" }) === 0;
}
