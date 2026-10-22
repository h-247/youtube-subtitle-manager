import { database } from "./server-api";
import { readManagedPlaylistPage } from "./youtube-playlists";

type ImportDiscovery = { id: string; playlist_id: string; next_page_token: string | null; tags_json: string; discovery_attempts: number };

/** Fetch and atomically checkpoint one playlist page. Replaying a page is idempotent. */
export async function processOnePlaylistDiscovery(userId: string) {
  const db = database();
  const now = Date.now();
  const job = await db.prepare(`SELECT id, playlist_id, next_page_token, tags_json, discovery_attempts FROM playlist_imports
    WHERE user_id = ? AND state = 'DISCOVERING' AND discovery_next_attempt <= ? AND discovery_lease_until <= ?
    ORDER BY created_at, id LIMIT 1`).bind(userId, now, now).first<ImportDiscovery>();
  if (!job) return false;
  const lease = await db.prepare(`UPDATE playlist_imports SET discovery_lease_until = ?
    WHERE id = ? AND user_id = ? AND state = 'DISCOVERING' AND discovery_next_attempt <= ? AND discovery_lease_until <= ?`)
    .bind(now + 90_000, job.id, userId, now, now).run();
  if (!lease.meta.changes) return false;

  try {
    const page = await readManagedPlaylistPage(userId, job.playlist_id, job.next_page_token);
    const timestamp = new Date().toISOString();
    const tags = [...new Set([...JSON.parse(job.tags_json) as string[], ...(page.title ? [page.title] : [])])];
    const statements = page.videos.map(item => db.prepare(`INSERT INTO playlist_import_items
      (import_id, user_id, video_id, title, channel_title, channel_url, thumbnail_url, duration,
       playlist_id, playlist_item_id, tags_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(import_id, video_id, playlist_item_id) DO NOTHING`)
      .bind(job.id, userId, item.video_id, item.title, item.channel_title, item.channel_url, item.thumbnail_url,
        item.duration, job.playlist_id, item.playlist_item_id, JSON.stringify(tags), timestamp));
    const complete = page.nextPageToken ? 0 : 1;
    statements.push(db.prepare(`UPDATE playlist_imports SET title = coalesce(?, title), total_items =
      (SELECT count(*) FROM playlist_import_items WHERE import_id = ?), next_page_token = ?,
      discovery_complete = ?, state = CASE WHEN ? = 1 THEN
        CASE WHEN (SELECT count(*) FROM playlist_import_items WHERE import_id = ?) = 0 THEN 'COMPLETED' ELSE 'PENDING' END
        ELSE 'DISCOVERING' END,
      tags_json = ?, discovery_attempts = 0, discovery_next_attempt = 0, discovery_lease_until = 0, discovery_error = NULL, updated_at = ?
      WHERE id = ? AND user_id = ?`)
      .bind(page.title, job.id, page.nextPageToken, complete, complete, job.id, JSON.stringify(tags), timestamp, job.id, userId));
    await db.batch(statements);
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : "Unknown playlist discovery failure";
    const delay = Math.min(15 * 60_000, 2_000 * 2 ** Math.min(job.discovery_attempts, 8));
    await db.prepare(`UPDATE playlist_imports SET discovery_attempts = discovery_attempts + 1,
      discovery_next_attempt = ?, discovery_lease_until = 0, discovery_error = ?, updated_at = ?
      WHERE id = ? AND user_id = ? AND state = 'DISCOVERING'`)
      .bind(now + delay, message, new Date().toISOString(), job.id, userId).run();
  }
  return true;
}

type ImportItem = {
  id: number;
  import_id: string;
  user_id: string;
  video_id: string;
  title: string;
  channel_title: string | null;
  channel_url: string | null;
  thumbnail_url: string | null;
  duration: number | null;
  playlist_id: string;
  playlist_item_id: string;
  tags_json: string;
};

