import {currentSiteUser,database,errorResponse,json} from "../../../../lib/server-api";
export async function disconnectForUser(userId:string) {await database().prepare("DELETE FROM youtube_connections WHERE user_id = ?").bind(userId).run(); return json({is_connected:false});}
export async function POST() {const user=await currentSiteUser(); if(!user)return errorResponse("Sign in with ChatGPT.",401); return disconnectForUser(user.userId);}
