import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";

const run = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
const revision = run("rev-parse", "HEAD");
const dirty = run("status", "--porcelain");
if (dirty) throw new Error("Refusing to package a dirty checkout; build and package a clean tested commit.");
if (process.env.GITHUB_SHA && process.env.GITHUB_SHA !== revision) {
  throw new Error(`Checkout ${revision} does not match tested GitHub commit ${process.env.GITHUB_SHA}.`);
}
await mkdir("dist", { recursive: true });
await writeFile("dist/release-manifest.json", `${JSON.stringify({
  revision,
  tree: run("rev-parse", "HEAD^{tree}"),
  artifact: "dist/server/index.js",
  created_at: new Date().toISOString(),
}, null, 2)}\n`);
console.log(`Prepared release artifact for ${revision}`);
