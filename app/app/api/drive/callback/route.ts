import {storeYouTubeCode} from "../../../../../lib/youtube-playlists";
import { database, errorResponse } from "../../../../../lib/server-api";
import { driveRedirectUri, storeAuthorizationCode } from "../../../../../lib/drive-service";

function redirectDashboard(request: Request, params: Record<string, string>) {
  const url = new URL("/dashboard", new URL(request.url).origin);
  url.search = new URLSearchParams(params).toString();
  return Response.redirect(url, 303);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const providerError = url.searchParams.get("error");
  if (!state || !/^[a-f0-9]{64}$/.test(state)) return redirectDashboard(request, { drive_error: "Google Drive authorization could not be verified. Please try again." });

  const youtubePending = await database().prepare("DELETE FROM youtube_oauth_states WHERE state = ? AND expires_at > ? RETURNING user_id").bind(state, Math.floor(Date.now()/1000)).first<{user_id:string}>();
  if (youtubePending) {
    const destination = new URL("/dashboard/videos", request.url);
    if (providerError || !code) destination.searchParams.set("youtube_error", "YouTube authorization was cancelled or denied.");
    else {
      try {await storeYouTubeCode(youtubePending.user_id,code,driveRedirectUri(request.url)); destination.searchParams.set("youtube_connected","true");}
      catch {destination.searchParams.set("youtube_error","YouTube could not be connected. Enable YouTube Data API v3 and allow playlist management, then retry.");}
    }
    return Response.redirect(destination,303);
  }
  const pending = await database().prepare("DELETE FROM drive_oauth_states WHERE state = ? AND expires_at > ? RETURNING user_id")
    .bind(state, Math.floor(Date.now() / 1000)).first<{ user_id: string }>();
  if (!pending) return redirectDashboard(request, { drive_error: "Google Drive authorization expired. Please connect again." });
  if (providerError) return redirectDashboard(request, { drive_error: "Google Drive authorization was cancelled or denied." });
  if (!code) return redirectDashboard(request, { drive_error: "Google did not return an authorization code. Please connect again." });

  try {
    await storeAuthorizationCode(pending.user_id, code, driveRedirectUri(request.url));
    return redirectDashboard(request, { drive_connected: "true" });
  } catch {
    return redirectDashboard(request, { drive_error: "Google Drive could not be connected. Check OAuth setup and try again." });
  }
}
