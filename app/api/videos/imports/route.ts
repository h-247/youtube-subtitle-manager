import { currentSiteUser, database, errorResponse, json } from "../../../../lib/server-api";

const IMPORTS = `SELECT i.id, i.playlist_id, i.title, i.total_items, i.completed_items, i.state,
  i.created_at, i.updated_at, i.discovery_error,
  sum(CASE WHEN item.state IN ('PENDING','PROCESSING') THEN 1 ELSE 0 END) AS queued_items,
  sum(CASE WHEN item.state = 'FAILED' THEN 1 ELSE 0 END) AS failed_items
  FROM playlist_imports i LEFT JOIN playlist_import_items item ON item.import_id = i.id
  WHERE i.user_id = ?`;

export async function GET(request: Request) {
  const user = await currentSiteUser();
  if (!user) return errorResponse("Sign in with ChatGPT to access playlist imports.", 401);
  const importId = new URL(request.url).searchParams.get("import_id");
  const imports = await database().prepare(`${IMPORTS} ${importId ? "AND i.id = ?" : ""}
    GROUP BY i.id ORDER BY i.created_at DESC LIMIT 20`)
    .bind(...(importId ? [user.userId, importId] : [user.userId])).all<Record<string, unknown>>();
  const results = await Promise.all((imports.results ?? []).map(async row => {
    const failures = await database().prepare(`SELECT video_id, title, error FROM playlist_import_items
      WHERE import_id = ? AND user_id = ? AND state = 'FAILED' AND error IS NOT NULL ORDER BY id LIMIT 20`)
      .bind(row.id, user.userId).all<{ video_id: string; title: string; error: string }>();
    return { ...row, queued_items: Number(row.queued_items ?? 0), completed_items: Number(row.completed_items ?? 0),
      failed_items: Number(row.failed_items ?? 0), failures: failures.results ?? [] };
  }));
  return json({ imports: results });
}

export async function POST(request: Request) {
  const user = await currentSiteUser();
  if (!user) return errorResponse("Sign in with ChatGPT to manage playlist imports.", 401);
  const body = await request.json().catch(() => ({})) as { import_id?: unknown };
  if (typeof body.import_id !== "string" || !body.import_id) return errorResponse("A playlist import ID is required.");
  const db = database();
  const now = new Date().toISOString();
  const exists = await db.prepare("SELECT id FROM playlist_imports WHERE id = ? AND user_id = ?")
    .bind(body.import_id, user.userId).first<{ id: string }>();
  if (!exists) return errorResponse("Playlist import was not found.", 404);
  await db.batch([
    db.prepare(`UPDATE playlist_import_items SET state = 'PENDING', lease_until = 0, attempts = 0
      WHERE import_id = ? AND user_id = ? AND state = 'FAILED'`).bind(body.import_id, user.userId),
    db.prepare(`UPDATE playlist_imports SET state = CASE WHEN discovery_complete = 0 THEN 'DISCOVERING' ELSE 'PENDING' END, updated_at = ?
      WHERE id = ? AND user_id = ?`).bind(now, body.import_id, user.userId),
  ]);
  return json({ import_id: body.import_id, retried: true }, 202);
}
