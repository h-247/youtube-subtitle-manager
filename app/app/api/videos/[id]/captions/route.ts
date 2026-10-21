import { currentSiteUser, database, errorResponse, json, toSrt } from "../../../../../../lib/server-api";

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

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await currentSiteUser();
  if (!user) return errorResponse("Sign in with ChatGPT to access your library.", 401);
  const id = Number((await context.params).id);
  if (!Number.isInteger(id) || id < 1) return errorResponse("Invalid video ID.");

  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > 2_100_000) return errorResponse("Caption file must be 2 MB or smaller.", 413);
  const body = await request.json().catch(() => null) as { filename?: unknown; content?: unknown } | null;
  if (!body || typeof body.filename !== "string" || typeof body.content !== "string") {
    return errorResponse("Choose an English VTT or SRT file.");
  }
  if (new TextEncoder().encode(body.content).byteLength > 2_000_000) {
    return errorResponse("Caption file must be 2 MB or smaller.", 413);
  }
  const filename = body.filename.toLowerCase();
  const source = body.content.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").trim();
  let srt: string;
  if (filename.endsWith(".vtt") && /^WEBVTT(?:\s|$)/i.test(source)) {
    srt = toSrt(source);
  } else if (filename.endsWith(".srt") && /\d{2}:\d{2}:\d{2},\d{3}\s+-->\s+\d{2}:\d{2}:\d{2},\d{3}/.test(source)) {
    srt = source;
  } else {
    return errorResponse("File must contain valid VTT or SRT captions.");
  }
  if (!srt.trim()) return errorResponse("Caption file has no readable cues.");

  const db = database();
  const updated = await db.prepare(
    "UPDATE videos SET status = 'COMPLETED', subtitle_type = 'IMPORTED', subtitle_language = 'en', subtitle_text = ?, drive_file_id = NULL, drive_file_url = NULL, drive_retry_count = 0, drive_last_attempt_at = NULL, progress_message = 'Imported captions ready', error_message = NULL, updated_at = ? WHERE id = ? AND user_id = ? AND status <> 'COMPLETED'"
  ).bind(srt, new Date().toISOString(), id, user.userId).run();
  if (!updated.meta.changes) {
    const existing = await db.prepare("SELECT id, status FROM videos WHERE id = ? AND user_id = ?").bind(id, user.userId).first<{ id: number; status: string }>();
    return errorResponse(existing ? "This video already has subtitles." : "Video record not found.", existing ? 409 : 404);
  }
  return json({ message: "English captions imported. The SRT is ready for download and Drive sync." });
}
