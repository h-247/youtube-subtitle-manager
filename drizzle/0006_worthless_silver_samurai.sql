CREATE TABLE `playlist_cleanup_jobs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`video_id` text NOT NULL,
	`playlist_id` text NOT NULL,
	`playlist_item_id` text NOT NULL,
	`state` text DEFAULT 'PENDING' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_attempt` integer DEFAULT 0 NOT NULL,
	`lease_until` integer DEFAULT 0 NOT NULL,
	`error` text,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_playlist_cleanup_item` ON `playlist_cleanup_jobs` (`user_id`,`playlist_item_id`);--> statement-breakpoint
CREATE INDEX `ix_playlist_cleanup_due` ON `playlist_cleanup_jobs` (`user_id`,`state`,`next_attempt`);--> statement-breakpoint
CREATE TABLE `youtube_connections` (
	`user_id` text PRIMARY KEY NOT NULL,
	`encrypted_credentials` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `youtube_oauth_states` (
	`state` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`expires_at` integer NOT NULL
);
