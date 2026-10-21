import { readManagedPlaylist, enqueuePlaylistRemoval, processOnePlaylistRemoval } from "../../../lib/youtube-playlists";
import { currentSiteUser, database, ensureVideoPromptLinkColumn, errorResponse, json, videoFromRow, youtubeFetch, retryVideo, type LibraryVideo } from "../../../lib/server-api";
import { syncOnePendingSubtitle } from "../../../lib/drive-service";

const VIDEO_FIELDS = "id, user_id, video_id, youtube_url, title, channel_title, channel_url, duration, thumbnail_url, status, watch_status, channel_tags, subtitle_type, subtitle_language, drive_file_id, drive_file_url, chatgpt_link, chatgpt_prompt_link, retry_count, progress_message, error_message, created_at, updated_at, subtitle_text, last_attempt_at, tags_json, processing_paused, error_category";

function videoIdsFromUrl(rawUrl: string, playlistHtml = "") {
  const url = new URL(rawUrl);
  const direct = url.hostname.replace(/^www\./, "") === "youtu.be"
    ? url.pathname.split("/").filter(Boolean)[0]
    : url.searchParams.get("v") ?? url.pathname.match(/^\/(?:shorts|embed|live)\/([^/?]+)/)?.[1];
  if (direct && /^[\w-]{11}$/.test(direct)) return [direct];
  return [];
}

