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
  assert.match(pipeline, /tp\.status\s*=\s*'published'/);
});

test("Intervals sync is incremental and dashboard freshness is bounded", async () => {
  const [route, pipeline, cron] = await Promise.all([source("app/api/workspace/route.ts"), source("lib/pipeline.ts"), source("app/api/cron/route.ts")]);
  assert.match(route, /10 \* 60 \* 1000/);
  assert.match(route, /tenMinuteBucket/);
  assert.match(pipeline, /connection\.last_sync_at \? offsetIsoDate\(-14/);
  assert.match(pipeline, /const newest = offsetIsoDate\(1\)/);
  assert.match(pipeline, /queueStaleIntervalsSyncs/);
  assert.match(cron, /queueStaleIntervalsSyncs\(10\)/);
});

test("goals and generated plans preserve trail terrain and elevation", async () => {
  const [schema, route, planner, dashboard] = await Promise.all([source("db/schema.ts"), source("app/api/workspace/route.ts"), source("lib/planner.ts"), source("app/DashboardClient.tsx")]);
  for (const field of ["elevation_gain_m", "terrain_type", "technicality"]) assert.match(schema, new RegExp(field));
  assert.match(route, /elevationGainM/);
  assert.match(planner, /trainingAscent/);
  assert.match(planner, /Controlled uphill intervals/);
  assert.match(dashboard, /Elevation gain \(m\+\)/);
});

test("reference-plan titles are concise labels rather than warm-up text", async () => {
  const workspace = await source("lib/workspace.ts");
  assert.match(workspace, /conciseReferenceTitle/);
  assert.match(workspace, /at HM effort/);
  assert.doesNotMatch(workspace, /day\.details\.split/);
});

test("reference history is deduplicated once the live Intervals copy exists", async () => {
  const [workspace, pipeline, dedupe] = await Promise.all([source("lib/workspace.ts"), source("lib/pipeline.ts"), source("lib/activity-dedupe.ts")]);
  assert.match(workspace, /dedupeActivities\(rawActivityRows\)/);
  assert.match(pipeline, /dedupeActivities\(activityResult\.results/);
  assert.match(dedupe, /isReferencePair/);
  assert.match(dedupe, /providerPriority/);
});

test("Intervals webhook uses the nested activity id from the documented payload", async () => {
  const webhook = await source("app/api/intervals/webhook/route.ts");
  assert.match(webhook, /activity\?\.id/);
  assert.match(webhook, /intervals_webhook/);
});

test("automated draft generation has explicit athlete-readiness gates", async () => {
  const [planner, dashboard] = await Promise.all([source("lib/planner.ts"), source("app/DashboardClient.tsx")]);
  for (const requirement of ["primary_sport", "onboarding_completed_at", "profile.confirmed", "profile.restriction", "profile.trainingDays", "profile.weeklyKm", "recentFeedback"]) assert.match(planner, new RegExp(requirement.replace(".", "\\.")));
  assert.match(dashboard, /plan-readiness/);
  assert.match(dashboard, /Draft changes versus published plan/);
});
