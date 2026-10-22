import { Miniflare } from "miniflare";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const runtime = new Miniflare({
  modules: readdirSync("dist/server", { recursive: true }).filter(name => /\.(?:m?js)$/.test(name))
    .map(name => ({ type: "ESModule", path: path.resolve("dist/server", name) })),
  modulesRoot: path.resolve("dist/server"),
  compatibilityDate: "2026-05-15",
  compatibilityFlags: ["nodejs_compat"],
  d1Databases: ["DB"],
});
try {
  const db = await runtime.getD1Database("DB");
  for (const file of readdirSync("drizzle").filter(name => name.endsWith(".sql")).sort()) {
    for (const statement of readFileSync(path.join("drizzle", file), "utf8").split(";").filter(sql => sql.trim())) {
      await db.prepare(statement).run();
    }
  }
  const worker = await runtime.getWorker();
  const result = await worker.scheduled({ cron: "* * * * *" });
  if (result.outcome !== "ok") throw new Error(`Scheduled handler failed: ${result.outcome}`);
  console.log("Built Worker scheduled handler: passed with fresh D1 migrations");
} finally {
  await runtime.dispose();
}
