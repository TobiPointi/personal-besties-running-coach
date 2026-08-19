CREATE TABLE `lactate_test_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`athlete_id` text NOT NULL,
	`requested_by` text NOT NULL,
	`preferred_date` text,
	`availability` text,
	`note` text,
	`status` text DEFAULT 'requested' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_lactate_requests_athlete_date` ON `lactate_test_requests` (`athlete_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `performance_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`athlete_id` text NOT NULL,
	`snapshot_date` text NOT NULL,
	`source` text NOT NULL,
	`vo2max` real,
	`prediction_5k_seconds` integer,
	`prediction_10k_seconds` integer,
	`prediction_half_seconds` integer,
	`prediction_marathon_seconds` integer,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_performance_snapshots_athlete_date` ON `performance_snapshots` (`athlete_id`,`snapshot_date`);