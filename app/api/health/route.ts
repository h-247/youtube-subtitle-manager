import { database, json } from "../../../lib/server-api";

declare const __SITE_REVISION__: string;

export async function GET() {
  const scheduler = await database().prepare(`SELECT last_started_at, last_completed_at, last_status
    FROM hosted_scheduler_state WHERE id = 1`).first<{
      last_started_at: string | null;
      last_completed_at: string | null;
      last_status: string;
    }>();
  return json({
    status: "ok",
    revision: __SITE_REVISION__,
    scheduler: scheduler ?? { last_started_at: null, last_completed_at: null, last_status: "missing" },
  });
}
