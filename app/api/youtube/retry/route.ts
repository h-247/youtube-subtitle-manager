import {currentSiteUser, database, errorResponse, json} from "../../../../lib/server-api";
export async function retryForUser(userId: string) {
 await database().prepare("UPDATE playlist_cleanup_jobs SET state = 'PENDING', error = NULL, next_attempt = 0, lease_until = 0 WHERE user_id = ? AND state IN ('PENDING','FAILED') AND lease_until <= ?").bind(userId,Date.now()).run();
 return json({retrying:true});
}
export async function POST() {const user=await currentSiteUser(); if(!user)return errorResponse("Sign in with ChatGPT.",401); return retryForUser(user.userId);}
