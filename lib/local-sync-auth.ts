import { database } from "./server-api";

export async function authenticatedLocalUser(request: Request): Promise<string | null> {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  const hash = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  const row = await database().prepare("SELECT user_id FROM local_sync_tokens WHERE token_hash = ? AND revoked_at IS NULL")
    .bind(hash).first<{ user_id: string }>();
  return row?.user_id ?? null;
}
