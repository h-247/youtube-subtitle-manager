import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { expect, test } from "vitest";

test("upgrades the older hosted schema without losing shared prompt preferences", () => {
  const db = new DatabaseSync(":memory:");
  try {
    const files = readdirSync("drizzle").filter(n => n.endsWith(".sql")).sort();
    for (const file of files.filter(n => n < "0007")) db.exec(readFileSync(`drizzle/${file}`, "utf8"));
    db.exec(`ALTER TABLE videos ADD COLUMN chatgpt_prompt_link TEXT;
      CREATE TABLE user_prompt_settings(user_id TEXT PRIMARY KEY, chatgpt_prompt_link TEXT, updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
      INSERT INTO user_prompt_settings(user_id, chatgpt_prompt_link) VALUES ('existing-owner', 'https://chatgpt.com/c/retained');`);
    for (const file of files.filter(n => n >= "0007" && n < "0011")) db.exec(readFileSync(`drizzle/${file}`, "utf8"));
    db.exec(`CREATE TABLE playlist_imports (
        id TEXT PRIMARY KEY NOT NULL, user_id TEXT NOT NULL, playlist_id TEXT NOT NULL,
        title TEXT NOT NULL, total_items INTEGER NOT NULL, completed_items INTEGER NOT NULL DEFAULT 0,
        state TEXT NOT NULL DEFAULT 'PENDING', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      INSERT INTO playlist_imports (id, user_id, playlist_id, title, total_items, created_at, updated_at)
        VALUES ('kept-import', 'existing-owner', 'PL1', 'Existing', 1, '2026-01-01', '2026-01-01');
      CREATE TABLE playlist_import_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, import_id TEXT NOT NULL, user_id TEXT NOT NULL,
        video_id TEXT NOT NULL, title TEXT NOT NULL, channel_title TEXT, channel_url TEXT,
        thumbnail_url TEXT, duration INTEGER, playlist_id TEXT NOT NULL, playlist_item_id TEXT NOT NULL,
        tags_json TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'PENDING', lease_until INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );
      CREATE TABLE hosted_scheduler_state (
        id INTEGER PRIMARY KEY NOT NULL CHECK (id = 1), last_started_at TEXT, last_completed_at TEXT,
        last_status TEXT NOT NULL DEFAULT 'never_run', last_error TEXT
      );
      INSERT INTO hosted_scheduler_state (id, last_status) VALUES (1, 'ok');`);
    db.exec(readFileSync("drizzle/0011_durable_imports_and_scheduler_health.sql", "utf8"));
    expect(db.prepare("SELECT chatgpt_prompt_link FROM user_preferences WHERE user_id = ?").get("existing-owner"))
      .toEqual({chatgpt_prompt_link: "https://chatgpt.com/c/retained"});
    db.exec("UPDATE user_preferences SET chatgpt_prompt_link = NULL");
    db.exec(readFileSync("drizzle/0010_preserve_hosted_preferences.sql", "utf8"));
    expect(db.prepare("SELECT chatgpt_prompt_link FROM user_preferences").get()?.chatgpt_prompt_link).toBeNull();
    expect(db.prepare("SELECT id, tags_json, discovery_next_attempt FROM playlist_imports WHERE id = ?").get("kept-import"))
      .toEqual({id: "kept-import", tags_json: "[]", discovery_next_attempt: 0});
    expect(db.prepare("SELECT attempts, error FROM playlist_import_items").all()).toEqual([]);
    expect(db.prepare("SELECT id, last_status FROM hosted_scheduler_state").all())
      .toEqual([{id: 1, last_status: "ok"}]);
  } finally { db.close(); }
});
