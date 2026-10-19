import { authenticatedLocalUser } from "../../../../lib/local-sync-auth";
import { database, errorResponse, json, type LibraryVideo } from "../../../../lib/server-api";
import { syncOnePendingSubtitle } from "../../../../lib/drive-service";

const fields = [
  "video_id", "youtube_url", "title", "channel_title", "channel_url", "duration", "thumbnail_url",
  "status", "watch_status", "channel_tags", "subtitle_type", "subtitle_language", "subtitle_text",
  "drive_file_id", "drive_file_url", "chatgpt_link", "retry_count", "progress_message", "error_message",
  "created_at", "updated_at", "last_attempt_at", "processing_source", "processing_paused", "error_category",
] as const;

export async function POST(request: Request) {
  const userId = await authenticatedLocalUser(request);
  if (!userId) return errorResponse("Invalid or revoked local sync token.", 401);
  const body = await request.json().catch(() => null) as Partial<LibraryVideo> | null;
  if (!body || typeof body.video_id !== "string" || !/^[\w-]{11}$/.test(body.video_id) || !body.title || !body.youtube_url) {
    return errorResponse("A valid local video record is required.");
  }
  if (typeof body.created_at !== "string" || !Number.isFinite(Date.parse(body.created_at))) return errorResponse("A valid creation timestamp is required.");
  const db = database();
  const tombstone = await db.prepare("SELECT deleted_at FROM sync_tombstones WHERE user_id = ? AND video_id = ?").bind(userId, body.video_id).first<{deleted_at: string}>();
  if (tombstone && (!body.created_at || Date.parse(body.created_at) <= Date.parse(tombstone.deleted_at))) {
    return json({ synced: true, deleted: true });
  }
  const values = fields.map((field) => field === "processing_source" ? "LOCAL" : field === "processing_paused" ? Number(body.processing_paused || 0) : (body[field] ?? null));
  const names = ["user_id", ...fields];
  const updates = fields.slice(1).map((field) =>
    field === "drive_file_id" || field === "drive_file_url"
      ? `${field} = coalesce(excluded.${field}, videos.${field})`
      : `${field} = excluded.${field}`,
  ).join(", ");
  await db.prepare(`INSERT INTO videos (${names.join(", ")}) SELECT ${names.map(() => "?").join(", ")}
    WHERE NOT EXISTS (SELECT 1 FROM sync_tombstones WHERE user_id = ? AND video_id = ? AND julianday(deleted_at) >= julianday(?))
    ON CONFLICT(user_id, video_id) DO UPDATE SET ${updates}
    WHERE coalesce(excluded.updated_at, '') >= coalesce(videos.updated_at, '')`)
    .bind(userId, ...values, userId, body.video_id, body.created_at).run();
  const row = await db.prepare("SELECT id FROM videos WHERE user_id = ? AND video_id = ?")
    .bind(userId, body.video_id).first<{ id: number }>();
  // Mirror accepted local tag edits into the channel-level table as well.
  // Guard every statement so a newer Site edit cannot be overwritten.
  if (body.channel_title && typeof body.updated_at === "string") {
    const tags = [...new Set((body.channel_tags ?? "").split(",").map(tag => tag.trim().replace(/^#/, "").toLowerCase()).filter(Boolean))];
    const accepted = "EXISTS (SELECT 1 FROM videos WHERE user_id = ? AND video_id = ? AND updated_at = ?)";
    const statements = [db.prepare(`DELETE FROM channel_tags WHERE user_id = ? AND channel_title = ? AND ${accepted}`)
      .bind(userId, body.channel_title, userId, body.video_id, body.updated_at)];
    for (const tag of tags) statements.push(db.prepare(`INSERT OR IGNORE INTO channel_tags (user_id, channel_title, tag)
      SELECT ?, ?, ? WHERE ${accepted}`).bind(userId, body.channel_title, tag, userId, body.video_id, body.updated_at));
    await db.batch(statements);
  }
  const driveUpload = body.status === "COMPLETED" ? await syncOnePendingSubtitle(userId) : null;
  const current = await db.prepare("SELECT video_id, drive_file_id, drive_file_url FROM videos WHERE user_id = ? AND video_id = ?")
    .bind(userId, body.video_id).first<{ video_id: string; drive_file_id: string | null; drive_file_url: string | null }>();
  const currentLink = current?.drive_file_id && current.drive_file_url ? {
    video_id: current.video_id, drive_file_id: current.drive_file_id, drive_file_url: current.drive_file_url,
  } : null;
  const driveUploads = [currentLink, driveUpload].filter((item, index, items) =>
    item && items.findIndex((candidate) => candidate?.video_id === item.video_id) === index,
  );
  return json({ synced: true, id: Number(row?.id), drive_uploads: driveUploads });
}
