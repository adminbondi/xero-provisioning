import { UnknownSuperFundError } from "../errors.ts";

/**
 * Exact Airtable "Super Fund" formula text → Xero super fund UUID.
 * Copied from the Zap 364623444 map. No fallback and no normalisation.
 */
export const SUPER_FUND_ENTRIES: readonly (readonly [string, string])[] = [
  ["ANZ Smart Choice (USI MMF2076AU)", "0733bd6f-fb6e-4b86-add0-c278a19330d7"],
  ["Australian Ethical Retail Superannuation Fund (AUSTRALIAN ETHICAL SUPER)", "b1e4184c-b73e-48f0-9100-e92df89910d8"],
  ["Australian Retirement Trust Super Savings (Australian Retirement Trust)", "1cc4a87a-233e-41cc-a46d-66ad035babb7"],
  ["AustralianSuper", "4caabd49-1d08-4d8b-958b-d933a113e9c9"],
  ["Aware Super Future Saver (The Trustee for AWARE SUPER)", "0e8bfccf-5f0e-4132-8817-f0bb6f489e3e"],
  ["CareSuper (The Trustee for CareSuper)", "95b2eb8b-ea39-4cef-a85b-5f9a4eed01e1"],
  ["Cbus (Construction and Building Unions Superannuation Fund)", "6f2948d4-f2d1-4a79-9340-5112c9b0f0a9"],
  ["COMMONWEALTH ESSENTIAL SUPER", "8a9c2982-8af4-41ad-be8a-a0444ed4008e"],
  ["HESTA Super (HESTA)", "e78aa6ed-3335-42a9-a712-d1540742a27e"],
  ["HOSTPLUS Superannuation Fund - Industry (HOSTPLUS Superannuation Fund)", "4f24f857-64a2-4e15-a672-cda0391e2eae"],
  ["HUB24 Super Fund", "f04fc295-8976-4e5d-9555-ea41fce952ac"],
  ["Media Super Accumulation (THE TRUSTEE FOR CONSTRUCTION AND BUILDING UNIONS SUPERANNUATION FUND)", "f7f218b6-42e3-439b-b637-9e3382bef97d"],
  ["Mercer MyChoice (MERCER SUPER TRUST)", "5ebf0e4c-9f8a-401c-ba25-6f62c2a76912"],
  ["MLC MasterKey Business Super (including MLC MasterKey Personal Super) (MLC Super Fund)", "91c8225a-3bad-4c1b-85fa-c6d0763b263e"],
  ["MLC MasterKey Superannuation (THE TRUSTEE FOR MLC SUPER FUND)", "650aa714-6e5d-499f-8327-e2b10f2f68e2"],
  ["MyNorth Super (WEALTH PERSONAL SUPERANNUATION AND PENSION FUND)", "41892a02-8783-489d-9f75-41f1cc13c4b4"],
  ["Personal Choice Private eWrap Super Account (Personal Choice Private Fund)", "d70f2e4f-58a0-4d6d-b17a-356e1a778666"],
  ["Plum Super (MLC Super Fund)", "fb39bce1-9d3c-4231-ab47-e0885167bca7"],
  ["Rest Super (Retail Employees Superannuation Trust)", "3b999d98-5aaa-43ab-92c9-261d70c1dc8e"],
  ["UniSuper", "ab7c2572-627b-4ad8-9eb0-f68029c48feb"],
  ["Vanguard Super (The Trustee for Vanguard Super)", "78177e2d-008d-4b02-9daf-6f6ec55c1d64"],
];

const SUPER_FUND_BY_NAME: ReadonlyMap<string, string> = new Map(SUPER_FUND_ENTRIES);

export function lookupSuperFund(name: string): string {
  const id = SUPER_FUND_BY_NAME.get(name);
  if (id === undefined) {
    throw new UnknownSuperFundError(name);
  }
  return id;
}