export async function GET(request: Request) {
  const user = await currentSiteUser();
  if (!user) return errorResponse("Sign in with ChatGPT to access your library.", 401);
  const db = database();
  await ensureVideoPromptLinkColumn(db);
  const url = new URL(request.url);
  await syncOnePendingSubtitle(user.userId);
  await processOnePlaylistRemoval(user.userId);
  const search = url.searchParams.get("search")?.trim() ?? "";
  const status = url.searchParams.get("status")?.trim().toUpperCase() ?? "ALL";
  const watchStatus = url.searchParams.get("watch_status")?.trim().toUpperCase() ?? "ALL";
  const tag = url.searchParams.get("tag")?.trim() ?? "ALL";
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
  if (tag !== "ALL") { clauses.push("EXISTS (SELECT 1 FROM json_each(coalesce(tags_json, json_array())) WHERE value = ?) OR (tags_json IS NULL AND lower(coalesce(channel_tags, '')) LIKE ?)"); binds.push(tag, `%${tag}%`); clauses[clauses.length - 1] = `(${clauses.at(-1)})`; }
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
  const body = await request.json().catch(() => ({})) as {url?: string; mode?: string; tags?: unknown};
  if (typeof body.url !== "string") return errorResponse("A YouTube URL is required.");
  let url: URL;
  try { url = new URL(body.url); } catch { return errorResponse("Enter a valid YouTube URL."); }
  if (!["http:","https:"].includes(url.protocol) || !["youtube.com","www.youtube.com","m.youtube.com","music.youtube.com","youtu.be"].includes(url.hostname)) return errorResponse("Enter a valid YouTube URL.");
  const mode = body.mode || (url.searchParams.get("list") ? "playlist" : "video");
  if (!["video", "playlist"].includes(mode)) return errorResponse("Choose Single video or YouTube playlist.");
  if (body.tags !== undefined && (!Array.isArray(body.tags) || !body.tags.every(t => typeof t === "string"))) return errorResponse("Video tags must be a list of names.");
  let incoming = Array.isArray(body.tags) ? [...new Set((body.tags as string[]).map(t => t.trim().replace(/^#/, "")).filter(Boolean))] : [];
  let source: Array<{video_id: string; title: string; channel_title: string | null; channel_url: string | null; thumbnail_url: string | null; duration: number | null; playlist_item_id?: string}>;
  try {
    if (mode === "playlist") {
      const id = url.searchParams.get("list");
      if (!id) return errorResponse("Playlist mode requires a YouTube playlist URL.");
      const playlist = await readManagedPlaylist(user.userId, id);
      incoming = [playlist.title]; source = playlist.videos;
    } else {
      if (url.pathname === "/playlist") return errorResponse("Choose YouTube playlist to import a playlist.");
      url.searchParams.delete("list");
      const id = videoIdsFromUrl(url.toString())[0];
      if (!id) return errorResponse("Enter a valid video or Short URL.");
      const response = await youtubeFetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${id}`)}`, {signal: AbortSignal.timeout(12000)});
      if (!response.ok) return errorResponse("YouTube video is unavailable or private.");
      const meta = await response.json() as { title?: string; author_name?: string; author_url?: string; thumbnail_url?: string };
      source = [{video_id: id, title: meta.title || id, channel_title: meta.author_name || null, channel_url: meta.author_url || null, thumbnail_url: meta.thumbnail_url || null, duration: null}];
    }
  } catch (error) { return errorResponse(error instanceof Error ? error.message : "Could not read YouTube content.", 422); }
  if (!source.length) return errorResponse("No accessible videos were found in this playlist.");
  const db = database(); const results = []; let processed = 0; let skipped = 0;
  for (const item of source) {
    const current = await db.prepare("SELECT * FROM videos WHERE user_id = ? AND video_id = ?").bind(user.userId, item.video_id).first<LibraryVideo>();
    const previous = current ? videoFromRow(current as unknown as Record<string, unknown>).tags || [] : [];
    const tags = [...new Set([...previous, ...incoming])]; const now = new Date().toISOString();
    const videoUrl = `https://www.youtube.com/watch?v=${item.video_id}`;
    if (current?.status === "COMPLETED" || current?.status === "PROCESSING") {
      await db.prepare("UPDATE videos SET tags_json = ?, channel_tags = ?, updated_at = ? WHERE id = ? AND user_id = ?").bind(JSON.stringify(tags), tags.join(", ") || null, now, current.id, user.userId).run();
      skipped++;
    } else if (current) {
      await db.prepare("UPDATE videos SET tags_json = ?, channel_tags = ?, youtube_url = ?, title = ?, channel_title = ?, channel_url = ?, thumbnail_url = ?, duration = ?, status = 'PROCESSING', retry_count = 0, last_attempt_at = NULL, progress_message = 'Queued for processing', error_message = NULL, updated_at = ? WHERE id = ? AND user_id = ?")
        .bind(JSON.stringify(tags), tags.join(", ") || null, videoUrl, item.title, item.channel_title, item.channel_url, item.thumbnail_url, item.duration, now, current.id, user.userId).run();
      processed++;
    } else {
      await db.prepare("INSERT INTO videos (user_id, video_id, youtube_url, title, channel_title, channel_url, thumbnail_url, duration, tags_json, channel_tags, status, watch_status, subtitle_type, retry_count, progress_message, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PROCESSING', 'TO_DO', 'NONE', 0, 'Queued for processing', ?, ?)")
        .bind(user.userId, item.video_id, videoUrl, item.title, item.channel_title, item.channel_url, item.thumbnail_url || `https://i.ytimg.com/vi/${item.video_id}/hqdefault.jpg`, item.duration, JSON.stringify(tags), tags.join(", ") || null, now, now).run();
      processed++;
    }
    if (mode === "playlist" && item.playlist_item_id) await enqueuePlaylistRemoval(user.userId,item.video_id,[{playlist_id:url.searchParams.get("list"),playlist_item_id:item.playlist_item_id}]);
    const row = await db.prepare("SELECT * FROM videos WHERE user_id = ? AND video_id = ?").bind(user.userId, item.video_id).first<LibraryVideo>();
    results.push({ video_id: item.video_id, title: item.title, status: row?.status, subtitle_type: row?.subtitle_type, is_duplicate: !!current && (current.status === "COMPLETED" || current.status === "PROCESSING"), video: row ? videoFromRow(row as unknown as Record<string, unknown>) : null });
  }
  return json({total_found: source.length, processed, skipped_duplicates: skipped, failed: 0, results}, 202);
}
