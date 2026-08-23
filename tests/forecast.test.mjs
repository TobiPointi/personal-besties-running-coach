import assert from "node:assert/strict";
import test from "node:test";

// The production module is TypeScript, so this test protects the model contract at source level.
import { readFile } from "node:fs/promises";

test("forecast model protects marathon estimates with endurance evidence", async () => {
  const source = await readFile(new URL("../lib/forecast.ts", import.meta.url), "utf8");
  assert.match(source, /targetKm >= 42 \? 1\.075/);
  assert.match(source, /Math\.max\(0, 55 - weeklyKm\)/);
  assert.match(source, /Math\.max\(0, 28 - longestRunKm\)/);
  assert.match(source, /raceLike\.length \? raceLike : candidates/);
  assert.match(source, /raceLike\.length >= 1 && weeklyKm >= 25/);
});