/** Apply one durable playlist item atomically. An expired claim is safe to replay. */
export async function processOnePlaylistImport(userId: string) {
  const db = database();
  const now = Date.now();
  const item = await db.prepare(`SELECT * FROM playlist_import_items
    WHERE user_id = ? AND (state = 'PENDING' OR (state = 'PROCESSING' AND lease_until <= ?))
    ORDER BY id LIMIT 1`).bind(userId, now).first<ImportItem>();
  if (!item) return false;

  const claim = await db.prepare(`UPDATE playlist_import_items SET state = 'PROCESSING', lease_until = ?
    WHERE id = ? AND user_id = ? AND (state = 'PENDING' OR (state = 'PROCESSING' AND lease_until <= ?))`)
    .bind(now + 90_000, item.id, userId, now).run();
  if (!claim.meta.changes) return false;

  const timestamp = new Date().toISOString();
  const videoUrl = `https://www.youtube.com/watch?v=${item.video_id}`;
  try {
  await db.batch([
    db.prepare(`INSERT INTO videos (user_id, video_id, youtube_url, title, channel_title, channel_url,
      thumbnail_url, duration, tags_json, channel_tags, status, watch_status, subtitle_type, retry_count,
      progress_message, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?,
        (SELECT group_concat(value, ', ') FROM json_each(?)), 'PROCESSING', 'TO_DO', 'NONE', 0,
        'Queued for processing', ?, ?)
      ON CONFLICT(user_id, video_id) DO UPDATE SET
        tags_json = (SELECT json_group_array(value) FROM (
          SELECT value FROM json_each(coalesce(videos.tags_json, '[]'))
          UNION SELECT value FROM json_each(excluded.tags_json)
        )),
        channel_tags = (SELECT group_concat(value, ', ') FROM (
          SELECT value FROM json_each(coalesce(videos.tags_json, '[]'))
          UNION SELECT value FROM json_each(excluded.tags_json)
        )),
        youtube_url = CASE WHEN videos.status IN ('COMPLETED', 'PROCESSING') THEN videos.youtube_url ELSE excluded.youtube_url END,
        title = CASE WHEN videos.status IN ('COMPLETED', 'PROCESSING') THEN videos.title ELSE excluded.title END,
        channel_title = CASE WHEN videos.status IN ('COMPLETED', 'PROCESSING') THEN videos.channel_title ELSE excluded.channel_title END,
        channel_url = CASE WHEN videos.status IN ('COMPLETED', 'PROCESSING') THEN videos.channel_url ELSE excluded.channel_url END,
        thumbnail_url = CASE WHEN videos.status IN ('COMPLETED', 'PROCESSING') THEN videos.thumbnail_url ELSE excluded.thumbnail_url END,
        duration = CASE WHEN videos.status IN ('COMPLETED', 'PROCESSING') THEN videos.duration ELSE excluded.duration END,
        status = CASE WHEN videos.status IN ('COMPLETED', 'PROCESSING') THEN videos.status ELSE 'PROCESSING' END,
        retry_count = CASE WHEN videos.status IN ('COMPLETED', 'PROCESSING') THEN videos.retry_count ELSE 0 END,
        last_attempt_at = CASE WHEN videos.status IN ('COMPLETED', 'PROCESSING') THEN videos.last_attempt_at ELSE NULL END,
        progress_message = CASE WHEN videos.status IN ('COMPLETED', 'PROCESSING') THEN videos.progress_message ELSE 'Queued for processing' END,
        error_message = CASE WHEN videos.status IN ('COMPLETED', 'PROCESSING') THEN videos.error_message ELSE NULL END,
        updated_at = excluded.updated_at`)
      .bind(userId, item.video_id, videoUrl, item.title, item.channel_title, item.channel_url,
        item.thumbnail_url || `https://i.ytimg.com/vi/${item.video_id}/hqdefault.jpg`, item.duration,
        item.tags_json, item.tags_json, timestamp, timestamp),
    db.prepare(`INSERT INTO playlist_cleanup_jobs (user_id, video_id, playlist_id, playlist_item_id, updated_at)
      SELECT ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM videos WHERE user_id = ? AND video_id = ?)
      ON CONFLICT(user_id, playlist_item_id) DO UPDATE SET
        state = CASE WHEN playlist_cleanup_jobs.state = 'CANCELLED' THEN 'PENDING' ELSE playlist_cleanup_jobs.state END`)
      .bind(userId, item.video_id, item.playlist_id, item.playlist_item_id, timestamp, userId, item.video_id),
    db.prepare("UPDATE playlist_import_items SET state = 'COMPLETED', lease_until = 0 WHERE id = ? AND user_id = ?")
      .bind(item.id, userId),
    db.prepare(`UPDATE playlist_imports SET completed_items = (
        SELECT count(*) FROM playlist_import_items WHERE import_id = ? AND state = 'COMPLETED'
      ), state = CASE WHEN discovery_complete = 0 THEN 'DISCOVERING' ELSE
        CASE WHEN (SELECT count(*) FROM playlist_import_items WHERE import_id = ? AND state IN ('PENDING','PROCESSING')) = 0
          THEN CASE WHEN (SELECT count(*) FROM playlist_import_items WHERE import_id = ? AND state = 'FAILED') > 0 THEN 'FAILED' ELSE 'COMPLETED' END
          ELSE 'PENDING' END END, updated_at = ? WHERE id = ? AND user_id = ?`)
      .bind(item.import_id, item.import_id, item.import_id, timestamp, item.import_id, userId),
  ]);
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : "Unknown playlist import failure";
    await db.batch([
      db.prepare(`UPDATE playlist_import_items SET attempts = attempts + 1, error = ?,
        state = CASE WHEN attempts + 1 >= 5 THEN 'FAILED' ELSE 'PENDING' END, lease_until = 0
        WHERE id = ? AND user_id = ?`).bind(message, item.id, userId),
      db.prepare(`UPDATE playlist_imports SET state = CASE WHEN discovery_complete = 0 THEN 'DISCOVERING' ELSE CASE
        WHEN NOT EXISTS (SELECT 1 FROM playlist_import_items WHERE import_id = ? AND state IN ('PENDING','PROCESSING'))
         AND EXISTS (SELECT 1 FROM playlist_import_items WHERE import_id = ? AND state = 'FAILED') THEN 'FAILED'
        ELSE 'PENDING' END END, updated_at = ? WHERE id = ? AND user_id = ?`)
        .bind(item.import_id, item.import_id, timestamp, item.import_id, userId),
    ]);
  }
  return true;
}

export async function processPlaylistImportBatch(userId: string, limit = 10) {
  let processed = 0;
  for (let i = 0; i < Math.max(1, Math.min(25, limit)); i++) {
    if (!await processOnePlaylistImport(userId)) break;
    processed++;
  }
  return processed;
}
