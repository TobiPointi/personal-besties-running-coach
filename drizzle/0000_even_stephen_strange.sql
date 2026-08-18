CREATE TABLE `activities` (
	`id` text PRIMARY KEY NOT NULL,
	`athlete_id` text NOT NULL,
	`provider` text NOT NULL,
	`provider_activity_id` text NOT NULL,
	`activity_date` text NOT NULL,
	`activity_type` text NOT NULL,
	`name` text,
	`distance_km` real,
	`duration_seconds` integer,
	`elevation_gain_m` real,
	`average_hr` real,
	`training_load` real,
	`raw_summary_json` text,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_activities_provider_id` ON `activities` (`athlete_id`,`provider`,`provider_activity_id`);--> statement-breakpoint
CREATE INDEX `idx_activities_athlete_date` ON `activities` (`athlete_id`,`activity_date`);--> statement-breakpoint
CREATE TABLE `assessments` (
	`id` text PRIMARY KEY NOT NULL,
	`athlete_id` text NOT NULL,
	`assessed_at` text NOT NULL,
	`status` text NOT NULL,
	`fitness_score` real,
	`fatigue_score` real,
	`race_forecast_low_seconds` integer,
	`race_forecast_high_seconds` integer,
	`summary` text,
	`evidence_json` text DEFAULT '{}' NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_assessments_athlete_date` ON `assessments` (`athlete_id`,`assessed_at`);--> statement-breakpoint
CREATE TABLE `athlete_feedback` (
	`id` text PRIMARY KEY NOT NULL,
	`athlete_id` text NOT NULL,
	`feedback_date` text NOT NULL,
	`activity_id` text,
	`rpe` real,
	`legs` real,
	`fatigue` real,
	`sleep` real,
	`pain` text,
	`comments` text,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_feedback_athlete_date` ON `athlete_feedback` (`athlete_id`,`feedback_date`);--> statement-breakpoint
CREATE TABLE `athletes` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`email` text,
	`display_name` text NOT NULL,
	`primary_sport` text DEFAULT 'running' NOT NULL,
	`timezone` text DEFAULT 'Europe/Vienna' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`weekly_target_km` real,
	`availability_json` text DEFAULT '{}' NOT NULL,
	`injury_notes` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_athletes_user_id` ON `athletes` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_athletes_email` ON `athletes` (`email`);--> statement-breakpoint
CREATE TABLE `audit_events` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_user_id` text NOT NULL,
	`athlete_id` text,
	`action` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text,
	`metadata_json` text DEFAULT '{}' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_audit_athlete_date` ON `audit_events` (`athlete_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `coach_athletes` (
	`coach_user_id` text NOT NULL,
	`athlete_id` text NOT NULL,
	`relationship_role` text DEFAULT 'primary' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`coach_user_id`, `athlete_id`)
);
--> statement-breakpoint
CREATE INDEX `idx_coach_athletes_athlete` ON `coach_athletes` (`athlete_id`);--> statement-breakpoint
CREATE TABLE `coach_notes` (
	`id` text PRIMARY KEY NOT NULL,
	`athlete_id` text NOT NULL,
	`coach_user_id` text NOT NULL,
	`body` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_coach_notes_athlete_date` ON `coach_notes` (`athlete_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `data_connections` (
	`id` text PRIMARY KEY NOT NULL,
	`athlete_id` text NOT NULL,
	`provider` text NOT NULL,
	`external_athlete_id` text,
	`encrypted_access_token` text,
	`scope` text,
	`status` text DEFAULT 'active' NOT NULL,
	`last_sync_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_connections_athlete_provider` ON `data_connections` (`athlete_id`,`provider`);--> statement-breakpoint
CREATE TABLE `file_attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`athlete_id` text NOT NULL,
	`owner_user_id` text NOT NULL,
	`object_key` text NOT NULL,
	`file_name` text NOT NULL,
	`content_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`category` text NOT NULL,
	`related_id` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_attachments_athlete` ON `file_attachments` (`athlete_id`);--> statement-breakpoint
CREATE TABLE `goals` (
	`id` text PRIMARY KEY NOT NULL,
	`athlete_id` text NOT NULL,
	`title` text NOT NULL,
	`event_date` text NOT NULL,
	`distance_km` real,
	`goal_time_seconds` integer,
	`priority` text DEFAULT 'A' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`notes` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_goals_athlete_date` ON `goals` (`athlete_id`,`event_date`);--> statement-breakpoint
CREATE TABLE `invitations` (
	`id` text PRIMARY KEY NOT NULL,
	`athlete_id` text NOT NULL,
	`coach_user_id` text NOT NULL,
	`email` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` text NOT NULL,
	`accepted_at` text
);
--> statement-breakpoint
CREATE INDEX `idx_invitations_email_status` ON `invitations` (`email`,`status`);--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`athlete_id` text NOT NULL,
	`job_type` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`idempotency_key` text NOT NULL,
	`payload_json` text DEFAULT '{}' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`scheduled_at` text NOT NULL,
	`started_at` text,
	`completed_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_jobs_idempotency` ON `jobs` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `idx_jobs_status_schedule` ON `jobs` (`status`,`scheduled_at`);--> statement-breakpoint
CREATE TABLE `lactate_stages` (
	`id` text PRIMARY KEY NOT NULL,
	`test_id` text NOT NULL,
	`stage_number` integer NOT NULL,
	`duration_seconds` integer,
	`pace_seconds_km` integer,
	`speed_kph` real,
	`heart_rate` integer,
	`lactate_mmol` real NOT NULL,
	`rpe` real
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_lactate_stages_test_stage` ON `lactate_stages` (`test_id`,`stage_number`);--> statement-breakpoint
CREATE TABLE `lactate_tests` (
	`id` text PRIMARY KEY NOT NULL,
	`athlete_id` text NOT NULL,
	`test_date` text NOT NULL,
	`protocol` text NOT NULL,
	`venue` text,
	`lt1_lactate` real,
	`lt1_hr` integer,
	`lt1_pace_seconds_km` integer,
	`lt2_lactate` real,
	`lt2_hr` integer,
	`lt2_pace_seconds_km` integer,
	`interpretation_method` text,
	`confidence` text DEFAULT 'moderate' NOT NULL,
	`notes` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_lactate_tests_athlete_date` ON `lactate_tests` (`athlete_id`,`test_date`);--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`athlete_id` text NOT NULL,
	`recipient_email` text NOT NULL,
	`notification_type` text NOT NULL,
	`subject` text NOT NULL,
	`body` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`created_at` text NOT NULL,
	`sent_at` text,
	`last_error` text
);
--> statement-breakpoint
CREATE INDEX `idx_notifications_status_date` ON `notifications` (`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `oauth_states` (
	`state` text PRIMARY KEY NOT NULL,
	`athlete_id` text NOT NULL,
	`user_id` text NOT NULL,
	`expires_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `planned_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`plan_id` text NOT NULL,
	`athlete_id` text NOT NULL,
	`session_date` text NOT NULL,
	`workout_type` text NOT NULL,
	`title` text NOT NULL,
	`details` text NOT NULL,
	`planned_distance_km` real,
	`planned_duration_minutes` integer,
	`pace_guidance` text,
	`hr_guidance` text,
	`purpose` text,
	`fatigue_modification` text,
	`major_stimulus` integer DEFAULT false NOT NULL,
	`status` text DEFAULT 'planned' NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_sessions_athlete_date` ON `planned_sessions` (`athlete_id`,`session_date`);--> statement-breakpoint
CREATE INDEX `idx_sessions_plan` ON `planned_sessions` (`plan_id`);--> statement-breakpoint
CREATE TABLE `training_plans` (
	`id` text PRIMARY KEY NOT NULL,
	`athlete_id` text NOT NULL,
	`goal_id` text,
	`version` integer NOT NULL,
	`status` text NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text NOT NULL,
	`rationale` text,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`published_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_plans_athlete_version` ON `training_plans` (`athlete_id`,`version`);--> statement-breakpoint
CREATE INDEX `idx_plans_athlete_status` ON `training_plans` (`athlete_id`,`status`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`display_name` text NOT NULL,
	`role` text NOT NULL,
	`created_at` text NOT NULL,
	`last_seen_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_users_email` ON `users` (`email`);--> statement-breakpoint
CREATE TABLE `wellness_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`athlete_id` text NOT NULL,
	`entry_date` text NOT NULL,
	`resting_hr` real,
	`sleep_score` real,
	`fatigue` real,
	`weight_kg` real,
	`raw_json` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_wellness_athlete_date` ON `wellness_entries` (`athlete_id`,`entry_date`);