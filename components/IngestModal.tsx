"use client";
import { FormEvent, useEffect, useState } from "react";
import { api } from "../lib/api";
import { VideoIngestInput } from "../types";

export default function IngestModal({ isOpen, onClose, onStart }: {
  isOpen: boolean; onClose: () => void; onStart: (input: VideoIngestInput) => void;
}) {
  const [mode, setMode] = useState<"video" | "playlist">("video");
  const [url, setUrl] = useState("");
  const [available, setAvailable] = useState<string[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    if (isOpen) { let active = true; void api.videos.getTags().then(v => { if (active) setAvailable(v); }).catch(() => {}); return () => { active = false; }; }
    setUrl(""); setTags([]); setDraft(""); setError("");
  }, [isOpen]);
  if (!isOpen) return null;
  const addTag = () => { const tag = draft.trim().replace(/^#/, ""); if (tag) setTags(current => [...new Set([...current, tag])]); setDraft(""); };
  const submit = (event: FormEvent) => {
    event.preventDefault(); setError("");
    try {
      const parsed = new URL(url);
      if (!["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be"].includes(parsed.hostname)) throw new Error("Enter a YouTube URL.");
      if (mode === "playlist" && !parsed.searchParams.get("list")) throw new Error("Enter a YouTube playlist URL containing list=.");
      if (mode === "video" && parsed.pathname === "/playlist") throw new Error("Choose YouTube playlist to add a playlist.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Enter a valid URL."); return; }
    onStart({url: url.trim(), mode, tags: mode === "video" ? [...new Set([...tags, ...(draft.trim() ? [draft.trim().replace(/^#/, "")] : [])])] : []});
    onClose();
  };
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"><section role="dialog" aria-modal="true" aria-label="Add videos" className="max-h-[90vh] overflow-y-auto w-full max-w-lg rounded-2xl border border-neutral-700 bg-[#262626] p-6 text-neutral-100">
    <div className="flex items-center justify-between"><h2 className="text-lg font-bold">Add videos</h2><button aria-label="Close add videos" onClick={onClose}>×</button></div>
    <div className="my-5 grid grid-cols-2 gap-2" role="group" aria-label="Import mode">{([['video','Single video'],['playlist','YouTube playlist']] as const).map(([value,label]) => <button key={value} aria-pressed={mode === value} onClick={() => { setMode(value); setUrl(""); setError(""); }} className={`rounded-lg border p-2 text-sm ${mode === value ? 'bg-white text-black' : 'border-neutral-700'}`}>{label}</button>)}</div>
    <form onSubmit={submit} className="space-y-4">
      <label className="block text-sm">{mode === "video" ? "Video URL" : "Playlist URL"}<input aria-label={mode === "video" ? "Video URL" : "Playlist URL"} required type="url" value={url} onChange={e => setUrl(e.target.value)} placeholder={mode === "video" ? "https://www.youtube.com/watch?v=..." : "https://www.youtube.com/playlist?list=..."} className="mt-2 w-full rounded-lg border border-neutral-700 bg-[#191919] px-3 py-2" /></label>
      {mode === "video" ? <fieldset><legend className="mb-2 text-sm">Video tags</legend><div className="mb-2 flex flex-wrap gap-2">{[...new Set([...available, ...tags])].map(tag => <button key={tag} type="button" aria-pressed={tags.includes(tag)} onClick={() => setTags(current => current.includes(tag) ? current.filter(t => t !== tag) : [...current, tag])} className={`rounded-full border px-3 py-1 text-xs ${tags.includes(tag) ? 'bg-white text-black' : 'border-neutral-600'}`}>{tag}</button>)}</div><div className="flex gap-2"><input aria-label="New video tag" value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addTag(); } }} placeholder="Create a video tag" className="min-w-0 flex-1 rounded-lg border border-neutral-700 bg-[#191919] px-3 py-2 text-sm" /><button type="button" onClick={addTag} className="rounded-lg border border-neutral-600 px-3 text-sm">Add tag</button></div><p className="mt-2 text-xs text-neutral-400">Tags apply only to this video. You can leave them empty.</p></fieldset> : <p className="rounded-lg bg-neutral-800 p-3 text-sm text-neutral-300">Every video in the playlist receives the playlist name as a tag. The name is read automatically from YouTube.</p>}
      {error && <p role="alert" className="text-sm text-rose-300">{error}</p>}
      <div className="flex justify-end gap-3"><button type="button" onClick={onClose}>Cancel</button><button className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-black" disabled={!url.trim()}>{mode === "video" ? "Add video" : "Add playlist"}</button></div>
    </form>
  </section></div>;
}
