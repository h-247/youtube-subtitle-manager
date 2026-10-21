import {env} from "cloudflare:workers";
import {currentSiteUser, database, errorResponse} from "../../../../lib/server-api";
import {YOUTUBE_SCOPE, youtubeConfigured} from "../../../../lib/youtube-playlists";
import {driveRedirectUri} from "../../../../lib/drive-service";
export async function GET(request: Request) {
 const user = await currentSiteUser(); if (!user) return Response.redirect(new URL("/signin-with-chatgpt?return_to=%2Fapi%2Fyoutube%2Fconnect",request.url),303);
 if (!youtubeConfigured()) return errorResponse("Google OAuth is not configured for this Site.",503);
 const state = Array.from(crypto.getRandomValues(new Uint8Array(32)), byte=>byte.toString(16).padStart(2,"0")).join("");
 const db = database(); await db.batch([
  db.prepare("DELETE FROM youtube_oauth_states WHERE expires_at < ?").bind(Math.floor(Date.now()/1000)),
  db.prepare("INSERT INTO youtube_oauth_states (state,user_id,expires_at) VALUES (?,?,?)").bind(state,user.userId,Math.floor(Date.now()/1000)+600),
 ]);
 const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
 url.search = new URLSearchParams({client_id:env.GOOGLE_CLIENT_ID!,redirect_uri:driveRedirectUri(request.url),response_type:"code",scope:YOUTUBE_SCOPE,access_type:"offline",prompt:"consent",state}).toString();
 return Response.redirect(url,303);
}
