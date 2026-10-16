import { database } from "./server-api";

export type LocalSiteIdentity = { userId: string; email: string | null };

export async function authenticatedLocalIdentity(request: Request): Promise<LocalSiteIdentity | null> {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  const hash = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  const row = await database().prepare("SELECT user_id, user_email FROM local_sync_tokens WHERE token_hash = ? AND revoked_at IS NULL")
    .bind(hash).first<{ user_id: string; user_email: string | null }>();
  return row ? { userId: row.user_id, email: row.user_email } : null;
}

export async function authenticatedLocalUser(request: Request): Promise<string | null> {
  return (await authenticatedLocalIdentity(request))?.userId ?? null;
}
