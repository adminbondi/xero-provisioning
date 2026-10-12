import "./block-network.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { UnknownGenderError } from "../src/errors.ts";
import { GENDER_ENTRIES, lookupGender } from "../src/lookups/gender.ts";
import { runInstructorOnboarding } from "../src/run.ts";
import { runtime, withFields } from "./helpers.ts";

test("step 3 maps gender codes exactly, including an empty Not Stated", () => {
  assert.deepEqual(GENDER_ENTRIES, [
    ["Male", "M"],
    ["Female", "F"],
    ["Non-Binary", "I"],
    ["Not Stated", ""],
  ]);
  assert.equal(lookupGender("Male"), "M");
  assert.equal(lookupGender("Female"), "F");
  assert.equal(lookupGender("Non-Binary"), "I");
  assert.equal(lookupGender("Not Stated"), "");
  assert.throws(() => lookupGender("male"), UnknownGenderError);
  assert.throws(() => lookupGender("N"), UnknownGenderError);
  assert.throws(() => lookupGender(""), UnknownGenderError);
});

test("step 3 stops before Xero when gender is not in the table", async () => {
  const { fake, deps } = runtime();
  await assert.rejects(() => runInstructorOnboarding(withFields({ Gender: "Prefer not to say" }), deps), UnknownGenderError);
  assert.equal(fake.calls.length, 0);
});

test("Not Stated stays an empty employee gender", async () => {
  const { deps } = runtime();
  const result = await runInstructorOnboarding(withFields({ Gender: "Not Stated" }), deps);
  assert.equal(result.genderCode, "");
  assert.equal(result.employee.payload.Gender, "");
  assert.ok(result.flags.includes("gender-not-stated-empty"));
});
