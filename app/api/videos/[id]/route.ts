import { currentSiteUser, database, errorResponse, json, videoFromRow, type LibraryVideo } from "../../../../lib/server-api";

const VIDEO_FIELDS = "id, user_id, video_id, youtube_url, title, channel_title, channel_url, duration, thumbnail_url, status, watch_status, channel_tags, subtitle_type, subtitle_language, drive_file_id, drive_file_url, chatgpt_link, retry_count, progress_message, error_message, created_at, updated_at, subtitle_text, last_attempt_at, tags_json, processing_paused, error_category";
const cleanTags = (value: string | null | undefined) => [...new Set((value ?? "").split(",").map((tag) => tag.trim().replace(/^#/, "").toLowerCase()).filter(Boolean))].join(", ") || null;

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await currentSiteUser();
  if (!user) return errorResponse("Sign in with ChatGPT to access your library.", 401);
  const id = Number((await context.params).id);
  if (!Number.isInteger(id) || id < 1) return errorResponse("Invalid video ID.");
  const data = await request.json().catch(() => ({})) as Record<string, unknown>;
  const current = await database().prepare(`SELECT ${VIDEO_FIELDS} FROM videos WHERE id = ? AND user_id = ?`).bind(id, user.userId).first<LibraryVideo>();
  if (!current) return errorResponse("Video record not found.", 404);

  const watchStatus = typeof data.watch_status === "string" && ["TO_DO", "DOING", "DONE"].includes(data.watch_status) ? data.watch_status : current.watch_status;
  const status = typeof data.status === "string" && ["PENDING", "PROCESSING", "COMPLETED", "NO_SUBTITLES", "FAILED"].includes(data.status) ? data.status : current.status;
  const channelTags = data.channel_tags === null || typeof data.channel_tags === "string" ? cleanTags(data.channel_tags as string | null) : current.channel_tags;
  const tags = Array.isArray(data.tags) && data.tags.every(t => typeof t === "string")
    ? [...new Set((data.tags as string[]).map(t => t.trim()).filter(Boolean))]
    : data.tags === null ? []
    : "channel_tags" in data ? (channelTags || "").split(",").map(t => t.trim()).filter(Boolean)
    : current.tags_json != null ? JSON.parse(current.tags_json) as string[] : (current.channel_tags || "").split(",").map(t => t.trim()).filter(Boolean);
  const chatgptLink = data.chatgpt_link === null || typeof data.chatgpt_link === "string" ? (data.chatgpt_link as string | null)?.trim() || null : current.chatgpt_link;
  const paused = typeof data.processing_paused === "boolean" ? Number(data.processing_paused) : Number(current.processing_paused || 0);
  const updated = new Date().toISOString();
  await database().prepare("UPDATE videos SET tags_json = ?, processing_paused = ?, watch_status = ?, status = ?, channel_tags = ?, chatgpt_link = ?, updated_at = ? WHERE id = ? AND user_id = ?")
    .bind(JSON.stringify(tags), paused, watchStatus, status, tags.join(", ") || null, chatgptLink, updated, id, user.userId).run();
  const row = await database().prepare(`SELECT ${VIDEO_FIELDS} FROM videos WHERE id = ? AND user_id = ?`).bind(id, user.userId).first<LibraryVideo>();
  return json(row ? videoFromRow(row as unknown as Record<string, unknown>) : null);
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await currentSiteUser();
  if (!user) return errorResponse("Sign in with ChatGPT to access your library.", 401);
  const id = Number((await context.params).id);
  if (!Number.isInteger(id) || id < 1) return errorResponse("Invalid video ID.");
  const db = database();
  const row = await db.prepare("SELECT video_id FROM videos WHERE id = ? AND user_id = ?").bind(id, user.userId).first<{video_id: string}>();
  if (!row) return errorResponse("Video record not found.", 404);
  await db.batch([
    db.prepare("UPDATE playlist_cleanup_jobs SET state = 'CANCELLED' WHERE user_id = ? AND video_id = ? AND state IN ('PENDING','FAILED')").bind(user.userId,row.video_id),
    db.prepare("INSERT INTO sync_tombstones (user_id, video_id, deleted_at) VALUES (?, ?, ?) ON CONFLICT(user_id, video_id) DO UPDATE SET deleted_at = excluded.deleted_at").bind(user.userId, row.video_id, new Date().toISOString()),
    db.prepare("DELETE FROM videos WHERE id = ? AND user_id = ?").bind(id, user.userId),
  ]);
  return json({ message: "Video removed from your library." });
}
