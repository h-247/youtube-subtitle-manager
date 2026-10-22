import { database, json } from "../../../lib/server-api";

declare const __SITE_REVISION__: string;

export async function GET() {
  const scheduler = await database().prepare(`SELECT last_started_at, last_completed_at, last_status
      , last_error
    FROM hosted_scheduler_state WHERE id = 1`).first<{
      last_started_at: string | null;
      last_completed_at: string | null;
      last_status: string;
      last_error: string | null;
    }>();
  const completedAt = scheduler?.last_completed_at ? Date.parse(scheduler.last_completed_at) : NaN;
  const fresh = Number.isFinite(completedAt) && Date.now() - completedAt <= 180_000;
  const healthy = !!scheduler && fresh && scheduler.last_status === "ok";
  const schedulerHealth = scheduler ? {
    ...scheduler,
    age_seconds: Number.isFinite(completedAt) ? Math.max(0, Math.floor((Date.now() - completedAt) / 1000)) : null,
    healthy,
    health_error: !scheduler.last_completed_at ? "No scheduler heartbeat has completed yet."
      : !fresh ? "The scheduler heartbeat is older than three minutes."
      : scheduler.last_status !== "ok" ? scheduler.last_error || `Scheduler status is ${scheduler.last_status}.`
      : null,
  } : { last_started_at: null, last_completed_at: null, last_status: "missing", last_error: null,
    age_seconds: null, healthy: false, health_error: "Scheduler heartbeat is missing." };
  return json({
    status: healthy ? "ok" : "degraded",
    revision: __SITE_REVISION__,
    scheduler: schedulerHealth,
  }, healthy ? 200 : 503);
}
