import { authenticatedLocalUser } from "../../../../../lib/local-sync-auth";
import { database, errorResponse, json } from "../../../../../lib/server-api";

export async function DELETE(request: Request, context: { params: Promise<{ videoId: string }> }) {
  const userId = await authenticatedLocalUser(request);
  if (!userId) return errorResponse("Invalid or revoked local sync token.", 401);
  const { videoId } = await context.params;
  if (!/^[\w-]{11}$/.test(videoId)) return errorResponse("A valid video ID is required.");
  const db = database();
  await db.batch([
    db.prepare("UPDATE playlist_cleanup_jobs SET state = 'CANCELLED' WHERE user_id = ? AND video_id = ? AND state IN ('PENDING','FAILED')").bind(userId,videoId),
    db.prepare("INSERT INTO sync_tombstones (user_id, video_id, deleted_at) VALUES (?, ?, ?) ON CONFLICT(user_id, video_id) DO UPDATE SET deleted_at = excluded.deleted_at").bind(userId, videoId, new Date().toISOString()),
    db.prepare("DELETE FROM videos WHERE user_id = ? AND video_id = ?").bind(userId, videoId),
  ]);
  return json({ synced: true });
}
