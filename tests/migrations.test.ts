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
    for (const file of files.filter(n => n >= "0007")) db.exec(readFileSync(`drizzle/${file}`, "utf8"));
    expect(db.prepare("SELECT chatgpt_prompt_link FROM user_preferences WHERE user_id = ?").get("existing-owner"))
      .toEqual({chatgpt_prompt_link: "https://chatgpt.com/c/retained"});
    db.exec("UPDATE user_preferences SET chatgpt_prompt_link = NULL");
    db.exec(readFileSync("drizzle/0010_preserve_hosted_preferences.sql", "utf8"));
    expect(db.prepare("SELECT chatgpt_prompt_link FROM user_preferences").get()?.chatgpt_prompt_link).toBeNull();
  } finally { db.close(); }
});
