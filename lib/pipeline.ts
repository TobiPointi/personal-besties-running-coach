import { decryptSecret } from "./secrets";
import { generateTrainingPlan } from "./planner";
import { id, nowIso, platformEnv, todayIso } from "../db/runtime";

type JobRow = { id: string; athlete_id: string; job_type: string; attempts: number; payload_json: string };

export async function processPendingWork(onlyAthleteId?: string): Promise<{ jobs: number; notifications: number }> {
  const db = platformEnv().DB;
  const jobsResult = onlyAthleteId
    ? await db.prepare("SELECT * FROM jobs WHERE status = 'queued' AND scheduled_at <= ? AND athlete_id = ? ORDER BY scheduled_at LIMIT 5").bind(nowIso(), onlyAthleteId).all<JobRow>()
    : await db.prepare("SELECT * FROM jobs WHERE status = 'queued' AND scheduled_at <= ? ORDER BY scheduled_at LIMIT 10").bind(nowIso()).all<JobRow>();
  let completed = 0;
  for (const job of jobsResult.results ?? []) {
    const claimed = await db.prepare("UPDATE jobs SET status = 'running', started_at = ?, attempts = attempts + 1 WHERE id = ? AND status = 'queued'").bind(nowIso(), job.id).run();
    if (!claimed.meta.changes) continue;
    try {
      if (job.job_type === "intervals_sync") await syncIntervals(job.athlete_id);
      if (job.job_type === "assessment") await calculateAssessment(job.athlete_id);
      await db.prepare("UPDATE jobs SET status = 'complete', completed_at = ?, last_error = NULL WHERE id = ?").bind(nowIso(), job.id).run();
      completed += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 800) : "Unknown pipeline error";
      const nextStatus = Number(job.attempts ?? 0) + 1 >= 3 ? "failed" : "queued";
      await db.prepare("UPDATE jobs SET status = ?, last_error = ?, scheduled_at = ? WHERE id = ?")
        .bind(nextStatus, message, new Date(Date.now() + 15 * 60_000).toISOString(), job.id).run();
      if (nextStatus === "failed") await queueCoachAlert(job.athlete_id, "sync_failed", "Training-data sync needs attention", message);
    }
  }
  const notifications = await sendQueuedNotifications();
  return { jobs: completed, notifications };
}

