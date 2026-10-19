import { authenticatedLocalUser } from "../../../../lib/local-sync-auth";
import { database, errorResponse, json } from "../../../../lib/server-api";

const PAGE_SIZE = 200;

export async function GET(request: Request) {
  const userId = await authenticatedLocalUser(request);
  if (!userId) return errorResponse("Invalid or revoked local sync token.", 401);
  const offsetValue = new URL(request.url).searchParams.get("offset") ?? "0";
  if (!/^\d{1,8}$/.test(offsetValue)) return errorResponse("Invalid offset.");
  const rows = await database().prepare(`SELECT video_id, channel_title, watch_status,
    processing_paused, channel_tags, chatgpt_link, drive_file_id, drive_file_url, updated_at
    FROM videos WHERE user_id = ? ORDER BY id LIMIT ? OFFSET ?`)
    .bind(userId, PAGE_SIZE, Number(offsetValue)).all();
  const tags = await database().prepare("SELECT channel_title, tag FROM channel_tags WHERE user_id = ? ORDER BY tag")
    .bind(userId).all();
  return json({ items: rows.results ?? [], channel_tags: tags.results ?? [],
    next_offset: (rows.results ?? []).length === PAGE_SIZE ? Number(offsetValue) + PAGE_SIZE : null });
}
