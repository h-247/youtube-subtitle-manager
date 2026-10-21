import {currentSiteUser, errorResponse, json} from "../../../../lib/server-api";
import {youtubeStatus} from "../../../../lib/youtube-playlists";
export async function GET(request: Request) {
 const user = await currentSiteUser(); if (!user) return errorResponse("Sign in with ChatGPT.", 401);
 return json({...await youtubeStatus(user.userId), connect_url: new URL("/api/youtube/connect", request.url).toString()});
}