async function syncIntervals(athleteId: string) {
  const db = platformEnv().DB;
  const connection = await db.prepare("SELECT * FROM data_connections WHERE athlete_id = ? AND provider = 'intervals' AND status = 'active'")
    .bind(athleteId).first<{ id: string; encrypted_access_token: string }>();
  if (!connection?.encrypted_access_token) throw new Error("Intervals.icu is not connected for this athlete.");
  const token = await decryptSecret(connection.encrypted_access_token);
  const newest = new Date().toISOString().slice(0, 10);
  const oldest = "2000-01-01";
  const headers = { Authorization: `Bearer ${token}`, Accept: "application/json" };
  const [activitiesResponse, wellnessResponse] = await Promise.all([
    fetch(`https://intervals.icu/api/v1/athlete/0/activities?oldest=${oldest}&newest=${newest}&limit=10000`, { headers }),
    fetch(`https://intervals.icu/api/v1/athlete/0/wellness.json?oldest=${oldest}&newest=${newest}`, { headers }),
  ]);
  if (!activitiesResponse.ok) throw new Error(`Intervals.icu activities sync failed (${activitiesResponse.status}).`);
  if (!wellnessResponse.ok) throw new Error(`Intervals.icu wellness sync failed (${wellnessResponse.status}).`);
  const activities = await activitiesResponse.json() as Record<string, unknown>[];
  const wellness = await wellnessResponse.json() as Record<string, unknown>[];
  const timestamp = nowIso();
  const activityStatements = activities.filter((row) => row.id).map((row) => {
    const providerId = String(row.id);
    return db.prepare(`INSERT INTO activities (id, athlete_id, provider, provider_activity_id, activity_date, activity_type, name, distance_km, duration_seconds, elevation_gain_m, average_hr, training_load, raw_summary_json, updated_at)
      VALUES (?, ?, 'intervals', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(athlete_id, provider, provider_activity_id) DO UPDATE SET activity_date=excluded.activity_date, activity_type=excluded.activity_type, name=excluded.name, distance_km=excluded.distance_km, duration_seconds=excluded.duration_seconds, elevation_gain_m=excluded.elevation_gain_m, average_hr=excluded.average_hr, training_load=excluded.training_load, raw_summary_json=excluded.raw_summary_json, updated_at=excluded.updated_at`)
      .bind(`intervals_${athleteId}_${providerId}`, athleteId, providerId, String(row.start_date_local ?? row.start_date ?? "").slice(0, 10), String(row.type ?? "activity"), String(row.name ?? ""), metricDistanceKm(row.distance), numberOrNull(row.moving_time ?? row.elapsed_time), numberOrNull(row.total_elevation_gain), numberOrNull(row.average_heartrate ?? row.average_hr), numberOrNull(row.icu_training_load), JSON.stringify(redact(row)), timestamp);
  });
  const performanceStatements = activities.map((row) => {
    const date = String(row.start_date_local ?? row.start_date ?? "").slice(0, 10);
    const vo2max = numberOrNull(row.vo2max ?? row.vo2_max ?? row.icu_vo2max ?? row.icu_vo2_max);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || vo2max === null) return null;
    const source = deviceSource(row);
    return db.prepare(`INSERT OR REPLACE INTO performance_snapshots
      (id, athlete_id, snapshot_date, source, vo2max, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
      .bind(`performance_${athleteId}_${date}_${source.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`, athleteId, date, source, vo2max, timestamp);
  }).filter(Boolean) as D1PreparedStatement[];
  const wellnessStatements = wellness.filter((row) => row.id).map((row) => {
    const date = String(row.id).slice(0, 10);
    return db.prepare(`INSERT INTO wellness_entries (id, athlete_id, entry_date, resting_hr, sleep_score, fatigue, weight_kg, raw_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(athlete_id, entry_date) DO UPDATE SET resting_hr=excluded.resting_hr, sleep_score=excluded.sleep_score, fatigue=excluded.fatigue, weight_kg=excluded.weight_kg, raw_json=excluded.raw_json`)
      .bind(`wellness_${athleteId}_${date}`, athleteId, date, numberOrNull(row.restingHR ?? row.resting_hr), numberOrNull(row.sleepScore ?? row.sleep_score), numberOrNull(row.fatigue), numberOrNull(row.weight), JSON.stringify(redact(row)));
  });
  for (const statements of chunks([...activityStatements, ...wellnessStatements, ...performanceStatements], 30)) await db.batch(statements);
  await db.prepare("UPDATE data_connections SET last_sync_at = ?, updated_at = ? WHERE id = ?").bind(timestamp, timestamp, connection.id).run();
  await calculateAssessment(athleteId);
}

async function calculateAssessment(athleteId: string) {
  const db = platformEnv().DB;
  const activityResult = await db.prepare("SELECT activity_date, distance_km, duration_seconds, training_load FROM activities WHERE athlete_id = ? AND activity_date >= date('now', '-56 day') ORDER BY activity_date")
    .bind(athleteId).all<Record<string, unknown>>();
  const rows = activityResult.results ?? [];
  const distance = rows.reduce((sum: number, row: Record<string, unknown>) => sum + Number(row.distance_km ?? 0), 0);
  const load = rows.reduce((sum: number, row: Record<string, unknown>) => sum + Number(row.training_load ?? 0), 0);
  const weeklyDistance = distance / 8;
  const fitness = Math.round(Math.min(100, load ? load / 8 : weeklyDistance));
  const feedback = await db.prepare("SELECT fatigue, pain FROM athlete_feedback WHERE athlete_id = ? ORDER BY feedback_date DESC, created_at DESC LIMIT 1").bind(athleteId).first<{ fatigue: number; pain: string }>();
  const fatigue = Math.max(0, Math.min(100, Number(feedback?.fatigue ?? 3) * 10));
  const status = feedback?.pain ? "review" : fatigue >= 70 ? "caution" : "on_track";
  await db.prepare("INSERT INTO assessments (id, athlete_id, assessed_at, status, fitness_score, fatigue_score, summary, evidence_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(id("assessment"), athleteId, nowIso(), status, fitness, fatigue, `${weeklyDistance.toFixed(1)} km/week average over the available eight-week window.`, JSON.stringify({ activities: rows.length, distanceKm: distance, trainingLoad: load })).run();
  await maybeCreateAdaptiveDraft(athleteId, feedback);
  if (!rows.length) await queueCoachAlert(athleteId, "missing_data", "Athlete data is missing", "No completed activities were available for the latest assessment.");
  if (feedback?.pain) await queueCoachAlert(athleteId, "pain", "Athlete reported pain", feedback.pain);
  else if (fatigue >= 70) await queueCoachAlert(athleteId, "fatigue", "Athlete fatigue needs review", `Current fatigue signal: ${fatigue}/100.`);
}

async function maybeCreateAdaptiveDraft(athleteId: string, feedback?: { fatigue: number; pain: string }) {
  const db = platformEnv().DB;
  const published = await db.prepare("SELECT * FROM training_plans WHERE athlete_id = ? AND status = 'published' ORDER BY version DESC LIMIT 1").bind(athleteId).first<Record<string, unknown>>();
  if (!published) return;
  const existingDraft = await db.prepare("SELECT id FROM training_plans WHERE athlete_id = ? AND status = 'draft' LIMIT 1").bind(athleteId).first();
  if (existingDraft) return;
  const recent = await db.prepare(`SELECT ps.* FROM planned_sessions ps JOIN training_plans tp ON tp.id = ps.plan_id
    WHERE ps.athlete_id = ? AND tp.status = 'published' AND ps.workout_type != 'rest' AND ps.session_date BETWEEN date('now','-14 day') AND date('now') ORDER BY ps.session_date`)
    .bind(athleteId).all<Record<string, unknown>>();
  const sessions = recent.results ?? [];
  const missed = sessions.filter((row) => row.status !== "completed").length;
  const veryHard = sessions.filter((row) => Number(row.completion_rpe ?? 0) >= 9).length;
  const reasons: string[] = [];
  if (feedback?.pain) reasons.push("pain was reported");
  if (Number(feedback?.fatigue ?? 0) >= 8) reasons.push(`fatigue reached ${feedback?.fatigue}/10`);
  if (missed >= 2) reasons.push(`${missed} planned sessions were missed or remain unlogged in 14 days`);
  if (veryHard >= 2) reasons.push(`${veryHard} sessions were rated 9–10/10`);
  if (!reasons.length) return;

  const [athlete, goal, latestTest, activities, coach] = await Promise.all([
    db.prepare("SELECT * FROM athletes WHERE id = ?").bind(athleteId).first<Record<string, unknown>>(),
    db.prepare("SELECT * FROM goals WHERE athlete_id = ? AND status = 'active' ORDER BY CASE priority WHEN 'A' THEN 0 WHEN 'B' THEN 1 ELSE 2 END, event_date LIMIT 1").bind(athleteId).first<Record<string, unknown>>(),
    db.prepare("SELECT * FROM lactate_tests WHERE athlete_id = ? ORDER BY test_date DESC LIMIT 1").bind(athleteId).first<Record<string, unknown>>(),
    db.prepare("SELECT * FROM activities WHERE athlete_id = ? ORDER BY activity_date DESC LIMIT 120").bind(athleteId).all<Record<string, unknown>>(),
    db.prepare("SELECT coach_user_id FROM coach_athletes WHERE athlete_id = ? AND status = 'active' ORDER BY CASE relationship_role WHEN 'primary' THEN 0 ELSE 1 END LIMIT 1").bind(athleteId).first<{ coach_user_id:string }>(),
  ]);
  if (!athlete || !goal || !coach) return;
  const generated = await generateTrainingPlan({ athlete, goal, latestTest, recentFeedback: feedback as Record<string, unknown>, recentActivities: activities.results ?? [] });
  const versionRow = await db.prepare("SELECT COALESCE(MAX(version), 0) AS version FROM training_plans WHERE athlete_id = ?").bind(athleteId).first<{ version:number }>();
  const version = Number(versionRow?.version ?? 0) + 1, planId = id("plan"), timestamp = nowIso();
  const rationale = `Adaptive draft created because ${reasons.join(", ")}. No published session changed automatically; coach review is required. ${generated.rationale}`;
  await db.prepare("INSERT INTO training_plans (id, athlete_id, goal_id, version, status, start_date, end_date, rationale, created_by, created_at) VALUES (?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?)")
    .bind(planId, athleteId, goal.id, version, generated.sessions[0]?.date ?? todayIso(), generated.sessions.at(-1)?.date ?? String(goal.event_date), rationale, coach.coach_user_id, timestamp).run();
  for (const group of chunks(generated.sessions, 30)) await db.batch(group.map((session) => db.prepare("INSERT INTO planned_sessions (id, plan_id, athlete_id, session_date, workout_type, title, details, planned_distance_km, pace_guidance, hr_guidance, purpose, fatigue_modification, major_stimulus, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'planned')")
    .bind(id("session"), planId, athleteId, session.date, session.workoutType, session.title, session.details, session.distanceKm, session.paceGuidance, session.hrGuidance, session.purpose, session.fatigueModification, session.majorStimulus ? 1 : 0)));
  await queueCoachAlert(athleteId, "adaptive_draft", "Adaptive plan draft needs review", `Draft version ${version} was created because ${reasons.join(", ")}. The published plan is unchanged until you review and publish it.`);
}

async function sendQueuedNotifications() {
  const runtime = platformEnv();
  if (!runtime.EMAIL_WEBHOOK_URL && !runtime.RESEND_API_KEY) return 0;
  const result = await runtime.DB.prepare("SELECT * FROM notifications WHERE status = 'queued' ORDER BY created_at LIMIT 10").all<Record<string, unknown>>();
  let sent = 0;
  for (const notification of result.results ?? []) {
    try {
      const response = runtime.RESEND_API_KEY ? await fetch("https://api.resend.com/emails", {
        method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${runtime.RESEND_API_KEY}` },
        body: JSON.stringify({ from: runtime.RESEND_FROM_EMAIL ?? "Personal Besties <login@auth.personalbesties.com>", to: [notification.recipient_email], subject: notification.subject, text: notification.body }),
      }) : await fetch(runtime.EMAIL_WEBHOOK_URL!, {
        method: "POST", headers: { "content-type": "application/json", ...(runtime.EMAIL_WEBHOOK_TOKEN ? { authorization: `Bearer ${runtime.EMAIL_WEBHOOK_TOKEN}` } : {}) },
        body: JSON.stringify({ to: notification.recipient_email, subject: notification.subject, text: notification.body, type: notification.notification_type }),
      });
      if (!response.ok) throw new Error(`Email provider returned ${response.status}.`);
      await runtime.DB.prepare("UPDATE notifications SET status = 'sent', sent_at = ?, last_error = NULL WHERE id = ?").bind(nowIso(), notification.id).run();
      sent += 1;
    } catch (error) {
      await runtime.DB.prepare("UPDATE notifications SET status = 'failed', last_error = ? WHERE id = ?")
        .bind(error instanceof Error ? error.message.slice(0, 500) : "Notification failed", notification.id).run();
    }
  }
  return sent;
}

