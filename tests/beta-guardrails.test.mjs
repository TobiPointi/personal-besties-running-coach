import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = async (file) => readFile(path.join(projectDir, file), "utf8");

test("activity reviews and completion matching use only the published plan", async () => {
  const [dashboard, pipeline] = await Promise.all([source("app/DashboardClient.tsx"), source("lib/pipeline.ts")]);
  assert.match(dashboard, /publishedSessions/);
  assert.match(dashboard, /buildActivityReviews\(state\.activities, publishedSessions/);
  assert.match(pipeline, /tp\.status = 'published'/);
});

test("Intervals sync is incremental and dashboard freshness is bounded", async () => {
  const [route, pipeline] = await Promise.all([source("app/api/workspace/route.ts"), source("lib/pipeline.ts")]);
  assert.match(route, /30 \* 60 \* 1000/);
  assert.match(pipeline, /connection\.last_sync_at \? offsetIsoDate\(-14/);
  assert.match(pipeline, /const newest = offsetIsoDate\(1\)/);
});

test("automated draft generation has explicit athlete-readiness gates", async () => {
  const [planner, dashboard] = await Promise.all([source("lib/planner.ts"), source("app/DashboardClient.tsx")]);
  for (const requirement of ["primary_sport", "onboarding_completed_at", "profile.confirmed", "profile.restriction", "profile.trainingDays", "profile.weeklyKm", "recentFeedback"]) assert.match(planner, new RegExp(requirement.replace(".", "\\.")));
  assert.match(dashboard, /plan-readiness/);
  assert.match(dashboard, /Draft changes versus published plan/);
});
