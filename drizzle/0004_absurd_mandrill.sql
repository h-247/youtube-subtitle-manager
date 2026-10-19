CREATE TABLE `sync_tombstones` (
	`user_id` text NOT NULL,
	`video_id` text NOT NULL,
	`deleted_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_sync_tombstone` ON `sync_tombstones` (`user_id`,`video_id`);--> statement-breakpoint
ALTER TABLE `videos` ADD `processing_paused` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `videos` ADD `error_category` text;