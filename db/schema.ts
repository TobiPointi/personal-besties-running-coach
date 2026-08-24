import { index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull(),
  displayName: text("display_name").notNull(),
  role: text("role", { enum: ["coach", "athlete"] }).notNull(),
  createdAt: text("created_at").notNull(),
  lastSeenAt: text("last_seen_at").notNull(),
}, (table) => [uniqueIndex("idx_users_email").on(table.email)]);

export const authIdentities = sqliteTable("auth_identities", {
  provider: text("provider").notNull(),
  providerSubject: text("provider_subject").notNull(),
  userId: text("user_id").notNull(),
  email: text("email").notNull(),
  createdAt: text("created_at").notNull(),
  lastSeenAt: text("last_seen_at").notNull(),
}, (table) => [primaryKey({ columns: [table.provider, table.providerSubject] }), index("idx_auth_identities_user").on(table.userId), index("idx_auth_identities_email").on(table.email)]);

export const athletes = sqliteTable("athletes", {
  id: text("id").primaryKey(),
  userId: text("user_id"),
  email: text("email"),
  displayName: text("display_name").notNull(),
  primarySport: text("primary_sport").notNull().default("running"),
  timezone: text("timezone").notNull().default("Europe/Vienna"),
  status: text("status").notNull().default("active"),
  weeklyTargetKm: real("weekly_target_km"),
  availabilityJson: text("availability_json").notNull().default("{}"),
  injuryNotes: text("injury_notes"),
  experienceLevel: text("experience_level"),
  trainingDays: integer("training_days"),
  longRunDay: text("long_run_day"),
  onboardingCompletedAt: text("onboarding_completed_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [index("idx_athletes_user_id").on(table.userId), index("idx_athletes_email").on(table.email)]);

export const coachAthletes = sqliteTable("coach_athletes", {
  coachUserId: text("coach_user_id").notNull(),
  athleteId: text("athlete_id").notNull(),
  relationshipRole: text("relationship_role").notNull().default("primary"),
  status: text("status").notNull().default("active"),
  createdAt: text("created_at").notNull(),
}, (table) => [primaryKey({ columns: [table.coachUserId, table.athleteId] }), index("idx_coach_athletes_athlete").on(table.athleteId)]);

export const invitations = sqliteTable("invitations", {
  id: text("id").primaryKey(),
  athleteId: text("athlete_id").notNull(),
  coachUserId: text("coach_user_id").notNull(),
  email: text("email").notNull(),
  status: text("status").notNull().default("pending"),
  createdAt: text("created_at").notNull(),
  acceptedAt: text("accepted_at"),
}, (table) => [index("idx_invitations_email_status").on(table.email, table.status)]);

export const goals = sqliteTable("goals", {
  id: text("id").primaryKey(),
  athleteId: text("athlete_id").notNull(),
  title: text("title").notNull(),
  eventDate: text("event_date").notNull(),
  distanceKm: real("distance_km"),
  elevationGainM: real("elevation_gain_m"),
  terrainType: text("terrain_type"),
  technicality: text("technicality"),
  goalTimeSeconds: integer("goal_time_seconds"),
  priority: text("priority").notNull().default("A"),
  status: text("status").notNull().default("active"),
  notes: text("notes"),
  createdAt: text("created_at").notNull(),
}, (table) => [index("idx_goals_athlete_date").on(table.athleteId, table.eventDate)]);

export const lactateTests = sqliteTable("lactate_tests", {
  id: text("id").primaryKey(),
  athleteId: text("athlete_id").notNull(),
  testDate: text("test_date").notNull(),
  protocol: text("protocol").notNull(),
  venue: text("venue"),
  lt1Lactate: real("lt1_lactate"),
  lt1Hr: integer("lt1_hr"),
  lt1PaceSecondsKm: integer("lt1_pace_seconds_km"),
  lt2Lactate: real("lt2_lactate"),
  lt2Hr: integer("lt2_hr"),
  lt2PaceSecondsKm: integer("lt2_pace_seconds_km"),
  interpretationMethod: text("interpretation_method"),
  confidence: text("confidence").notNull().default("moderate"),
  notes: text("notes"),
  createdAt: text("created_at").notNull(),
}, (table) => [index("idx_lactate_tests_athlete_date").on(table.athleteId, table.testDate)]);

export const lactateStages = sqliteTable("lactate_stages", {
  id: text("id").primaryKey(),
  testId: text("test_id").notNull(),
  stageNumber: integer("stage_number").notNull(),
  durationSeconds: integer("duration_seconds"),
  paceSecondsKm: integer("pace_seconds_km"),
  speedKph: real("speed_kph"),
  heartRate: integer("heart_rate"),
  lactateMmol: real("lactate_mmol").notNull(),
  rpe: real("rpe"),
}, (table) => [uniqueIndex("idx_lactate_stages_test_stage").on(table.testId, table.stageNumber)]);

export const lactateTestRequests = sqliteTable("lactate_test_requests", {
  id: text("id").primaryKey(),
  athleteId: text("athlete_id").notNull(),
  requestedBy: text("requested_by").notNull(),
  preferredDate: text("preferred_date"),
  availability: text("availability"),
  note: text("note"),
  status: text("status").notNull().default("requested"),
  createdAt: text("created_at").notNull(),
}, (table) => [index("idx_lactate_requests_athlete_date").on(table.athleteId, table.createdAt)]);

export const performanceSnapshots = sqliteTable("performance_snapshots", {
  id: text("id").primaryKey(),
  athleteId: text("athlete_id").notNull(),
  snapshotDate: text("snapshot_date").notNull(),
  source: text("source").notNull(),
  vo2max: real("vo2max"),
  prediction5kSeconds: integer("prediction_5k_seconds"),
  prediction10kSeconds: integer("prediction_10k_seconds"),
  predictionHalfSeconds: integer("prediction_half_seconds"),
  predictionMarathonSeconds: integer("prediction_marathon_seconds"),
  createdAt: text("created_at").notNull(),
}, (table) => [index("idx_performance_snapshots_athlete_date").on(table.athleteId, table.snapshotDate)]);

export const activities = sqliteTable("activities", {
  id: text("id").primaryKey(),
  athleteId: text("athlete_id").notNull(),
  provider: text("provider").notNull(),
  providerActivityId: text("provider_activity_id").notNull(),
  activityDate: text("activity_date").notNull(),
  activityType: text("activity_type").notNull(),
  name: text("name"),
  distanceKm: real("distance_km"),
  durationSeconds: integer("duration_seconds"),
  elevationGainM: real("elevation_gain_m"),
  averageHr: real("average_hr"),
  trainingLoad: real("training_load"),
  rawSummaryJson: text("raw_summary_json"),
  updatedAt: text("updated_at").notNull(),
}, (table) => [uniqueIndex("idx_activities_provider_id").on(table.athleteId, table.provider, table.providerActivityId), index("idx_activities_athlete_date").on(table.athleteId, table.activityDate)]);

export const wellnessEntries = sqliteTable("wellness_entries", {
  id: text("id").primaryKey(),
  athleteId: text("athlete_id").notNull(),
  entryDate: text("entry_date").notNull(),
  restingHr: real("resting_hr"),
  sleepScore: real("sleep_score"),
  fatigue: real("fatigue"),
  weightKg: real("weight_kg"),
  rawJson: text("raw_json"),
}, (table) => [uniqueIndex("idx_wellness_athlete_date").on(table.athleteId, table.entryDate)]);

export const assessments = sqliteTable("assessments", {
  id: text("id").primaryKey(),
  athleteId: text("athlete_id").notNull(),
  assessedAt: text("assessed_at").notNull(),
  status: text("status").notNull(),
  fitnessScore: real("fitness_score"),
  fatigueScore: real("fatigue_score"),
  raceForecastLowSeconds: integer("race_forecast_low_seconds"),
  raceForecastHighSeconds: integer("race_forecast_high_seconds"),
  summary: text("summary"),
  evidenceJson: text("evidence_json").notNull().default("{}"),
}, (table) => [index("idx_assessments_athlete_date").on(table.athleteId, table.assessedAt)]);

export const trainingPlans = sqliteTable("training_plans", {
  id: text("id").primaryKey(),
  athleteId: text("athlete_id").notNull(),
  goalId: text("goal_id"),
  version: integer("version").notNull(),
  status: text("status", { enum: ["draft", "published", "archived"] }).notNull(),
  startDate: text("start_date").notNull(),
  endDate: text("end_date").notNull(),
  rationale: text("rationale"),
  createdBy: text("created_by").notNull(),
  createdAt: text("created_at").notNull(),
  publishedAt: text("published_at"),
}, (table) => [uniqueIndex("idx_plans_athlete_version").on(table.athleteId, table.version), index("idx_plans_athlete_status").on(table.athleteId, table.status)]);

export const plannedSessions = sqliteTable("planned_sessions", {
  id: text("id").primaryKey(),
  planId: text("plan_id").notNull(),
  athleteId: text("athlete_id").notNull(),
  sessionDate: text("session_date").notNull(),
  workoutType: text("workout_type").notNull(),
  title: text("title").notNull(),
  details: text("details").notNull(),
  plannedDistanceKm: real("planned_distance_km"),
  plannedDurationMinutes: integer("planned_duration_minutes"),
  paceGuidance: text("pace_guidance"),
  hrGuidance: text("hr_guidance"),
  purpose: text("purpose"),
  fatigueModification: text("fatigue_modification"),
  majorStimulus: integer("major_stimulus", { mode: "boolean" }).notNull().default(false),
  status: text("status").notNull().default("planned"),
  actualDistanceKm: real("actual_distance_km"),
  actualDurationMinutes: integer("actual_duration_minutes"),
  completionRpe: real("completion_rpe"),
  athleteComment: text("athlete_comment"),
  completedAt: text("completed_at"),
}, (table) => [index("idx_sessions_athlete_date").on(table.athleteId, table.sessionDate), index("idx_sessions_plan").on(table.planId)]);

export const athleteFeedback = sqliteTable("athlete_feedback", {
  id: text("id").primaryKey(),
  athleteId: text("athlete_id").notNull(),
  feedbackDate: text("feedback_date").notNull(),
  activityId: text("activity_id"),
  rpe: real("rpe"),
  legs: real("legs"),
  fatigue: real("fatigue"),
  sleep: real("sleep"),
  pain: text("pain"),
  comments: text("comments"),
  createdBy: text("created_by").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [index("idx_feedback_athlete_date").on(table.athleteId, table.feedbackDate)]);

export const coachNotes = sqliteTable("coach_notes", {
  id: text("id").primaryKey(),
  athleteId: text("athlete_id").notNull(),
  coachUserId: text("coach_user_id").notNull(),
  body: text("body").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [index("idx_coach_notes_athlete_date").on(table.athleteId, table.createdAt)]);

export const dataConnections = sqliteTable("data_connections", {
  id: text("id").primaryKey(),
  athleteId: text("athlete_id").notNull(),
  provider: text("provider").notNull(),
  externalAthleteId: text("external_athlete_id"),
  encryptedAccessToken: text("encrypted_access_token"),
  scope: text("scope"),
  status: text("status").notNull().default("active"),
  lastSyncAt: text("last_sync_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [uniqueIndex("idx_connections_athlete_provider").on(table.athleteId, table.provider)]);

export const oauthStates = sqliteTable("oauth_states", {
  state: text("state").primaryKey(), athleteId: text("athlete_id").notNull(), userId: text("user_id").notNull(), expiresAt: text("expires_at").notNull(),
});

export const jobs = sqliteTable("jobs", {
  id: text("id").primaryKey(),
  athleteId: text("athlete_id").notNull(),
  jobType: text("job_type").notNull(),
  status: text("status").notNull().default("queued"),
  idempotencyKey: text("idempotency_key").notNull(),
  payloadJson: text("payload_json").notNull().default("{}"),
  attempts: integer("attempts").notNull().default(0),
  lastError: text("last_error"),
  scheduledAt: text("scheduled_at").notNull(),
  startedAt: text("started_at"),
  completedAt: text("completed_at"),
}, (table) => [uniqueIndex("idx_jobs_idempotency").on(table.idempotencyKey), index("idx_jobs_status_schedule").on(table.status, table.scheduledAt)]);

export const notifications = sqliteTable("notifications", {
  id: text("id").primaryKey(),
  athleteId: text("athlete_id").notNull(),
  recipientEmail: text("recipient_email").notNull(),
  notificationType: text("notification_type").notNull(),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  status: text("status").notNull().default("queued"),
  createdAt: text("created_at").notNull(),
  sentAt: text("sent_at"),
  lastError: text("last_error"),
}, (table) => [index("idx_notifications_status_date").on(table.status, table.createdAt)]);

export const fileAttachments = sqliteTable("file_attachments", {
  id: text("id").primaryKey(), athleteId: text("athlete_id").notNull(), ownerUserId: text("owner_user_id").notNull(), objectKey: text("object_key").notNull(), fileName: text("file_name").notNull(), contentType: text("content_type").notNull(), sizeBytes: integer("size_bytes").notNull(), category: text("category").notNull(), relatedId: text("related_id"), createdAt: text("created_at").notNull(),
}, (table) => [index("idx_attachments_athlete").on(table.athleteId)]);

export const auditEvents = sqliteTable("audit_events", {
  id: text("id").primaryKey(), actorUserId: text("actor_user_id").notNull(), athleteId: text("athlete_id"), action: text("action").notNull(), entityType: text("entity_type").notNull(), entityId: text("entity_id"), metadataJson: text("metadata_json").notNull().default("{}"), createdAt: text("created_at").notNull(),
}, (table) => [index("idx_audit_athlete_date").on(table.athleteId, table.createdAt)]);
