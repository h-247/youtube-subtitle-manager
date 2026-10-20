"use client";
import {useCallback, useEffect, useState} from "react";
import {api} from "../lib/api";
import {YouTubeStatus} from "../types";
export default function YouTubePlaylistConnection({onReady}: {onReady: (ready:boolean)=>void}) {
 const [status,setStatus]=useState<YouTubeStatus|null>(null); const [error,setError]=useState(""); const [busy,setBusy]=useState(false);
 const refresh=useCallback(async()=>{try {const state=await api.youtube.getStatus();setStatus(state);onReady(state.is_connected);setError("");}catch(reason){onReady(false);setError(reason instanceof Error?reason.message:"Could not check YouTube connection.");}},[onReady]);
 useEffect(()=>{let active=true; const update=()=>{if(active)void refresh();};update();const timer=window.setInterval(update,10000);window.addEventListener("focus",update);return()=>{active=false;window.clearInterval(timer);window.removeEventListener("focus",update);};},[refresh]);
 const retry=async()=>{setBusy(true);try{await api.youtube.retry();await refresh();}catch(reason){setError(reason instanceof Error?reason.message:"Could not retry removals.");}finally{setBusy(false);}};
 const disconnect=async()=>{setBusy(true);try{await api.youtube.disconnect();await refresh();}catch(reason){setError(reason instanceof Error?reason.message:"Could not disconnect YouTube.");}finally{setBusy(false);}};
 return <section aria-label="Source playlist removal" className="space-y-2 rounded-lg border border-neutral-700 bg-neutral-800 p-3 text-sm">
  <p>Imported entries are removed from the original YouTube playlist after their subtitles are saved successfully.</p>
  <p className="text-xs text-neutral-400">Connect the YouTube account that owns the playlist. Google Drive access does not include playlist permissions.</p>
  {!status&&!error&&<p role="status">Checking YouTube connection…</p>}
  {status&&<><p role="status">{status.is_connected?"YouTube connected":"YouTube connection required"}</p><a href={status.connect_url} target="_blank" rel="noreferrer" className="inline-block rounded-lg bg-white px-3 py-2 text-xs font-medium text-black">{status.is_connected?"Reconnect YouTube":"Connect YouTube"}</a>{status.is_connected&&<button type="button" disabled={busy} onClick={()=>void disconnect()} className="ml-3 text-xs underline">Disconnect YouTube</button>}
   {status.connection_error&&<p className="text-xs text-amber-300">{status.connection_error}</p>}
   <p className="text-xs text-neutral-400">{status.pending_count} pending · {status.removed_count} removed · {status.failed_count} failed</p>
   {status.jobs.filter(job=>job.error).slice(0,3).map(job=><p key={job.playlist_id+job.video_id+job.error} className="text-xs text-amber-300">{job.video_id}: {job.error}</p>)}
   {(status.pending_count>0||status.failed_count>0)&&<button type="button" disabled={busy} onClick={()=>void retry()} className="text-xs underline">Retry playlist removals</button>}
   {!status.is_configured&&<p className="text-xs text-amber-300">Google OAuth must be configured on Sites.</p>}
  </>}
  {error&&<p role="alert" className="text-xs text-rose-300">{error}</p>}
 </section>;
}
