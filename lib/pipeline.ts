import { decryptSecret } from "./secrets";
import { id, nowIso, platformEnv } from "../db/runtime";

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
  const oldestDate = new Date(); oldestDate.setUTCFullYear(oldestDate.getUTCFullYear() - 2);
  const oldest = oldestDate.toISOString().slice(0, 10);
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
  const wellnessStatements = wellness.filter((row) => row.id).map((row) => {
    const date = String(row.id).slice(0, 10);
    return db.prepare(`INSERT INTO wellness_entries (id, athlete_id, entry_date, resting_hr, sleep_score, fatigue, weight_kg, raw_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(athlete_id, entry_date) DO UPDATE SET resting_hr=excluded.resting_hr, sleep_score=excluded.sleep_score, fatigue=excluded.fatigue, weight_kg=excluded.weight_kg, raw_json=excluded.raw_json`)
      .bind(`wellness_${athleteId}_${date}`, athleteId, date, numberOrNull(row.restingHR ?? row.resting_hr), numberOrNull(row.sleepScore ?? row.sleep_score), numberOrNull(row.fatigue), numberOrNull(row.weight), JSON.stringify(redact(row)));
  });
  for (const statements of chunks([...activityStatements, ...wellnessStatements], 30)) await db.batch(statements);
  await db.batch([
    db.prepare("UPDATE data_connections SET last_sync_at = ?, updated_at = ? WHERE id = ?").bind(timestamp, timestamp, connection.id),
    db.prepare("INSERT OR IGNORE INTO jobs (id, athlete_id, job_type, status, idempotency_key, payload_json, scheduled_at) VALUES (?, ?, 'assessment', 'queued', ?, '{}', ?)").bind(id("job"), athleteId, `assessment:${athleteId}:${newest}`, timestamp),
  ]);
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
}

async function sendQueuedNotifications() {
  const runtime = platformEnv();
  if (!runtime.EMAIL_WEBHOOK_URL) return 0;
  const result = await runtime.DB.prepare("SELECT * FROM notifications WHERE status = 'queued' ORDER BY created_at LIMIT 10").all<Record<string, unknown>>();
  let sent = 0;
  for (const notification of result.results ?? []) {
    try {
      const response = await fetch(runtime.EMAIL_WEBHOOK_URL, {
        method: "POST",
        headers: { "content-type": "application/json", ...(runtime.EMAIL_WEBHOOK_TOKEN ? { authorization: `Bearer ${runtime.EMAIL_WEBHOOK_TOKEN}` } : {}) },
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

function chunks<T>(values: T[], size: number): T[][] { const result: T[][] = []; for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size)); return result; }
function numberOrNull(value: unknown): number | null { const number = Number(value); return Number.isFinite(number) ? number : null; }
function metricDistanceKm(value: unknown): number | null { const number = numberOrNull(value); return number === null ? null : number > 500 ? number / 1000 : number; }
function redact(value: Record<string, unknown>) { return Object.fromEntries(Object.entries(value).filter(([key]) => !/(token|secret|password|api.?key)/i.test(key))); }
