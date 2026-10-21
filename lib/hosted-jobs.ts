import { database, retryVideo } from "./server-api";
import { syncOnePendingSubtitle } from "./drive-service";
import { processOnePlaylistRemoval } from "./youtube-playlists";
import { withinJobDeadline } from "./job-context";

export async function runHostedJobs() {
  const db = database();
  const users = await db.prepare(`WITH pending AS (SELECT user_id FROM videos
    WHERE processing_paused = 0 AND processing_source <> 'LOCAL'
    AND (status = 'PROCESSING' OR (status = 'COMPLETED' AND subtitle_text IS NOT NULL AND drive_file_id IS NULL))
    UNION SELECT user_id FROM playlist_cleanup_jobs WHERE state = 'PENDING')
    SELECT pending.user_id FROM pending LEFT JOIN hosted_job_leases lease ON lease.user_id = pending.user_id
    WHERE coalesce(lease.lease_until, 0) <= ?
    ORDER BY coalesce(lease.last_run, 0), pending.user_id LIMIT 4`).bind(Date.now()).all<{ user_id: string }>();
  for (const { user_id: userId } of users.results ?? []) {
    const owner = crypto.randomUUID();
    const now = Date.now();
    const claim = await db.prepare(`INSERT INTO hosted_job_leases (user_id, owner, lease_until)
      VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET owner = excluded.owner, lease_until = excluded.lease_until
      WHERE hosted_job_leases.lease_until <= ?`).bind(userId, owner, now + 900_000, now).run();
    if (!claim.meta.changes) continue;
    try {
      const due = await db.prepare(`SELECT id FROM videos WHERE user_id = ? AND status = 'PROCESSING'
        AND processing_source <> 'LOCAL' AND processing_paused = 0
        ORDER BY coalesce(last_attempt_at, ''), id LIMIT 1`).bind(userId).first<{ id: number }>();
      await withinJobDeadline(async () => {
        if (due) await retryVideo(due.id, userId);
        await syncOnePendingSubtitle(userId);
        await processOnePlaylistRemoval(userId);
      });
    } catch (error) {
      console.error("Hosted job failed", userId, error instanceof Error ? error.message : "Unknown failure");
    } finally {
      await db.prepare("UPDATE hosted_job_leases SET lease_until = 0, last_run = ? WHERE user_id = ? AND owner = ?").bind(Date.now(), userId, owner).run();
    }
  }
}
