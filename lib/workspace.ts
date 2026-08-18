import type { AppUser } from "./auth";
import { id, nowIso, platformEnv, todayIso } from "../db/runtime";

type Row = Record<string, unknown>;

async function all<T extends Row>(sql: string, ...bindings: unknown[]): Promise<T[]> {
  const result = await platformEnv().DB.prepare(sql).bind(...bindings).all<T>();
  return result.results ?? [];
}

export async function seedWorkspace(user: AppUser): Promise<void> {
  if (user.role !== "coach") return;
  const db = platformEnv().DB;
  const existing = await db.prepare("SELECT athlete_id FROM coach_athletes WHERE coach_user_id = ? LIMIT 1").bind(user.id).first();
  if (existing) return;
  const timestamp = nowIso();
  const athleteId = "athlete_tobias";
  const goalId = "goal_bad_ischl_2026";
  const planId = "plan_bad_ischl_v1";
  await db.batch([
    db.prepare("INSERT OR IGNORE INTO athletes (id, user_id, email, display_name, primary_sport, timezone, status, weekly_target_km, availability_json, created_at, updated_at) VALUES (?, ?, ?, ?, 'running', 'Europe/Vienna', 'active', 78, ?, ?, ?)").bind(athleteId, user.id, user.email, "Tobias Pointner", JSON.stringify({ preferredLongRunDay: 0, qualityDays: [2, 5] }), timestamp, timestamp),
    db.prepare("INSERT OR IGNORE INTO coach_athletes (coach_user_id, athlete_id, relationship_role, status, created_at) VALUES (?, ?, 'self', 'active', ?)").bind(user.id, athleteId, timestamp),
    db.prepare("INSERT OR IGNORE INTO goals (id, athlete_id, title, event_date, distance_km, goal_time_seconds, priority, status, notes, created_at) VALUES (?, ?, ?, '2026-09-27', 21.0975, 4500, 'A', 'active', ?, ?)").bind(goalId, athleteId, "Bad Ischl Half Marathon", "Run under 1:15 with even pacing and a controlled taper.", timestamp),
    db.prepare("INSERT OR IGNORE INTO assessments (id, athlete_id, assessed_at, status, fitness_score, fatigue_score, race_forecast_low_seconds, race_forecast_high_seconds, summary, evidence_json) VALUES (?, ?, ?, 'on_track', 68, 28, 4468, 4542, ?, ?)").bind("assessment_tobias_initial", athleteId, timestamp, "Current training supports the goal trajectory; retain two major weekly stimuli and protect recovery.", JSON.stringify({ source: "existing HM engine", confidence: "moderate" })),
    db.prepare("INSERT OR IGNORE INTO training_plans (id, athlete_id, goal_id, version, status, start_date, end_date, rationale, created_by, created_at, published_at) VALUES (?, ?, ?, 1, 'published', '2026-08-13', '2026-09-27', ?, ?, ?, ?)").bind(planId, athleteId, goalId, "Existing Bad Ischl HM plan imported as the protected baseline.", user.id, timestamp, timestamp),
  ]);
  const sessions = [
    ["2026-08-18", "threshold", "4 × 2 km controlled threshold", 15, "3:27–3:31/km", "Maintain threshold volume without turning the session into a test.", 1],
    ["2026-08-19", "recovery", "Very easy recovery run", 8, "4:45–5:30/km or slower", "Restore movement and absorb Tuesday's work.", 0],
    ["2026-08-21", "economy", "10 × 400 m controlled fast", 12, "78–80 seconds per 400 m", "Maintain speed reserve and relaxed mechanics.", 1],
    ["2026-08-23", "long_run", "Easy rolling long run", 21, "Conversational effort", "Aerobic durability without a fast finish.", 0],
    ["2026-08-25", "hm_specific", "2 × 4 km at HM effort", 15, "3:31–3:34/km", "Extend controlled time near goal intensity.", 1],
  ];
  for (const [date, type, title, distance, pace, purpose, major] of sessions) {
    await db.prepare("INSERT OR IGNORE INTO planned_sessions (id, plan_id, athlete_id, session_date, workout_type, title, details, planned_distance_km, pace_guidance, hr_guidance, purpose, fatigue_modification, major_stimulus, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'planned')")
      .bind(`session_${date}`, planId, athleteId, date, type, title, title, distance, pace, "Use HR as a secondary check, not a target.", purpose, "Reduce volume or switch to easy running if fatigue or pain is abnormal.", major).run();
  }
}

