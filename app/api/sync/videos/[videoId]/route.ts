import { authenticatedLocalUser } from "../../../../../lib/local-sync-auth";
import { database, errorResponse, json } from "../../../../../lib/server-api";

export async function DELETE(request: Request, context: { params: Promise<{ videoId: string }> }) {
  const userId = await authenticatedLocalUser(request);
  if (!userId) return errorResponse("Invalid or revoked local sync token.", 401);
  const { videoId } = await context.params;
  if (!/^[\w-]{11}$/.test(videoId)) return errorResponse("A valid video ID is required.");
  await database().prepare("DELETE FROM videos WHERE user_id = ? AND video_id = ?").bind(userId, videoId).run();
  return json({ synced: true });
}
