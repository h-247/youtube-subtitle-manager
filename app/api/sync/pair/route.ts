import { currentSiteUser, database, errorResponse, json } from "../../../../lib/server-api";

async function hashToken(token: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function GET() {
  const user = await currentSiteUser();
  if (!user) return errorResponse("Sign in with ChatGPT to access your library.", 401);
  const row = await database().prepare("SELECT 1 AS connected FROM local_sync_tokens WHERE user_id = ? AND revoked_at IS NULL LIMIT 1")
    .bind(user.userId).first<{ connected: number }>();
  return json({ is_connected: Boolean(row) });
}

export async function POST() {
  const user = await currentSiteUser();
  if (!user) return errorResponse("Sign in with ChatGPT to access your library.", 401);
  const tokenBytes = crypto.getRandomValues(new Uint8Array(32));
  const token = btoa(String.fromCharCode(...tokenBytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  const db = database();
  await db.prepare("UPDATE local_sync_tokens SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL")
    .bind(new Date().toISOString(), user.userId).run();
  await db.prepare("INSERT INTO local_sync_tokens (token_hash, user_id, user_email, created_at) VALUES (?, ?, ?, ?)")
    .bind(await hashToken(token), user.userId, user.email, new Date().toISOString()).run();
  return json({ token });
}

export async function DELETE() {
  const user = await currentSiteUser();
  if (!user) return errorResponse("Sign in with ChatGPT to access your library.", 401);
  await database().prepare("UPDATE local_sync_tokens SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL")
    .bind(new Date().toISOString(), user.userId).run();
  return json({ is_connected: false });
}