export async function getWorkspaceState(user: AppUser, requestedAthleteId?: string | null) {
  await seedWorkspace(user);
  const athleteRows = user.role === "coach"
    ? await all<Row>("SELECT a.* FROM athletes a JOIN coach_athletes ca ON ca.athlete_id = a.id WHERE ca.coach_user_id = ? AND ca.status = 'active' ORDER BY CASE a.status WHEN 'active' THEN 0 ELSE 1 END, a.display_name", user.id)
    : await all<Row>("SELECT * FROM athletes WHERE user_id = ? ORDER BY display_name", user.id);
  const selected = athleteRows.find((row) => row.id === requestedAthleteId) ?? athleteRows[0] ?? null;
  if (!selected) return { user, athletes: [], selectedAthlete: null };
  const athleteId = String(selected.id);
  const [goalRows, testRows, stageRows, planRows, sessionRows, activityRows, feedbackRows, assessmentRows, connectionRows, jobRows, notificationRows, noteRows] = await Promise.all([
    all<Row>("SELECT * FROM goals WHERE athlete_id = ? ORDER BY event_date", athleteId),
    all<Row>("SELECT * FROM lactate_tests WHERE athlete_id = ? ORDER BY test_date DESC", athleteId),
    all<Row>("SELECT ls.* FROM lactate_stages ls JOIN lactate_tests lt ON lt.id = ls.test_id WHERE lt.athlete_id = ? ORDER BY ls.test_id, ls.stage_number", athleteId),
    user.role === "coach"
      ? all<Row>("SELECT * FROM training_plans WHERE athlete_id = ? ORDER BY version DESC", athleteId)
      : all<Row>("SELECT * FROM training_plans WHERE athlete_id = ? AND status = 'published' ORDER BY version DESC", athleteId),
    all<Row>("SELECT * FROM planned_sessions WHERE athlete_id = ? ORDER BY session_date LIMIT 200", athleteId),
    all<Row>("SELECT * FROM activities WHERE athlete_id = ? ORDER BY activity_date DESC LIMIT 80", athleteId),
    all<Row>("SELECT * FROM athlete_feedback WHERE athlete_id = ? ORDER BY feedback_date DESC, created_at DESC LIMIT 30", athleteId),
    all<Row>("SELECT * FROM assessments WHERE athlete_id = ? ORDER BY assessed_at DESC LIMIT 10", athleteId),
    all<Row>("SELECT id, provider, external_athlete_id, scope, status, last_sync_at, created_at, updated_at FROM data_connections WHERE athlete_id = ?", athleteId),
    all<Row>("SELECT * FROM jobs WHERE athlete_id = ? ORDER BY scheduled_at DESC LIMIT 15", athleteId),
    all<Row>("SELECT * FROM notifications WHERE athlete_id = ? ORDER BY created_at DESC LIMIT 15", athleteId),
    user.role === "coach" ? all<Row>("SELECT * FROM coach_notes WHERE athlete_id = ? ORDER BY created_at DESC LIMIT 20", athleteId) : Promise.resolve([]),
  ]);
  const recentActivities = activityRows.filter((row) => String(row.activity_date) >= offsetDate(-27));
  const volume28 = recentActivities.reduce((sum, row) => sum + Number(row.distance_km ?? 0), 0);
  const load28 = recentActivities.reduce((sum, row) => sum + Number(row.training_load ?? 0), 0);
  const recentFeedback = feedbackRows[0];
  const activeGoal = goalRows.find((row) => row.status === "active") ?? goalRows[0];
  const latestAssessment = assessmentRows[0];
  const publishedPlan = planRows.find((row) => row.status === "published");
  const visibleSessions = user.role === "athlete" && publishedPlan
    ? sessionRows.filter((row) => row.plan_id === publishedPlan.id)
    : sessionRows;
  const upcoming = visibleSessions.filter((row) => String(row.session_date) >= todayIso()).slice(0, 14);
  return {
    user,
    athletes: athleteRows.map(publicAthlete),
    selectedAthlete: publicAthlete(selected),
    goals: goalRows,
    tests: testRows.map((test) => ({ ...test, stages: stageRows.filter((stage) => stage.test_id === test.id) })),
    plans: planRows,
    sessions: visibleSessions,
    upcoming,
    activities: activityRows,
    feedback: feedbackRows,
    assessments: assessmentRows,
    connections: connectionRows,
    jobs: jobRows,
    notifications: notificationRows,
    notes: noteRows,
    metrics: {
      daysToGoal: activeGoal ? Math.max(0, Math.ceil((new Date(`${activeGoal.event_date}T12:00:00Z`).getTime() - Date.now()) / 86400000)) : null,
      volume28Km: Math.round(volume28 * 10) / 10,
      load28: Math.round(load28),
      fitnessScore: Number(latestAssessment?.fitness_score ?? 0),
      fatigueScore: Number(latestAssessment?.fatigue_score ?? recentFeedback?.fatigue ?? 0),
      recoveryStatus: recoveryLabel(recentFeedback),
      forecastLow: latestAssessment?.race_forecast_low_seconds ?? null,
      forecastHigh: latestAssessment?.race_forecast_high_seconds ?? null,
      attention: attentionItems({ recentFeedback, testRows, jobRows, connectionRows }),
    },
  };
}

