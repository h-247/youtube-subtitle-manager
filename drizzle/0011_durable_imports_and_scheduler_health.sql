CREATE TABLE playlist_imports (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  playlist_id TEXT NOT NULL,
  title TEXT NOT NULL,
  total_items INTEGER NOT NULL,
  completed_items INTEGER NOT NULL DEFAULT 0,
  state TEXT NOT NULL DEFAULT 'PENDING',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE INDEX ix_playlist_imports_user_state ON playlist_imports (user_id, state);
--> statement-breakpoint
CREATE TABLE playlist_import_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  import_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  video_id TEXT NOT NULL,
  title TEXT NOT NULL,
  channel_title TEXT,
  channel_url TEXT,
  thumbnail_url TEXT,
  duration INTEGER,
  playlist_id TEXT NOT NULL,
  playlist_item_id TEXT NOT NULL,
  tags_json TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'PENDING',
  lease_until INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX uq_playlist_import_item ON playlist_import_items (import_id, video_id, playlist_item_id);
--> statement-breakpoint
CREATE INDEX ix_playlist_import_items_due ON playlist_import_items (user_id, state, lease_until, id);
--> statement-breakpoint
CREATE TABLE hosted_scheduler_state (
  id INTEGER PRIMARY KEY NOT NULL CHECK (id = 1),
  last_started_at TEXT,
  last_completed_at TEXT,
  last_status TEXT NOT NULL DEFAULT 'never_run',
  last_error TEXT
);
--> statement-breakpoint
INSERT INTO hosted_scheduler_state (id) VALUES (1);
