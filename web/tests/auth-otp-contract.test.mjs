import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const authSource = await readFile(new URL("../app/AuthScreen.tsx", import.meta.url), "utf8");

test("the OTP field and submit button share the eight-digit contract", () => {
  assert.match(authSource, /const OTP_LENGTH = 8;/);
  assert.match(authSource, /maxLength=\{OTP_LENGTH\}/);
  assert.match(authSource, /code\.length !== OTP_LENGTH/);
  assert.doesNotMatch(authSource, /code\.length !== 6/);
});
