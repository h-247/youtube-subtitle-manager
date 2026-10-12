import { currentSiteUser, database, errorResponse } from "../../../../../lib/server-api";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await currentSiteUser();
  if (!user) return errorResponse("Sign in with ChatGPT to access your library.", 401);
  const id = Number((await context.params).id);
  if (!Number.isInteger(id) || id < 1) return errorResponse("Invalid video ID.");
  const video = await database().prepare("SELECT video_id, title, status, subtitle_text FROM videos WHERE id = ? AND user_id = ?").bind(id, user.userId).first<{ video_id: string; title: string; status: string; subtitle_text: string | null }>();
  if (!video) return errorResponse("Video record not found.", 404);
  if (video.status !== "COMPLETED" || !video.subtitle_text) return errorResponse("This video does not have a downloaded subtitle file yet.", 409);
  const filename = `${video.title.replace(/[\\/:*?"<>|]+/g, " ").trim().slice(0, 100) || video.video_id}.srt`;
  return new Response(video.subtitle_text, { headers: { "Content-Type": "text/plain; charset=utf-8", "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`, "Cache-Control": "private, no-store" } });
}
