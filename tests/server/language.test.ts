import test from "node:test";
import assert from "node:assert/strict";
import { isSupportedLanguage } from "../../server/language-routes";

test("J20 supported profile languages are en, tr, ar, ru only", () => {
  for (const code of ["en", "tr", "ar", "ru"]) assert.equal(isSupportedLanguage(code), true, code);
  for (const code of ["EN", "tr-TR", "fr", "de", "", null, undefined, 3, {}, ["en"]])
    assert.equal(isSupportedLanguage(code), false, String(code));
});
