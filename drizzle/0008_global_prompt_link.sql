CREATE TABLE IF NOT EXISTS `user_prompt_settings` (
	`user_id` text PRIMARY KEY NOT NULL,
	`chatgpt_prompt_link` text,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
