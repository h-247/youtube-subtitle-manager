import { authenticatedLocalUser } from "../../../../lib/local-sync-auth";
import { database, errorResponse, json } from "../../../../lib/server-api";

export async function GET(request: Request) {
  const userId = await authenticatedLocalUser(request);
  if (!userId) return errorResponse("Invalid or revoked local sync token.", 401);
  const row = await database().prepare("SELECT chatgpt_prompt_link FROM user_preferences WHERE user_id = ?")
    .bind(userId).first<{ chatgpt_prompt_link: string | null }>();
  return json({ chatgpt_prompt_link: row?.chatgpt_prompt_link ?? null });
}

export async function PUT(request: Request) {
  const userId = await authenticatedLocalUser(request);
  if (!userId) return errorResponse("Invalid or revoked local sync token.", 401);
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || typeof body !== "object" || !("chatgpt_prompt_link" in body) ||
    (body.chatgpt_prompt_link !== null && typeof body.chatgpt_prompt_link !== "string")) {
    return errorResponse("ChatGPT prompt link is required.", 422);
  }
  const value = body.chatgpt_prompt_link?.trim() || null;
  if (value) {
    try {
      const url = new URL(value);
      if (!["http:", "https:"].includes(url.protocol)) throw new Error();
    } catch { return errorResponse("Enter a valid HTTP or HTTPS ChatGPT link.", 422); }
  }
  await database().prepare(`INSERT INTO user_preferences (user_id, chatgpt_prompt_link) VALUES (?, ?)
    ON CONFLICT(user_id) DO UPDATE SET chatgpt_prompt_link = excluded.chatgpt_prompt_link`)
    .bind(userId, value).run();
  return json({ chatgpt_prompt_link: value });
}
