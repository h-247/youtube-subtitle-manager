CREATE TABLE `local_sync_tokens` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`revoked_at` text
);
--> statement-breakpoint
CREATE INDEX `ix_local_sync_tokens_user` ON `local_sync_tokens` (`user_id`);--> statement-breakpoint
ALTER TABLE `videos` ADD `processing_source` text DEFAULT 'SITE' NOT NULL;