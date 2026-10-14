import { authenticatedLocalUser } from "../../../../lib/local-sync-auth";
import { database, errorResponse, json, type LibraryVideo } from "../../../../lib/server-api";

const fields = [
  "video_id", "youtube_url", "title", "channel_title", "channel_url", "duration", "thumbnail_url",
  "status", "watch_status", "channel_tags", "subtitle_type", "subtitle_language", "subtitle_text",
  "drive_file_id", "drive_file_url", "chatgpt_link", "retry_count", "progress_message", "error_message",
  "created_at", "updated_at", "last_attempt_at", "processing_source",
] as const;

export async function POST(request: Request) {
  const userId = await authenticatedLocalUser(request);
  if (!userId) return errorResponse("Invalid or revoked local sync token.", 401);
  const body = await request.json().catch(() => null) as Partial<LibraryVideo> | null;
  if (!body || typeof body.video_id !== "string" || !/^[\w-]{11}$/.test(body.video_id) || !body.title || !body.youtube_url) {
    return errorResponse("A valid local video record is required.");
  }
  const db = database();
  const values = fields.map((field) => field === "processing_source" ? "LOCAL" : (body[field] ?? null));
  const names = ["user_id", ...fields];
  const updates = fields.slice(1).map((field) => `${field} = excluded.${field}`).join(", ");
  await db.prepare(`INSERT INTO videos (${names.join(", ")}) VALUES (${names.map(() => "?").join(", ")})
    ON CONFLICT(user_id, video_id) DO UPDATE SET ${updates}
    WHERE coalesce(excluded.updated_at, '') >= coalesce(videos.updated_at, '')`)
    .bind(userId, ...values).run();
  const row = await db.prepare("SELECT id FROM videos WHERE user_id = ? AND video_id = ?").bind(userId, body.video_id).first<{ id: number }>();
  return json({ synced: true, id: Number(row?.id) });
}