export async function queueCoachAlert(athleteId: string, kind: string, subject: string, body: string) {
  const db = platformEnv().DB; const date = new Date().toISOString().slice(0, 10);
  const coach = await db.prepare(`SELECT u.email, a.display_name AS athlete_name FROM users u JOIN coach_athletes ca ON ca.coach_user_id = u.id JOIN athletes a ON a.id = ca.athlete_id WHERE ca.athlete_id = ? AND ca.status = 'active' ORDER BY CASE ca.relationship_role WHEN 'primary' THEN 0 ELSE 1 END LIMIT 1`).bind(athleteId).first<{ email:string; athlete_name:string }>();
  if (!coach?.email) return;
  await db.prepare("INSERT OR IGNORE INTO notifications (id, athlete_id, recipient_email, notification_type, subject, body, status, created_at) VALUES (?, ?, ?, ?, ?, ?, 'queued', ?)")
    .bind(`alert_${athleteId}_${date}_${kind}`, athleteId, coach.email, `coach_alert_${kind}`, `${subject}: ${coach.athlete_name}`, body, nowIso()).run();
}

function chunks<T>(values: T[], size: number): T[][] { const result: T[][] = []; for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size)); return result; }
function numberOrNull(value: unknown): number | null { const number = Number(value); return Number.isFinite(number) ? number : null; }
function metricDistanceKm(value: unknown): number | null { const number = numberOrNull(value); return number === null ? null : number > 500 ? number / 1000 : number; }
function deviceSource(value: Record<string, unknown>) { const text = JSON.stringify(value).toLowerCase(); if (text.includes("garmin")) return "Garmin"; if (text.includes("suunto")) return "Suunto"; if (text.includes("coros")) return "COROS"; if (text.includes("polar")) return "Polar"; if (text.includes("apple")) return "Apple Watch"; return "Intervals.icu"; }
function redact(value: Record<string, unknown>) { return Object.fromEntries(Object.entries(value).filter(([key]) => !/(token|secret|password|api.?key)/i.test(key))); }
