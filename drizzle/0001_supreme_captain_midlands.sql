CREATE TABLE `auth_identities` (
	`provider` text NOT NULL,
	`provider_subject` text NOT NULL,
	`user_id` text NOT NULL,
	`email` text NOT NULL,
	`created_at` text NOT NULL,
	`last_seen_at` text NOT NULL,
	PRIMARY KEY(`provider`, `provider_subject`)
);
--> statement-breakpoint
CREATE INDEX `idx_auth_identities_user` ON `auth_identities` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_auth_identities_email` ON `auth_identities` (`email`);--> statement-breakpoint
ALTER TABLE `planned_sessions` ADD `actual_distance_km` real;--> statement-breakpoint
ALTER TABLE `planned_sessions` ADD `actual_duration_minutes` integer;--> statement-breakpoint
ALTER TABLE `planned_sessions` ADD `completion_rpe` real;--> statement-breakpoint
ALTER TABLE `planned_sessions` ADD `athlete_comment` text;--> statement-breakpoint
ALTER TABLE `planned_sessions` ADD `completed_at` text;