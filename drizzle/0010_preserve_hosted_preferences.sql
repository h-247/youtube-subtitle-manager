-- Older hosted releases stored the shared link under this table name.
-- Keep the table and copy preferences without overwriting newer canonical values.
CREATE TABLE IF NOT EXISTS user_prompt_settings (
  user_id TEXT PRIMARY KEY NOT NULL,
  chatgpt_prompt_link TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO user_preferences (user_id, chatgpt_prompt_link)
SELECT user_id, chatgpt_prompt_link FROM user_prompt_settings WHERE true
ON CONFLICT(user_id) DO NOTHING;
