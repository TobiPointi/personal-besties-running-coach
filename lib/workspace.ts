import type { AppUser } from "./auth";
import { id, nowIso, platformEnv, todayIso } from "../db/runtime";
import { referenceActivities, referencePerformance, referencePlanDays } from "./tobias-reference";
import { planningReadiness } from "./planner";

type Row = Record<string, unknown>;

async function all<T extends Row>(sql: string, ...bindings: unknown[]): Promise<T[]> {
  const result = await platformEnv().DB.prepare(sql).bind(...bindings).all<T>();
  return result.results ?? [];
}

export async function seedWorkspace(user: AppUser): Promise<void> {
  if (user.role !== "coach") return;
  const db = platformEnv().DB;
  const existing = await db.prepare("SELECT athlete_id FROM coach_athletes WHERE coach_user_id = ? LIMIT 1").bind(user.id).first();
  if (existing) { await ensureTobiasReferenceData(user); return; }
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
  await ensureTobiasReferenceData(user);
}

async function ensureTobiasReferenceData(user: AppUser) {
  const db = platformEnv().DB;
  const athlete = await db.prepare("SELECT id FROM athletes WHERE id = 'athlete_tobias' AND user_id = ?").bind(user.id).first<{ id: string }>();
  if (!athlete) return;
  const alreadyImported = await db.prepare("SELECT id FROM training_plans WHERE id = 'plan_bad_ischl_reference_v2'").first();
  const timestamp = nowIso();
  if (!alreadyImported) {
    await db.batch([
      db.prepare("UPDATE training_plans SET status = 'archived' WHERE athlete_id = 'athlete_tobias' AND status = 'published'").bind(),
      db.prepare("INSERT INTO training_plans (id, athlete_id, goal_id, version, status, start_date, end_date, rationale, created_by, created_at, published_at) VALUES ('plan_bad_ischl_reference_v2', 'athlete_tobias', 'goal_bad_ischl_2026', 2, 'published', '2026-08-14', '2026-09-27', ?, ?, ?, ?)")
        .bind("Original Bad Ischl plan restored from the local coaching engine. Completed sessions are retained; future sessions are the approved reference plan.", user.id, timestamp, timestamp),
    ]);
    const statements = referencePlanDays.map((day) => {
      const actualDistance = Number(day.actual?.distance_km ?? 0);
      const completed = day.status === "completed" || day.status === "completed-rest";
      const title = day.details.split(/[.;]/)[0] || day.workout_type;
      return db.prepare("INSERT INTO planned_sessions (id, plan_id, athlete_id, session_date, workout_type, title, details, planned_distance_km, pace_guidance, hr_guidance, purpose, fatigue_modification, major_stimulus, status, actual_distance_km, completed_at) VALUES (?, 'plan_bad_ischl_reference_v2', 'athlete_tobias', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(`reference_session_${day.date}`, day.date, day.workout_type, title, day.details, day.planned_distance_km, day.pace_guidance ?? null, day.hr_guidance ?? null, day.purpose ?? null, day.fatigue_modification ?? null, day.major_stimulus ? 1 : 0, completed ? "completed" : "planned", completed ? actualDistance : null, completed ? timestamp : null);
    });
    for (let index = 0; index < statements.length; index += 30) await db.batch(statements.slice(index, index + 30));
  }
  // The generic adaptive draft was created from missing logs, not an explicit
  // coaching decision. Keep the imported Bad Ischl plan as Tobias's protected
  // published baseline and remove that misleading draft from review.
  await db.prepare("UPDATE training_plans SET status = 'archived' WHERE athlete_id = 'athlete_tobias' AND status = 'draft' AND rationale LIKE 'Adaptive draft created because%'").run();
  await ensureTobiasLactateTest(db, timestamp);
  const activityStatements = referenceActivities.map(([date, name, distance, duration, elevation, providerId]) => db.prepare(`INSERT INTO activities (id, athlete_id, provider, provider_activity_id, activity_date, activity_type, name, distance_km, duration_seconds, elevation_gain_m, training_load, raw_summary_json, updated_at)
    VALUES (?, 'athlete_tobias', 'reference', ?, ?, 'Run', ?, ?, ?, ?, NULL, ?, ?)
    ON CONFLICT(athlete_id, provider, provider_activity_id) DO UPDATE SET distance_km=excluded.distance_km, duration_seconds=excluded.duration_seconds, updated_at=excluded.updated_at`)
    .bind(`reference_activity_${providerId}`, providerId, date, name, distance, duration, elevation, JSON.stringify({ source: "original local coaching dashboard" }), timestamp));
  for (let index = 0; index < activityStatements.length; index += 30) await db.batch(activityStatements.slice(index, index + 30));
  const performanceStatements = referencePerformance.map(([date, source, five, ten, half, marathon]) => db.prepare(`INSERT INTO performance_snapshots (id, athlete_id, snapshot_date, source, prediction_5k_seconds, prediction_10k_seconds, prediction_half_seconds, prediction_marathon_seconds, created_at)
    VALUES (?, 'athlete_tobias', ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET prediction_5k_seconds=excluded.prediction_5k_seconds, prediction_10k_seconds=excluded.prediction_10k_seconds, prediction_half_seconds=excluded.prediction_half_seconds, prediction_marathon_seconds=excluded.prediction_marathon_seconds, created_at=excluded.created_at`)
    .bind(`reference_performance_${date}_${source.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`, date, source, five, ten, half, marathon, timestamp));
  for (let index = 0; index < performanceStatements.length; index += 30) await db.batch(performanceStatements.slice(index, index + 30));
}

async function ensureTobiasLactateTest(db: D1Database, timestamp: string) {
  const testId = "test_tobias_sim_2026_05_26";
  const stages = [
    [8.0, 240, 450, 117, 0.82], [10.0, 240, 360, 129, 0.84], [12.0, 240, 300, 147, 0.98],
    [14.0, 240, 257, 164, 1.46], [16.0, 240, 225, 181, 3.12], [18.0, 240, 200, 191, 5.41], [19.3, 150, 187, 198, 8.58],
  ];
  await db.prepare(`INSERT OR IGNORE INTO lactate_tests
    (id, athlete_id, test_date, protocol, venue, lt1_lactate, lt1_hr, lt1_pace_seconds_km, lt2_lactate, lt2_hr, lt2_pace_seconds_km, interpretation_method, confidence, notes, created_at)
    VALUES (?, 'athlete_tobias', '2026-05-26', ?, ?, 0.91, 132, 346, 2.40, 176, 232, 'SIM_5_HR_ZONES_V1; individual aerobic threshold + Dmax', 'high', ?, ?)`)
    .bind(testId, "Treadmill incremental test: 6 × 4 min stages (8–18 km/h) + 2:30 final stage at 19.3 km/h.", "SIM – Sport In Motion, Linz", "Source report: individual aerobic threshold 10.4 km/h, 0.91 mmol/L, 132 bpm (5:47/km). Dmax / Free Freiburg threshold 15.5 km/h, 2.40 mmol/L, 176 bpm (3:52/km). Reported running HR bands: REG <145; GA-ext 145–162; GA-int 162–171; SB 171–178; SB+ ≥178 bpm (report gives 178–181).", timestamp).run();
  await db.batch(stages.map(([speed, duration, pace, hr, lactate], index) => db.prepare(`INSERT OR IGNORE INTO lactate_stages
    (id, test_id, stage_number, duration_seconds, pace_seconds_km, speed_kph, heart_rate, lactate_mmol, rpe)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`).bind(`${testId}_stage_${index + 1}`, testId, index + 1, duration, pace, speed, hr, lactate)));
}

export async function getWorkspaceState(user: AppUser, requestedAthleteId?: string | null) {
  await seedWorkspace(user);
  const athleteRows = user.role === "coach"
    ? await all<Row>("SELECT a.* FROM athletes a JOIN coach_athletes ca ON ca.athlete_id = a.id WHERE ca.coach_user_id = ? AND ca.status = 'active' ORDER BY CASE a.status WHEN 'active' THEN 0 ELSE 1 END, a.display_name", user.id)
    : await all<Row>("SELECT * FROM athletes WHERE user_id = ? ORDER BY display_name", user.id);
  // Keep the athlete switch path to two database reads for the list, rather than one
  // count query per athlete. The sidebar may contain considerably more athletes than the
  // selected dashboard needs to render.
  const athleteIds = athleteRows.map((row) => String(row.id));
  const countRows = athleteIds.length ? await all<Row>(`SELECT a.id,
      (SELECT COUNT(*) FROM goals WHERE athlete_id = a.id) AS goals,
      (SELECT COUNT(*) FROM lactate_tests WHERE athlete_id = a.id) AS tests,
      (SELECT COUNT(*) FROM data_connections WHERE athlete_id = a.id AND status = 'active') AS connections,
      (SELECT COUNT(*) FROM activities WHERE athlete_id = a.id) AS activities
    FROM athletes a WHERE a.id IN (${athleteIds.map(() => "?").join(", ")})`, ...athleteIds) : [];
  const countsByAthlete = new Map(countRows.map((row) => [String(row.id), row]));
  const enrichedAthletes: Row[] = athleteRows.map((row): Row => {
    const counts = countsByAthlete.get(String(row.id));
    return { ...row, setup_goals: counts?.goals ?? 0, setup_tests: counts?.tests ?? 0, setup_connections: counts?.connections ?? 0, setup_activities: counts?.activities ?? 0 };
  });
  const selected = enrichedAthletes.find((row) => row.id === requestedAthleteId) ?? enrichedAthletes[0] ?? null;
  if (!selected) return { user, athletes: [], selectedAthlete: null };
  const athleteId = String(selected.id);
  const [goalRows, testRows, stageRows, testRequestRows, performanceRows, planRows, sessionRows, activityRows, feedbackRows, assessmentRows, connectionRows, jobRows, notificationRows, noteRows] = await Promise.all([
    all<Row>("SELECT * FROM goals WHERE athlete_id = ? ORDER BY event_date", athleteId),
    all<Row>("SELECT * FROM lactate_tests WHERE athlete_id = ? ORDER BY test_date DESC", athleteId),
    all<Row>("SELECT ls.* FROM lactate_stages ls JOIN lactate_tests lt ON lt.id = ls.test_id WHERE lt.athlete_id = ? ORDER BY ls.test_id, ls.stage_number", athleteId),
    all<Row>("SELECT * FROM lactate_test_requests WHERE athlete_id = ? ORDER BY created_at DESC", athleteId),
    all<Row>("SELECT * FROM performance_snapshots WHERE athlete_id = ? ORDER BY snapshot_date ASC", athleteId),
    user.role === "coach"
      ? all<Row>("SELECT * FROM training_plans WHERE athlete_id = ? ORDER BY version DESC", athleteId)
      : all<Row>("SELECT * FROM training_plans WHERE athlete_id = ? AND status = 'published' ORDER BY version DESC", athleteId),
    all<Row>("SELECT * FROM planned_sessions WHERE athlete_id = ? ORDER BY session_date LIMIT 200", athleteId),
    // The activity report currently offers a one-year view. Avoid transferring an
    // unbounded training history every time the coach changes athlete.
    all<Row>("SELECT * FROM activities WHERE athlete_id = ? AND activity_date >= ? ORDER BY activity_date DESC LIMIT 400", athleteId, offsetDate(-365)),
    all<Row>("SELECT * FROM athlete_feedback WHERE athlete_id = ? ORDER BY feedback_date DESC, created_at DESC LIMIT 30", athleteId),
    all<Row>("SELECT * FROM assessments WHERE athlete_id = ? ORDER BY assessed_at DESC", athleteId),
    all<Row>("SELECT id, provider, external_athlete_id, scope, status, last_sync_at, created_at, updated_at FROM data_connections WHERE athlete_id = ?", athleteId),
    all<Row>("SELECT * FROM jobs WHERE athlete_id = ? ORDER BY scheduled_at DESC LIMIT 15", athleteId),
    all<Row>("SELECT * FROM notifications WHERE athlete_id = ? ORDER BY created_at DESC LIMIT 15", athleteId),
    user.role === "coach" ? all<Row>("SELECT * FROM coach_notes WHERE athlete_id = ? ORDER BY created_at DESC LIMIT 20", athleteId) : Promise.resolve([]),
  ]);
  const recentActivities = activityRows.filter((row) => String(row.activity_date) >= offsetDate(-27));
  const recentRuns = recentActivities.filter((row) => isRunActivity(row.activity_type));
  const volume28 = recentRuns.reduce((sum, row) => sum + Number(row.distance_km ?? 0), 0);
  const load28 = recentActivities.reduce((sum, row) => sum + Number(row.training_load ?? 0), 0);
  const recentFeedback = feedbackRows[0];
  const activeGoal = goalRows.find((row) => row.status === "active") ?? goalRows[0];
  const latestAssessment = assessmentRows[0];
  const forecast = parseJson(latestAssessment?.evidence_json).forecast as Row | undefined;
  const publishedPlan = planRows.find((row) => row.status === "published");
  const pendingPlanAdjustment = planRows.find((row) => row.status === "draft") ?? (user.role === "athlete"
    ? await platformEnv().DB.prepare("SELECT version, rationale, created_at FROM training_plans WHERE athlete_id = ? AND status = 'draft' ORDER BY version DESC LIMIT 1").bind(athleteId).first<Row>()
    : null);
  const visibleSessions = user.role === "athlete" && publishedPlan
    ? sessionRows.filter((row) => row.plan_id === publishedPlan.id)
    : sessionRows;
  const dueSessions = visibleSessions.filter((row) => row.plan_id === publishedPlan?.id && row.workout_type !== "rest" && String(row.session_date) <= todayIso());
  const completedSessions = dueSessions.filter((row) => row.status === "completed");
  const adherencePercent = dueSessions.length ? Math.round((completedSessions.length / dueSessions.length) * 100) : null;
  const upcoming = visibleSessions.filter((row) => String(row.session_date) >= todayIso()).slice(0, 14);
  const planReadinessReasons = planningReadiness({ athlete: selected, goal: activeGoal ?? {}, latestTest: testRows[0], recentFeedback, recentActivities: activityRows });
  return {
    user,
    athletes: enrichedAthletes.map(publicAthlete),
    selectedAthlete: publicAthlete(selected),
    goals: goalRows,
    tests: testRows.map((test) => ({ ...test, stages: stageRows.filter((stage) => stage.test_id === test.id) })),
    testRequests: testRequestRows,
    performanceSnapshots: performanceRows,
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
      weeklyKm: Math.round((volume28 / 4) * 10) / 10,
      load28: Math.round(load28),
      fitnessScore: Number(latestAssessment?.fitness_score ?? 0),
      fatigueScore: Number(latestAssessment?.fatigue_score ?? recentFeedback?.fatigue ?? 0),
      recoveryStatus: recoveryLabel(recentFeedback),
      forecastLow: latestAssessment?.race_forecast_low_seconds ?? null,
      forecastHigh: latestAssessment?.race_forecast_high_seconds ?? null,
      forecastConfidence: forecast?.confidence ?? null,
      forecastEvidence: forecast?.evidence ?? null,
      adherencePercent,
      completedSessions: completedSessions.length,
      dueSessions: dueSessions.length,
      planAdjustment: pendingPlanAdjustment ? { version: pendingPlanAdjustment.version, rationale: pendingPlanAdjustment.rationale, createdAt: pendingPlanAdjustment.created_at } : null,
      planReadiness: { ready: planReadinessReasons.length === 0, reasons: planReadinessReasons, sport: selected.primary_sport ?? "running" },
      attention: attentionItems({ recentFeedback, testRows, jobRows, connectionRows, adherencePercent }),
    },
  };
}

