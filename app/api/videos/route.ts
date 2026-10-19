import { currentSiteUser, database, errorResponse, json, videoFromRow, youtubeFetch, retryVideo, type LibraryVideo } from "../../../lib/server-api";
import { syncOnePendingSubtitle } from "../../../lib/drive-service";

const VIDEO_FIELDS = "id, user_id, video_id, youtube_url, title, channel_title, channel_url, duration, thumbnail_url, status, watch_status, channel_tags, subtitle_type, subtitle_language, drive_file_id, drive_file_url, chatgpt_link, retry_count, progress_message, error_message, created_at, updated_at, subtitle_text, last_attempt_at, processing_paused, error_category";

function videoIdsFromUrl(rawUrl: string, playlistHtml = "") {
  const url = new URL(rawUrl);
  const direct = url.hostname.replace(/^www\./, "") === "youtu.be"
    ? url.pathname.split("/").filter(Boolean)[0]
    : url.searchParams.get("v") ?? url.pathname.match(/^\/(?:shorts|embed|live)\/([^/?]+)/)?.[1];
  if (direct && /^[\w-]{11}$/.test(direct)) return [direct];
  return [...new Set([...playlistHtml.matchAll(/"videoId"\s*:\s*"([\w-]{11})"/g)].map((match) => match[1]))].slice(0, 20);
}

