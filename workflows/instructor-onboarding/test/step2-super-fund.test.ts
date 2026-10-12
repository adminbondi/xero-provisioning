import "./block-network.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { UnknownSuperFundError } from "../src/errors.ts";
import { SUPER_FUND_ENTRIES, lookupSuperFund } from "../src/lookups/super-funds.ts";
import { runInstructorOnboarding } from "../src/run.ts";
import { runtime, withFields } from "./helpers.ts";

test("step 2 maps every super fund from the Zap and only those strings", () => {
  assert.equal(SUPER_FUND_ENTRIES.length, 21);
  const ids = new Set<string>();
  const names = new Set<string>();
  for (const [name, id] of SUPER_FUND_ENTRIES) {
    assert.equal(lookupSuperFund(name), id);
    assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    ids.add(id);
    names.add(name);
  }
  assert.equal(ids.size, 21);
  assert.equal(names.size, 21);
  assert.equal(lookupSuperFund("AustralianSuper"), "4caabd49-1d08-4d8b-958b-d933a113e9c9");
  assert.notEqual(
    lookupSuperFund("Cbus (Construction and Building Unions Superannuation Fund)"),
    lookupSuperFund("Media Super Accumulation (THE TRUSTEE FOR CONSTRUCTION AND BUILDING UNIONS SUPERANNUATION FUND)"),
  );
});

test("step 2 has no fallback for an unknown super fund and does not call Xero", async () => {
  assert.throws(() => lookupSuperFund("Spaceship Super"), UnknownSuperFundError);
  assert.throws(() => lookupSuperFund("australiansuper"), UnknownSuperFundError);
  assert.throws(() => lookupSuperFund("AustralianSuper "), UnknownSuperFundError);
  const { fake, deps } = runtime();
  await assert.rejects(
    () => runInstructorOnboarding(withFields({ "Super Fund": "Spaceship Super" }), deps),
    (error: unknown) => {
      assert.ok(error instanceof UnknownSuperFundError);
      assert.equal(error.step, "super-fund");
      assert.match(error.message, /no fallback/i);
      return true;
    },
  );
  assert.equal(fake.calls.length, 0);
  assert.equal(fake.employees.length, 0);
  assert.equal(fake.contacts.length, 0);
  assert.equal(fake.slack.length, 0);
  assert.equal(fake.emails.length, 0);
});