function publicAthlete(row: Row) {
  return {
    id: row.id, userId: row.user_id, email: row.email, displayName: row.display_name,
    primarySport: row.primary_sport, timezone: row.timezone, status: row.status,
    weeklyTargetKm: row.weekly_target_km, availability: parseJson(row.availability_json), injuryNotes: row.injury_notes,
    experienceLevel: row.experience_level, trainingDays: row.training_days, longRunDay: row.long_run_day, onboardingCompletedAt: row.onboarding_completed_at,
    setup: { profile:Boolean(row.onboarding_completed_at), goal:Number(row.setup_goals ?? 0)>0, lactate:Number(row.setup_tests ?? 0)>0, connection:Number(row.setup_connections ?? 0)>0, activities:Number(row.setup_activities ?? 0)>0 },
  };
}

function parseJson(value: unknown) { try { return JSON.parse(String(value ?? "{}")); } catch { return {}; } }
function isRunActivity(value: unknown) { return /run/i.test(String(value ?? "")); }
function offsetDate(days: number) { const date = new Date(); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0, 10); }
function recoveryLabel(feedback?: Row) {
  if (!feedback) return "Check in";
  if (String(feedback.pain ?? "").trim()) return "Review pain";
  if (Number(feedback.fatigue ?? 0) >= 8) return "Recover";
  if (Number(feedback.fatigue ?? 0) >= 6) return "Caution";
  return "Ready";
}
function attentionItems(input: { recentFeedback?: Row; testRows: Row[]; jobRows: Row[]; connectionRows: Row[]; adherencePercent: number | null }) {
  const items: { level: string; label: string }[] = [];
  if (!input.recentFeedback) items.push({ level: "warning", label: "Athlete feedback missing" });
  if (input.recentFeedback?.pain) items.push({ level: "critical", label: "Pain reported — coach review" });
  if (!input.testRows.length) items.push({ level: "info", label: "No physiological test recorded" });
  if (!input.connectionRows.length) items.push({ level: "info", label: "Intervals.icu not connected" });
  if (input.adherencePercent !== null && input.adherencePercent < 70) items.push({ level: "warning", label: "Plan adherence below 70%" });
  if (input.jobRows.some((job) => job.status === "failed")) items.push({ level: "critical", label: "Data pipeline needs attention" });
  return items.slice(0, 4);
}

export async function audit(user: AppUser, action: string, entityType: string, entityId?: string | null, athleteId?: string | null, metadata: Row = {}) {
  await platformEnv().DB.prepare("INSERT INTO audit_events (id, actor_user_id, athlete_id, action, entity_type, entity_id, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(id("audit"), user.id, athleteId ?? null, action, entityType, entityId ?? null, JSON.stringify(metadata), nowIso()).run();
}
