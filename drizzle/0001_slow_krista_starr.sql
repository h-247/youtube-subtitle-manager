CREATE TABLE `drive_connections` (
	`user_id` text PRIMARY KEY NOT NULL,
	`encrypted_credentials` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `drive_oauth_states` (
	`state` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ix_drive_oauth_states_expiry` ON `drive_oauth_states` (`expires_at`);--> statement-breakpoint
ALTER TABLE `videos` ADD `drive_retry_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `videos` ADD `drive_last_attempt_at` text;