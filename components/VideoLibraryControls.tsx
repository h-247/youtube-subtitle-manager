"use client";

import { FormEvent, useState } from "react";
import { ExternalLink, HardDrive, Loader2, MessageSquare, Pencil, Save } from "lucide-react";
import { api } from "../lib/api";
import { Video, WatchStatus } from "../types";

export default function VideoLibraryControls({ video, onUpdated }: { video: Video; onUpdated: (video: Video) => void }) {
  const [editing, setEditing] = useState(false);
  const [link, setLink] = useState(video.chatgpt_link || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const update = async (data: { watch_status?: WatchStatus; chatgpt_link?: string | null }) => {
    setSaving(true); setError("");
    try { onUpdated(await api.videos.update(video.id, data)); return true; }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save changes."); return false; }
    finally { setSaving(false); }
  };
  const saveLink = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = link.trim();
    if (value) {
      try { const url = new URL(value); if (!["https:", "http:"].includes(url.protocol)) throw new Error(); }
      catch { setError("Enter a valid http or https link."); return; }
    }
    if (await update({ chatgpt_link: value || null })) setEditing(false);
  };
  const controlClass = "inline-flex items-center gap-1.5 rounded-lg border border-neutral-700 bg-neutral-800 px-2 py-1.5 text-[11px] text-neutral-200 hover:bg-neutral-700 disabled:opacity-50";
  return <div className="mt-3 border-t border-neutral-800 pt-3">
    <div className="flex flex-wrap items-center gap-2">
      <label className="flex items-center gap-1.5 text-[11px] text-neutral-400">Watch status
        <select aria-label={`Watch status for ${video.title}`} value={video.watch_status} disabled={saving} onChange={(event) => void update({ watch_status: event.target.value as WatchStatus })} className="rounded-lg border border-neutral-700 bg-neutral-800 px-1.5 py-1.5 text-[11px] text-neutral-200 disabled:opacity-50">
          <option value="TO_DO">To do</option><option value="DOING">Watching</option><option value="DONE">Watched</option>
        </select>
      </label>
      {saving && <Loader2 aria-label="Saving changes" className="h-4 w-4 animate-spin text-neutral-400" />}
      {video.chatgpt_link && <a href={video.chatgpt_link} target="_blank" rel="noreferrer" className={controlClass}><MessageSquare className="h-3.5 w-3.5" /> ChatGPT <ExternalLink className="h-3 w-3" /></a>}
      <button disabled={saving} onClick={() => { setLink(video.chatgpt_link || ""); setError(""); setEditing(!editing); }} className={controlClass}><Pencil className="h-3.5 w-3.5" /> {video.chatgpt_link ? "Edit ChatGPT Link" : "Add ChatGPT Link"}</button>
      {video.drive_file_url ? <a href={video.drive_file_url} target="_blank" rel="noreferrer" className={controlClass}><HardDrive className="h-3.5 w-3.5" /> Google Drive <ExternalLink className="h-3 w-3" /></a> : <span className="text-xs text-neutral-500">No Google Drive link yet</span>}
    </div>
    {editing && <form onSubmit={saveLink} className="mt-3 flex flex-wrap gap-2">
      <input aria-label={`ChatGPT link for ${video.title}`} type="url" value={link} disabled={saving} onChange={(event) => setLink(event.target.value)} placeholder="https://chatgpt.com/c/..." className="min-w-0 flex-1 rounded-lg border border-neutral-700 bg-[#151515] px-2 py-1.5 text-[11px] text-neutral-100 outline-none focus:border-neutral-400" />
      <button disabled={saving} className={controlClass}><Save className="h-3.5 w-3.5" /> {saving ? "Saving…" : "Save Link"}</button>
      <button type="button" disabled={saving} onClick={() => setEditing(false)} className={controlClass}>Cancel</button>
      <p className="w-full text-xs text-neutral-500">Clear the field and save to remove the link.</p>
    </form>}
    {error && <p role="alert" className="mt-2 text-xs text-rose-300">{error}</p>}
  </div>;
}
