import { database } from "./server-api";

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
      ), state = CASE WHEN (SELECT count(*) FROM playlist_import_items WHERE import_id = ? AND state <> 'COMPLETED') = 0
        THEN 'COMPLETED' ELSE 'PENDING' END, updated_at = ? WHERE id = ? AND user_id = ?`)
      .bind(item.import_id, item.import_id, timestamp, item.import_id, userId),
  ]);
  return true;
}