function publicAthlete(row: Row) {
  return {
    id: row.id, userId: row.user_id, email: row.email, displayName: row.display_name,
    primarySport: row.primary_sport, timezone: row.timezone, status: row.status,
    weeklyTargetKm: row.weekly_target_km, availability: parseJson(row.availability_json), injuryNotes: row.injury_notes,
  };
}

function parseJson(value: unknown) { try { return JSON.parse(String(value ?? "{}")); } catch { return {}; } }
function offsetDate(days: number) { const date = new Date(); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0, 10); }
function recoveryLabel(feedback?: Row) {
  if (!feedback) return "Check in";
  if (String(feedback.pain ?? "").trim()) return "Review pain";
  if (Number(feedback.fatigue ?? 0) >= 8) return "Recover";
  if (Number(feedback.fatigue ?? 0) >= 6) return "Caution";
  return "Ready";
}
function attentionItems(input: { recentFeedback?: Row; testRows: Row[]; jobRows: Row[]; connectionRows: Row[] }) {
  const items: { level: string; label: string }[] = [];
  if (!input.recentFeedback) items.push({ level: "warning", label: "Athlete feedback missing" });
  if (input.recentFeedback?.pain) items.push({ level: "critical", label: "Pain reported — coach review" });
  if (!input.testRows.length) items.push({ level: "info", label: "No physiological test recorded" });
  if (!input.connectionRows.length) items.push({ level: "info", label: "Intervals.icu not connected" });
  if (input.jobRows.some((job) => job.status === "failed")) items.push({ level: "critical", label: "Data pipeline needs attention" });
  return items.slice(0, 4);
}

export async function audit(user: AppUser, action: string, entityType: string, entityId?: string | null, athleteId?: string | null, metadata: Row = {}) {
  await platformEnv().DB.prepare("INSERT INTO audit_events (id, actor_user_id, athlete_id, action, entity_type, entity_id, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(id("audit"), user.id, athleteId ?? null, action, entityType, entityId ?? null, JSON.stringify(metadata), nowIso()).run();
}
