"use client";
import { FormEvent, useEffect, useState } from "react";
import { Video, WatchStatus, VideoStatus, videoTags } from "../types";
import { api } from "../lib/api";
export default function EditModal({video, isOpen, onClose, onUpdated, allTags = []}: {
  video: Video | null; isOpen: boolean; onClose: () => void; onUpdated: (video: Video) => void; allTags?: string[];
}) {
  const [watch, setWatch] = useState<WatchStatus>("TO_DO"); const [status, setStatus] = useState<VideoStatus>("COMPLETED");
  const [tags, setTags] = useState<string[]>([]); const [draft, setDraft] = useState(""); const [link, setLink] = useState("");
  const [paused, setPaused] = useState(false); const [saving, setSaving] = useState(false); const [error, setError] = useState("");
  useEffect(() => { if (video) { setWatch(video.watch_status); setStatus(video.status); setTags(videoTags(video)); setLink(video.chatgpt_link || ""); setPaused(!!video.processing_paused); setDraft(""); setError(""); } }, [video]);
  if (!isOpen || !video) return null;
  const addTag = () => { if (draft.trim()) setTags(current => [...new Set([...current, draft.trim().replace(/^#/, "")])]); setDraft(""); };
  const save = async (event: FormEvent) => { event.preventDefault(); setSaving(true); setError(""); try { const updated = await api.videos.update(video.id, {watch_status: watch, status, tags: [...new Set([...tags, ...(draft.trim() ? [draft.trim()] : [])])], chatgpt_link: link.trim(), processing_paused: paused}); onUpdated(updated); onClose(); } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save video."); } finally { setSaving(false); } };
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"><section role="dialog" aria-modal="true" aria-label="Edit video" className="max-h-[90vh] overflow-y-auto w-full max-w-lg rounded-2xl border border-neutral-700 bg-[#262626] p-6 text-neutral-100"><h2 className="text-lg font-bold">Edit Video Record</h2><p className="mb-4 text-xs text-neutral-400">{video.title}</p><form onSubmit={save} className="space-y-4">
    <label className="flex gap-2 text-sm"><input type="checkbox" checked={paused} onChange={e => setPaused(e.target.checked)} />Pause automatic retries</label>
    <label className="block text-sm">Watch status<select aria-label="Watch status" value={watch} onChange={e => setWatch(e.target.value as WatchStatus)} className="mt-1 w-full rounded-lg bg-neutral-800 p-2">{["TO_DO", "DOING", "DONE"].map(s => <option key={s}>{s}</option>)}</select></label>
    <fieldset><legend className="text-sm">Video tags</legend><div className="my-2 flex flex-wrap gap-2">{[...new Set([...allTags, ...tags])].map(tag => <button type="button" key={tag} aria-pressed={tags.includes(tag)} onClick={() => setTags(current => current.includes(tag) ? current.filter(t => t !== tag) : [...current, tag])} className={`rounded-full border px-3 py-1 text-xs ${tags.includes(tag) ? 'bg-white text-black' : 'border-neutral-600'}`}>{tag}</button>)}</div><div className="flex gap-2"><input aria-label="New video tag" placeholder="Create a video tag" value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addTag(); } }} className="min-w-0 flex-1 rounded-lg bg-neutral-800 p-2"/><button type="button" onClick={addTag}>Add tag</button></div><p className="mt-1 text-xs text-neutral-400">Changes apply only to this video.</p></fieldset>
    <label className="block text-sm">Subtitle status<select aria-label="Subtitle status" value={status} onChange={e => setStatus(e.target.value as VideoStatus)} className="mt-1 w-full rounded-lg bg-neutral-800 p-2">{["COMPLETED","PROCESSING","NO_SUBTITLES","FAILED","PENDING"].map(s => <option key={s}>{s}</option>)}</select></label>
    <label className="block text-sm">ChatGPT link<input type="url" placeholder="https://chatgpt.com/c/..." value={link} onChange={e => setLink(e.target.value)} className="mt-1 w-full rounded-lg bg-neutral-800 p-2" /></label>
    {video.error_category && <p className="text-xs text-amber-300">{video.error_category}: {video.error_message}</p>}{error && <p role="alert" className="text-sm text-rose-300">{error}</p>}
    <div className="flex justify-end gap-3"><button type="button" disabled={saving} onClick={onClose}>Cancel</button><button disabled={saving} className="rounded-lg bg-white px-4 py-2 text-black">{saving ? "Saving..." : "Save Changes"}</button></div>
  </form></section></div>;
}
