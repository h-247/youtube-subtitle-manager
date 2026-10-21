import { database } from "./server-api";

export function normalizePromptLink(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return null;
  try { return ["http:", "https:"].includes(new URL(trimmed).protocol) ? trimmed : undefined; }
  catch { return undefined; }
}

export async function readPromptLink(userId: string): Promise<string | null> {
  const row = await database().prepare("SELECT chatgpt_prompt_link FROM user_preferences WHERE user_id = ?")
    .bind(userId).first<{chatgpt_prompt_link: string | null}>();
  return row?.chatgpt_prompt_link ?? null;
}

export async function writePromptLink(userId: string, value: string | null): Promise<void> {
  await database().prepare(`INSERT INTO user_preferences (user_id, chatgpt_prompt_link) VALUES (?, ?)
    ON CONFLICT(user_id) DO UPDATE SET chatgpt_prompt_link = excluded.chatgpt_prompt_link`).bind(userId, value).run();
}
