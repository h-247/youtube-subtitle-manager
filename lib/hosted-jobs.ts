import { database, retryVideo } from "./server-api";
import { syncOnePendingSubtitle } from "./drive-service";
import { processOnePlaylistRemoval } from "./youtube-playlists";
import { processOnePlaylistDiscovery, processPlaylistImportBatch } from "./playlist-imports";
import { withinJobDeadline } from "./job-context";

const dueVideo = `v.status = 'PROCESSING' AND v.processing_source <> 'LOCAL' AND v.processing_paused = 0
  AND (v.last_attempt_at IS NULL OR datetime(v.last_attempt_at, printf('+%d seconds',
    CASE WHEN lower(coalesce(v.error_message, '')) LIKE '%verification%' OR lower(coalesce(v.error_message, '')) LIKE '%bot%'
      THEN 900 WHEN v.retry_count <= 1 THEN 2 ELSE min(60, 2 * (1 << min(v.retry_count - 1, 5))) END)) <= datetime(?, 'unixepoch'))`;

const dueDriveVideo = `v.status = 'COMPLETED' AND v.processing_paused = 0 AND v.drive_file_id IS NULL
  AND v.subtitle_text IS NOT NULL AND EXISTS (SELECT 1 FROM drive_connections dc WHERE dc.user_id = v.user_id)
  AND (v.drive_last_attempt_at IS NULL OR datetime(v.drive_last_attempt_at, printf('+%d seconds',
    CASE WHEN v.drive_retry_count <= 1 THEN 2 ELSE min(60, 2 * (1 << min(v.drive_retry_count - 1, 5))) END)) <= datetime(?, 'unixepoch'))`;

const dueCleanup = `EXISTS (SELECT 1 FROM playlist_cleanup_jobs j JOIN videos v
    ON v.user_id = j.user_id AND v.video_id = j.video_id
    JOIN youtube_connections yc ON yc.user_id = j.user_id
    WHERE j.user_id = pending.user_id AND j.state = 'PENDING' AND j.next_attempt <= ? AND j.lease_until <= ?
      AND v.status = 'COMPLETED' AND v.processing_paused = 0
      AND v.subtitle_text IS NOT NULL AND length(trim(v.subtitle_text)) > 0)`;

export async function runHostedJobs() {
  const db = database();
  const startedAt = new Date().toISOString();
  await db.prepare("UPDATE hosted_scheduler_state SET last_started_at = ?, last_status = 'running', last_error = NULL WHERE id = 1")
    .bind(startedAt).run();
  try {
    const failures: string[] = [];
    const now = Date.now();
    const nowSeconds = Math.floor(now / 1000);
    const users = await db.prepare(`WITH pending AS (
        SELECT user_id FROM playlist_import_items WHERE state = 'PENDING' OR (state = 'PROCESSING' AND lease_until <= ?)
        UNION SELECT user_id FROM playlist_imports WHERE state = 'DISCOVERING' AND discovery_next_attempt <= ? AND discovery_lease_until <= ?
        UNION SELECT v.user_id FROM videos v WHERE ${dueVideo}
        UNION SELECT v.user_id FROM videos v JOIN drive_connections dc ON dc.user_id = v.user_id WHERE ${dueDriveVideo}
        UNION SELECT pending.user_id FROM (
          SELECT user_id FROM playlist_cleanup_jobs WHERE state = 'PENDING'
        ) pending WHERE ${dueCleanup}
      )
      SELECT pending.user_id FROM pending LEFT JOIN hosted_job_leases lease ON lease.user_id = pending.user_id
      WHERE coalesce(lease.lease_until, 0) <= ?
      ORDER BY coalesce(lease.last_run, 0), pending.user_id LIMIT 4`)
      .bind(now, now, now, nowSeconds, nowSeconds, now, now, now).all<{ user_id: string }>();
    for (const { user_id: userId } of users.results ?? []) {
      const owner = crypto.randomUUID();
      const claimAt = Date.now();
      const claim = await db.prepare(`INSERT INTO hosted_job_leases (user_id, owner, lease_until)
        VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET owner = excluded.owner, lease_until = excluded.lease_until
        WHERE hosted_job_leases.lease_until <= ?`).bind(userId, owner, claimAt + 900_000, claimAt).run();
      if (!claim.meta.changes) continue;
      try {
        const due = await db.prepare(`SELECT id FROM videos v WHERE v.user_id = ? AND ${dueVideo}
          ORDER BY coalesce(v.last_attempt_at, ''), v.id LIMIT 1`)
          .bind(userId, Math.floor(Date.now() / 1000)).first<{ id: number }>();
        await withinJobDeadline(async () => {
          await processOnePlaylistDiscovery(userId);
          await processPlaylistImportBatch(userId, 10);
          if (due) await retryVideo(due.id, userId);
          await syncOnePendingSubtitle(userId);
          await processOnePlaylistRemoval(userId);
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown failure";
        failures.push(`${userId}: ${message.slice(0, 300)}`);
        console.error("Hosted job failed", userId, message);
      } finally {
        await db.prepare("UPDATE hosted_job_leases SET lease_until = 0, last_run = ? WHERE user_id = ? AND owner = ?")
          .bind(Date.now(), userId, owner).run();
      }
    }
    const completedAt = new Date().toISOString();
    await db.prepare(`UPDATE hosted_scheduler_state SET last_completed_at = ?, last_status = ?, last_error = ? WHERE id = 1`)
      .bind(completedAt, failures.length ? "partial_failure" : "ok", failures.length ? failures.join(" | ").slice(0, 1000) : null).run();
  } catch (error) {
    const failedAt = new Date().toISOString();
    await db.prepare("UPDATE hosted_scheduler_state SET last_completed_at = ?, last_status = 'error', last_error = ? WHERE id = 1")
      .bind(failedAt, error instanceof Error ? error.message.slice(0, 500) : "Unknown scheduler error").run();
    throw error;
  }
}
