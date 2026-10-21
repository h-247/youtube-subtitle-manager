import { database } from "./server-api";

let schemaReady: Promise<void> | null = null;

async function ensureSchema() {
  if (!schemaReady) {
    const db = database();
    const pending = db.prepare(`CREATE TABLE IF NOT EXISTS user_prompt_settings (
      user_id TEXT PRIMARY KEY,
      chatgpt_prompt_link TEXT,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`).run().then(() => undefined);
    schemaReady = pending;
    void pending.catch(() => { if (schemaReady === pending) schemaReady = null; });
  }
  await schemaReady;
}

export function normalizePromptLink(value: unknown): string | null | undefined {
  if (value === null || value === "") return null;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? trimmed : undefined;
  } catch {
    return undefined;
  }
}

export async function readPromptLink(userId: string): Promise<string | null> {
  await ensureSchema();
  const row = await database().prepare("SELECT chatgpt_prompt_link FROM user_prompt_settings WHERE user_id = ?")
    .bind(userId).first<{ chatgpt_prompt_link: string | null }>();
  return row?.chatgpt_prompt_link ?? null;
}

export async function writePromptLink(userId: string, value: string | null): Promise<void> {
  await ensureSchema();
  await database().prepare(`INSERT INTO user_prompt_settings (user_id, chatgpt_prompt_link, updated_at)
    VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET chatgpt_prompt_link = excluded.chatgpt_prompt_link, updated_at = excluded.updated_at`)
    .bind(userId, value, new Date().toISOString()).run();
}
