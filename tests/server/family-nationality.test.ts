import test from "node:test";
import assert from "node:assert/strict";
import { validateNationalities } from "../../server/validation";

test("one nationality covers an entire multi-room family", () => {
  const errors: Record<string, string> = {};
  const result = validateNationalities(["tr"], 7, errors);
  assert.deepEqual(result, { nationalities: ["TR"], missing: false });
  assert.deepEqual(errors, {});
});

test("family nationality is required", () => {
  const errors: Record<string, string> = {};
  assert.deepEqual(validateNationalities([], 4, errors), { nationalities: null, missing: true });
});

test("multiple nationality entries are rejected regardless of guest count", () => {
  const errors: Record<string, string> = {};
  assert.equal(validateNationalities(["TR", "TR"], 2, errors).nationalities, null);
  assert.equal(errors.nationalities, "ONE_NATIONALITY_PER_FAMILY");
});

test("invalid country codes are rejected", () => {
  const errors: Record<string, string> = {};
  assert.equal(validateNationalities(["Turkey"], 3, errors).nationalities, null);
  assert.equal(errors.nationalities, "ISO_3166_ALPHA2_REQUIRED");
});