export async function GET(request: Request) {
  const user = await currentSiteUser();
  if (!user) return errorResponse("Sign in with ChatGPT to access your library.", 401);
  const db = database();
  const url = new URL(request.url);
  await syncOnePendingSubtitle(user.userId);
  const search = url.searchParams.get("search")?.trim() ?? "";
  const status = url.searchParams.get("status")?.trim().toUpperCase() ?? "ALL";
  const watchStatus = url.searchParams.get("watch_status")?.trim().toUpperCase() ?? "ALL";
  const tag = url.searchParams.get("tag")?.trim().replace(/^#/, "").toLowerCase() ?? "ALL";
  const requestedPage = Number.parseInt(url.searchParams.get("page") || "1", 10);
  const requestedPageSize = Number.parseInt(url.searchParams.get("page_size") || "20", 10);
  const page = Number.isFinite(requestedPage) ? Math.max(1, requestedPage) : 1;
  const pageSize = Number.isFinite(requestedPageSize) ? Math.min(100, Math.max(1, requestedPageSize)) : 20;
  const clauses = ["user_id = ?"];
  const binds: unknown[] = [user.userId];
  if (search) { clauses.push("(lower(title) LIKE ? OR lower(channel_title) LIKE ? OR lower(video_id) LIKE ?)"); binds.push(`%${search.toLowerCase()}%`, `%${search.toLowerCase()}%`, `%${search.toLowerCase()}%`); }
  if (status !== "ALL") {
    if (["TO_DO", "DOING", "DONE"].includes(status)) { clauses.push("watch_status = ?"); binds.push(status); }
    else { clauses.push("status = ?"); binds.push(status); }
  }
  if (watchStatus !== "ALL") { clauses.push("watch_status = ?"); binds.push(watchStatus); }
  if (tag !== "ALL") { clauses.push("(lower(coalesce(channel_tags, '')) LIKE ? OR channel_title IN (SELECT channel_title FROM channel_tags WHERE user_id = ? AND lower(tag) = ?))"); binds.push(`%${tag}%`, user.userId, tag); }
  const where = clauses.join(" AND ");

  const due = await db.prepare(`SELECT id FROM videos WHERE user_id = ? AND status = 'PROCESSING' AND processing_source <> 'LOCAL' AND processing_paused = 0 ORDER BY coalesce(last_attempt_at, '') ASC LIMIT 1`).bind(user.userId).first<{ id: number }>();
  if (due) await retryVideo(Number(due.id), user.userId);

  const totalRow = await db.prepare(`SELECT COUNT(*) AS total FROM videos WHERE ${where}`).bind(...binds).first<{ total: number }>();
  const total = Number(totalRow?.total ?? 0);
  const items = await db.prepare(`SELECT ${VIDEO_FIELDS} FROM videos WHERE ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
    .bind(...binds, pageSize, (page - 1) * pageSize).all<LibraryVideo>();
  return json({ items: (items.results ?? []).map((row) => videoFromRow(row as unknown as Record<string, unknown>)), total, page, page_size: pageSize, total_pages: Math.max(1, Math.ceil(total / pageSize)) });
}

export async function POST(request: Request) {
  const user = await currentSiteUser();
  if (!user) return errorResponse("Sign in with ChatGPT to access your library.", 401);
  const body = await request.json().catch(() => ({})) as { url?: string };
  const rawUrl = body.url?.trim();
  if (!rawUrl) return errorResponse("A YouTube video or playlist URL is required.");
  let url: URL;
  try { url = new URL(rawUrl); } catch { return errorResponse("Enter a valid YouTube URL."); }
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (![("youtube.com"), "m.youtube.com", "music.youtube.com", "youtu.be"].includes(host)) return errorResponse("Only YouTube video, Short, or playlist URLs are supported.");
  const playlistId = url.searchParams.get("list");
  let playlistHtml = "";
  if (!url.searchParams.get("v") && !url.pathname.match(/^\/(?:shorts|embed|live)\//) && host !== "youtu.be" && playlistId) {
    const playlistUrl = `https://www.youtube.com/playlist?list=${encodeURIComponent(playlistId)}&hl=en`;
    const response = await youtubeFetch(playlistUrl, { signal: AbortSignal.timeout(15000) }).catch(() => null);
    if (!response?.ok) return errorResponse("Could not read this YouTube playlist. Check that it is public and try again.");
    playlistHtml = await response.text();
  }
  const ids = videoIdsFromUrl(rawUrl, playlistHtml);
  if (!ids.length) return errorResponse("No public YouTube video was found in that URL.");

  const db = database();
  const results = [];
  let processed = 0;
  let skipped = 0;
  for (const videoId of ids) {
    const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
    const current = await db.prepare("SELECT * FROM videos WHERE user_id = ? AND video_id = ?").bind(user.userId, videoId).first<LibraryVideo>();
    if (current?.status === "COMPLETED" || current?.status === "PROCESSING") {
      skipped++;
      results.push({ video_id: videoId, title: current.title, status: current.status, subtitle_type: current.subtitle_type, is_duplicate: true, video: videoFromRow(current as unknown as Record<string, unknown>) });
      continue;
    }

    const metaResponse = await youtubeFetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(videoUrl)}`, { signal: AbortSignal.timeout(12000) }).catch(() => null);
    if (!metaResponse?.ok) {
      results.push({ video_id: videoId, title: videoId, status: "FAILED", subtitle_type: "NONE", is_duplicate: false, error: "YouTube video is unavailable or private." });
      continue;
    }
    const meta = await metaResponse.json() as { title?: string; author_name?: string; author_url?: string; thumbnail_url?: string };
    const now = new Date().toISOString();
    const title = String(meta.title || videoId);
    if (current) {
      await db.prepare("UPDATE videos SET youtube_url = ?, title = ?, channel_title = ?, channel_url = ?, thumbnail_url = ?, status = 'PROCESSING', subtitle_type = 'NONE', subtitle_language = NULL, subtitle_text = NULL, retry_count = 0, progress_message = 'Queued for Sites Worker processing…', error_message = NULL, last_attempt_at = NULL, updated_at = ? WHERE id = ? AND user_id = ?")
        .bind(videoUrl, title, meta.author_name ?? null, meta.author_url ?? null, meta.thumbnail_url ?? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`, now, current.id, user.userId).run();
    } else {
      await db.prepare("INSERT OR IGNORE INTO videos (user_id, video_id, youtube_url, title, channel_title, channel_url, thumbnail_url, status, watch_status, subtitle_type, retry_count, progress_message, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'PROCESSING', 'TO_DO', 'NONE', 0, 'Queued for Sites Worker processing…', ?, ?)")
        .bind(user.userId, videoId, videoUrl, title, meta.author_name ?? null, meta.author_url ?? null, meta.thumbnail_url ?? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`, now, now).run();
    }
    const row = await db.prepare("SELECT * FROM videos WHERE user_id = ? AND video_id = ?").bind(user.userId, videoId).first<LibraryVideo>();
    processed++;
    results.push({ video_id: videoId, title, status: "PROCESSING", subtitle_type: "NONE", is_duplicate: false, video: row ? videoFromRow(row as unknown as Record<string, unknown>) : null });
  }
  return json({ total_found: ids.length, processed, skipped_duplicates: skipped, failed: results.filter((item) => item.status === "FAILED").length, results }, 202);
}
