import { env } from "cloudflare:workers";

export type PlatformEnv = {
  DB: D1Database;
  FILES?: R2Bucket;
  INTERVALS_CLIENT_ID?: string;
  INTERVALS_CLIENT_SECRET?: string;
  INTERVALS_REDIRECT_URI?: string;
  CONNECTION_ENCRYPTION_KEY?: string;
  EMAIL_WEBHOOK_URL?: string;
  EMAIL_WEBHOOK_TOKEN?: string;
  COACH_ENGINE_URL?: string;
  CRON_SECRET?: string;
};

export function platformEnv(): PlatformEnv {
  const bindings = env as unknown as PlatformEnv;
  if (!bindings.DB) throw new Error("The private workspace database is not available.");
  return bindings;
}

const schemaStatements = [
  `CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT NOT NULL, display_name TEXT NOT NULL, role TEXT NOT NULL, created_at TEXT NOT NULL, last_seen_at TEXT NOT NULL)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email)`,
  `CREATE TABLE IF NOT EXISTS athletes (id TEXT PRIMARY KEY, user_id TEXT, email TEXT, display_name TEXT NOT NULL, primary_sport TEXT NOT NULL DEFAULT 'running', timezone TEXT NOT NULL DEFAULT 'Europe/Vienna', status TEXT NOT NULL DEFAULT 'active', weekly_target_km REAL, availability_json TEXT NOT NULL DEFAULT '{}', injury_notes TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS idx_athletes_user_id ON athletes(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_athletes_email ON athletes(email)`,
  `CREATE TABLE IF NOT EXISTS coach_athletes (coach_user_id TEXT NOT NULL, athlete_id TEXT NOT NULL, relationship_role TEXT NOT NULL DEFAULT 'primary', status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL, PRIMARY KEY(coach_user_id, athlete_id))`,
  `CREATE INDEX IF NOT EXISTS idx_coach_athletes_athlete ON coach_athletes(athlete_id)`,
  `CREATE TABLE IF NOT EXISTS invitations (id TEXT PRIMARY KEY, athlete_id TEXT NOT NULL, coach_user_id TEXT NOT NULL, email TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL, accepted_at TEXT)`,
  `CREATE INDEX IF NOT EXISTS idx_invitations_email_status ON invitations(email, status)`,
  `CREATE TABLE IF NOT EXISTS goals (id TEXT PRIMARY KEY, athlete_id TEXT NOT NULL, title TEXT NOT NULL, event_date TEXT NOT NULL, distance_km REAL, goal_time_seconds INTEGER, priority TEXT NOT NULL DEFAULT 'A', status TEXT NOT NULL DEFAULT 'active', notes TEXT, created_at TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS idx_goals_athlete_date ON goals(athlete_id, event_date)`,
  `CREATE TABLE IF NOT EXISTS lactate_tests (id TEXT PRIMARY KEY, athlete_id TEXT NOT NULL, test_date TEXT NOT NULL, protocol TEXT NOT NULL, venue TEXT, lt1_lactate REAL, lt1_hr INTEGER, lt1_pace_seconds_km INTEGER, lt2_lactate REAL, lt2_hr INTEGER, lt2_pace_seconds_km INTEGER, interpretation_method TEXT, confidence TEXT NOT NULL DEFAULT 'moderate', notes TEXT, created_at TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS idx_lactate_tests_athlete_date ON lactate_tests(athlete_id, test_date)`,
  `CREATE TABLE IF NOT EXISTS lactate_stages (id TEXT PRIMARY KEY, test_id TEXT NOT NULL, stage_number INTEGER NOT NULL, duration_seconds INTEGER, pace_seconds_km INTEGER, speed_kph REAL, heart_rate INTEGER, lactate_mmol REAL NOT NULL, rpe REAL)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_lactate_stages_test_stage ON lactate_stages(test_id, stage_number)`,
  `CREATE TABLE IF NOT EXISTS activities (id TEXT PRIMARY KEY, athlete_id TEXT NOT NULL, provider TEXT NOT NULL, provider_activity_id TEXT NOT NULL, activity_date TEXT NOT NULL, activity_type TEXT NOT NULL, name TEXT, distance_km REAL, duration_seconds INTEGER, elevation_gain_m REAL, average_hr REAL, training_load REAL, raw_summary_json TEXT, updated_at TEXT NOT NULL)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_activities_provider_id ON activities(athlete_id, provider, provider_activity_id)`,
  `CREATE INDEX IF NOT EXISTS idx_activities_athlete_date ON activities(athlete_id, activity_date)`,
  `CREATE TABLE IF NOT EXISTS wellness_entries (id TEXT PRIMARY KEY, athlete_id TEXT NOT NULL, entry_date TEXT NOT NULL, resting_hr REAL, sleep_score REAL, fatigue REAL, weight_kg REAL, raw_json TEXT)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_wellness_athlete_date ON wellness_entries(athlete_id, entry_date)`,
  `CREATE TABLE IF NOT EXISTS assessments (id TEXT PRIMARY KEY, athlete_id TEXT NOT NULL, assessed_at TEXT NOT NULL, status TEXT NOT NULL, fitness_score REAL, fatigue_score REAL, race_forecast_low_seconds INTEGER, race_forecast_high_seconds INTEGER, summary TEXT, evidence_json TEXT NOT NULL DEFAULT '{}')`,
  `CREATE INDEX IF NOT EXISTS idx_assessments_athlete_date ON assessments(athlete_id, assessed_at)`,
  `CREATE TABLE IF NOT EXISTS training_plans (id TEXT PRIMARY KEY, athlete_id TEXT NOT NULL, goal_id TEXT, version INTEGER NOT NULL, status TEXT NOT NULL, start_date TEXT NOT NULL, end_date TEXT NOT NULL, rationale TEXT, created_by TEXT NOT NULL, created_at TEXT NOT NULL, published_at TEXT)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_plans_athlete_version ON training_plans(athlete_id, version)`,
  `CREATE INDEX IF NOT EXISTS idx_plans_athlete_status ON training_plans(athlete_id, status)`,
  `CREATE TABLE IF NOT EXISTS planned_sessions (id TEXT PRIMARY KEY, plan_id TEXT NOT NULL, athlete_id TEXT NOT NULL, session_date TEXT NOT NULL, workout_type TEXT NOT NULL, title TEXT NOT NULL, details TEXT NOT NULL, planned_distance_km REAL, planned_duration_minutes INTEGER, pace_guidance TEXT, hr_guidance TEXT, purpose TEXT, fatigue_modification TEXT, major_stimulus INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'planned')`,
  `CREATE INDEX IF NOT EXISTS idx_sessions_athlete_date ON planned_sessions(athlete_id, session_date)`,
  `CREATE INDEX IF NOT EXISTS idx_sessions_plan ON planned_sessions(plan_id)`,
  `CREATE TABLE IF NOT EXISTS athlete_feedback (id TEXT PRIMARY KEY, athlete_id TEXT NOT NULL, feedback_date TEXT NOT NULL, activity_id TEXT, rpe REAL, legs REAL, fatigue REAL, sleep REAL, pain TEXT, comments TEXT, created_by TEXT NOT NULL, created_at TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS idx_feedback_athlete_date ON athlete_feedback(athlete_id, feedback_date)`,
  `CREATE TABLE IF NOT EXISTS coach_notes (id TEXT PRIMARY KEY, athlete_id TEXT NOT NULL, coach_user_id TEXT NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS idx_coach_notes_athlete_date ON coach_notes(athlete_id, created_at)`,
  `CREATE TABLE IF NOT EXISTS data_connections (id TEXT PRIMARY KEY, athlete_id TEXT NOT NULL, provider TEXT NOT NULL, external_athlete_id TEXT, encrypted_access_token TEXT, scope TEXT, status TEXT NOT NULL DEFAULT 'active', last_sync_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_connections_athlete_provider ON data_connections(athlete_id, provider)`,
  `CREATE TABLE IF NOT EXISTS oauth_states (state TEXT PRIMARY KEY, athlete_id TEXT NOT NULL, user_id TEXT NOT NULL, expires_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, athlete_id TEXT NOT NULL, job_type TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'queued', idempotency_key TEXT NOT NULL, payload_json TEXT NOT NULL DEFAULT '{}', attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT, scheduled_at TEXT NOT NULL, started_at TEXT, completed_at TEXT)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_idempotency ON jobs(idempotency_key)`,
  `CREATE INDEX IF NOT EXISTS idx_jobs_status_schedule ON jobs(status, scheduled_at)`,
  `CREATE TABLE IF NOT EXISTS notifications (id TEXT PRIMARY KEY, athlete_id TEXT NOT NULL, recipient_email TEXT NOT NULL, notification_type TEXT NOT NULL, subject TEXT NOT NULL, body TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'queued', created_at TEXT NOT NULL, sent_at TEXT, last_error TEXT)`,
  `CREATE INDEX IF NOT EXISTS idx_notifications_status_date ON notifications(status, created_at)`,
  `CREATE TABLE IF NOT EXISTS file_attachments (id TEXT PRIMARY KEY, athlete_id TEXT NOT NULL, owner_user_id TEXT NOT NULL, object_key TEXT NOT NULL, file_name TEXT NOT NULL, content_type TEXT NOT NULL, size_bytes INTEGER NOT NULL, category TEXT NOT NULL, related_id TEXT, created_at TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS idx_attachments_athlete ON file_attachments(athlete_id)`,
  `CREATE TABLE IF NOT EXISTS audit_events (id TEXT PRIMARY KEY, actor_user_id TEXT NOT NULL, athlete_id TEXT, action TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT, metadata_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS idx_audit_athlete_date ON audit_events(athlete_id, created_at)`,
];

export async function ensureSchema(db = platformEnv().DB): Promise<void> {
  for (let index = 0; index < schemaStatements.length; index += 40) {
    await db.batch(schemaStatements.slice(index, index + 40).map((statement) => db.prepare(statement)));
  }
  await db.prepare("PRAGMA optimize").run();
}

export function id(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`;
}

export function nowIso(): string { return new Date().toISOString(); }

export function todayIso(): string { return new Date().toISOString().slice(0, 10); }
