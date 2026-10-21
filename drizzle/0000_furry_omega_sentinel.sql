CREATE TABLE `channel_tags` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`channel_title` text NOT NULL,
	`tag` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_user_channel_tag` ON `channel_tags` (`user_id`,`channel_title`,`tag`);--> statement-breakpoint
CREATE INDEX `ix_channel_tags_user` ON `channel_tags` (`user_id`);--> statement-breakpoint
CREATE TABLE `videos` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`video_id` text NOT NULL,
	`youtube_url` text NOT NULL,
	`title` text NOT NULL,
	`channel_title` text,
	`channel_url` text,
	`duration` integer,
	`thumbnail_url` text,
	`status` text DEFAULT 'PROCESSING' NOT NULL,
	`watch_status` text DEFAULT 'TO_DO' NOT NULL,
	`channel_tags` text,
	`subtitle_type` text DEFAULT 'NONE' NOT NULL,
	`subtitle_language` text,
	`subtitle_text` text,
	`drive_file_id` text,
	`drive_file_url` text,
	`chatgpt_link` text,
	`retry_count` integer DEFAULT 0 NOT NULL,
	`progress_message` text,
	`error_message` text,
	`last_attempt_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_user_video` ON `videos` (`user_id`,`video_id`);--> statement-breakpoint
CREATE INDEX `ix_videos_user_created` ON `videos` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `ix_videos_user_status` ON `videos` (`user_id`,`status`);