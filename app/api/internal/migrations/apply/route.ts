import { env } from "cloudflare:workers";
import { database } from "../../../../../lib/server-api";

const baseTables = [
  `CREATE TABLE IF NOT EXISTS playlist_imports (
    id TEXT PRIMARY KEY NOT NULL, user_id TEXT NOT NULL, playlist_id TEXT NOT NULL, title TEXT NOT NULL,
    total_items INTEGER NOT NULL, completed_items INTEGER NOT NULL DEFAULT 0,
    state TEXT NOT NULL DEFAULT 'PENDING', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS playlist_import_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, import_id TEXT NOT NULL, user_id TEXT NOT NULL,
    video_id TEXT NOT NULL, title TEXT NOT NULL, channel_title TEXT, channel_url TEXT,
    thumbnail_url TEXT, duration INTEGER, playlist_id TEXT NOT NULL, playlist_item_id TEXT NOT NULL,
    tags_json TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'PENDING', lease_until INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS hosted_scheduler_state (
    id INTEGER PRIMARY KEY NOT NULL CHECK (id = 1), last_started_at TEXT, last_completed_at TEXT,
    last_status TEXT NOT NULL DEFAULT 'never_run', last_error TEXT
  )`,
] as const;

const addedColumns = {
  playlist_imports: [
    ["tags_json", "tags_json TEXT NOT NULL DEFAULT '[]'"],
    ["next_page_token", "next_page_token TEXT"],
    ["discovery_complete", "discovery_complete INTEGER NOT NULL DEFAULT 0"],
    ["discovery_attempts", "discovery_attempts INTEGER NOT NULL DEFAULT 0"],
    ["discovery_next_attempt", "discovery_next_attempt INTEGER NOT NULL DEFAULT 0"],
    ["discovery_lease_until", "discovery_lease_until INTEGER NOT NULL DEFAULT 0"],
    ["discovery_error", "discovery_error TEXT"],
  ],
  playlist_import_items: [
    ["attempts", "attempts INTEGER NOT NULL DEFAULT 0"],
    ["error", "error TEXT"],
  ],
} as const;

export async function POST(request: Request) {
  if (!env.HOSTED_JOBS_TOKEN || request.headers.get("authorization") !== `Bearer ${env.HOSTED_JOBS_TOKEN}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = database();
  for (const sql of baseTables) await db.prepare(sql).run();

  const columnsAdded: string[] = [];
  for (const [table, columns] of Object.entries(addedColumns)) {
    const info = await db.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>();
    const present = new Set((info.results ?? []).map((column) => column.name));
    for (const [name, definition] of columns) {
      if (present.has(name)) continue;
      await db.prepare(`ALTER TABLE ${table} ADD COLUMN ${definition}`).run();
      columnsAdded.push(`${table}.${name}`);
    }
  }

  await db.prepare("CREATE INDEX IF NOT EXISTS ix_playlist_imports_user_state ON playlist_imports (user_id, state)").run();
  await db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS uq_playlist_import_item ON playlist_import_items (import_id, video_id, playlist_item_id)").run();
  await db.prepare("CREATE INDEX IF NOT EXISTS ix_playlist_import_items_due ON playlist_import_items (user_id, state, lease_until, id)").run();
  await db.prepare("INSERT OR IGNORE INTO hosted_scheduler_state (id) VALUES (1)").run();

  return Response.json({ complete: true, columns_added: columnsAdded });
}
