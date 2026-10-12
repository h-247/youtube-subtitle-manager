import { currentSiteUser, database, errorResponse, json, videoFromRow, type LibraryVideo } from "../../../../lib/server-api";

const VIDEO_FIELDS = "id, user_id, video_id, youtube_url, title, channel_title, channel_url, duration, thumbnail_url, status, watch_status, channel_tags, subtitle_type, subtitle_language, drive_file_id, drive_file_url, chatgpt_link, retry_count, progress_message, error_message, created_at, updated_at, subtitle_text, last_attempt_at";
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
  const chatgptLink = data.chatgpt_link === null || typeof data.chatgpt_link === "string" ? (data.chatgpt_link as string | null)?.trim() || null : current.chatgpt_link;
  const updated = new Date().toISOString();
  await database().prepare("UPDATE videos SET watch_status = ?, status = ?, channel_tags = ?, chatgpt_link = ?, updated_at = ? WHERE id = ? AND user_id = ?")
    .bind(watchStatus, status, channelTags, chatgptLink, updated, id, user.userId).run();
  const row = await database().prepare(`SELECT ${VIDEO_FIELDS} FROM videos WHERE id = ? AND user_id = ?`).bind(id, user.userId).first<LibraryVideo>();
  return json(row ? videoFromRow(row as unknown as Record<string, unknown>) : null);
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await currentSiteUser();
  if (!user) return errorResponse("Sign in with ChatGPT to access your library.", 401);
  const id = Number((await context.params).id);
  if (!Number.isInteger(id) || id < 1) return errorResponse("Invalid video ID.");
  const result = await database().prepare("DELETE FROM videos WHERE id = ? AND user_id = ?").bind(id, user.userId).run();
  if (!result.meta.changes) return errorResponse("Video record not found.", 404);
  return json({ message: "Video removed from your library." });
}
