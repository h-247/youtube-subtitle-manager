"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, CheckCircle2, ExternalLink, Film, Loader2, MessageSquare, Pencil, Play, Save, X } from "lucide-react";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { ChannelItem, Video, WatchStatus } from "../types";
import Navbar from "./Navbar";
import IngestModal from "./IngestModal";

export default function ChannelDetailPage() {
  const { channelTitle = "" } = useParams<{ channelTitle: string }>();
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const [channel, setChannel] = useState<ChannelItem | null>(null);
  const [videos, setVideos] = useState<Video[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ingestOpen, setIngestOpen] = useState(false);
  const [editingLink, setEditingLink] = useState(false);
  const [chatgptLink, setChatgptLink] = useState("");
  const [savingLink, setSavingLink] = useState(false);
  const [savingStatusId, setSavingStatusId] = useState<number | null>(null);

  useEffect(() => { if (!authLoading && !user) router.replace("/login"); }, [authLoading, user, router]);
  const loadChannel = useCallback(async () => {
    if (!user || !channelTitle) return;
    setLoading(true); setError(null);
    try {
      const [channels, first] = await Promise.all([api.videos.getChannels(), api.videos.list({ page: 1, page_size: 100 })]);
      const rest = await Promise.all(Array.from({ length: Math.max(0, first.total_pages - 1) }, (_, i) => api.videos.list({ page: i + 2, page_size: 100 })));
      setChannel(channels.find((item) => item.channel_title === channelTitle) ?? null);
      setVideos([...first.items, ...rest.flatMap((page) => page.items)].filter((video) => video.channel_title === channelTitle).sort((a, b) => a.created_at.localeCompare(b.created_at)));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not load this channel."); }
    finally { setLoading(false); }
  }, [user, channelTitle]);
  useEffect(() => { void loadChannel(); }, [loadChannel]);

  const nextVideo = useMemo(() => {
    const queue = videos.filter((video) => video.watch_status !== "DONE");
    queue.sort((a, b) => {
      const rank = (video: Video) => video.watch_status === "DOING" ? 0 : video.status === "COMPLETED" ? 1 : 2;
      return rank(a) - rank(b) || a.created_at.localeCompare(b.created_at);
    });
    return queue[0] ?? null;
  }, [videos]);
  const watched = videos.filter((video) => video.watch_status === "DONE").length;
  const ready = videos.filter((video) => video.status === "COMPLETED").length;
  const progress = videos.length ? Math.round(watched * 100 / videos.length) : 0;
  useEffect(() => { setChatgptLink(nextVideo?.chatgpt_link || ""); setEditingLink(false); }, [nextVideo?.id, nextVideo?.chatgpt_link]);

  const saveLink = async (event: FormEvent) => {
    event.preventDefault();
    if (!nextVideo) return;
    const value = chatgptLink.trim();
    if (value) {
      try { const parsed = new URL(value); if (!/^https?:$/.test(parsed.protocol)) throw new Error("Use an http or https URL."); }
      catch (reason) { alert(reason instanceof Error ? reason.message : "Enter a valid link."); return; }
    }
    setSavingLink(true);
    try {
      const updated = await api.videos.update(nextVideo.id, { chatgpt_link: value || null });
      setVideos((items) => items.map((video) => video.id === updated.id ? updated : video));
      setEditingLink(false);
    } catch (reason) { alert(reason instanceof Error ? reason.message : "Could not save the link."); }
    finally { setSavingLink(false); }
  };
  const updateStatus = async (video: Video, watch_status: WatchStatus) => {
    setSavingStatusId(video.id);
    try { const updated = await api.videos.update(video.id, { watch_status }); setVideos((items) => items.map((item) => item.id === updated.id ? updated : item)); }
    catch (reason) { alert(reason instanceof Error ? reason.message : "Could not update status."); }
    finally { setSavingStatusId(null); }
  };
  const ingest = async (url: string) => { try { await api.videos.ingest(url); await loadChannel(); } catch (reason) { alert(reason instanceof Error ? reason.message : "Could not add videos."); } };

  if (authLoading || !user) return <div className="min-h-screen flex items-center justify-center bg-[#212121]"><Loader2 className="h-8 w-8 animate-spin text-neutral-300" /></div>;
  return <div className="min-h-screen bg-[#212121] text-neutral-100 flex flex-col">
    <Navbar onOpenIngest={() => setIngestOpen(true)} />
    <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-6 lg:px-8">
      <Link href="/dashboard/channels" className="mb-6 inline-flex items-center gap-2 rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-neutral-300 hover:text-white"><ArrowLeft className="h-4 w-4" /> Channels</Link>
      {error && <div className="mb-5 rounded-xl border border-rose-800/60 bg-rose-950/40 p-4 text-sm text-rose-200">{error}</div>}
      {loading ? <div className="flex items-center justify-center gap-3 rounded-2xl border border-neutral-800 bg-[#262626] py-16 text-sm text-neutral-400"><Loader2 className="h-5 w-5 animate-spin" /> Loading channel…</div> : !channel ? <div className="rounded-2xl border border-neutral-800 bg-[#262626] p-8 text-center">Channel not found.</div> : <>
        <section className="rounded-2xl border border-neutral-800 bg-[#262626] p-6 sm:p-8">
          <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-neutral-400"><span className="rounded-full border border-neutral-700 bg-[#1b1b1b] px-3 py-1">Channel</span><span className="rounded-full border border-neutral-700 bg-[#1b1b1b] px-3 py-1">{videos.length} Videos</span><a href={channel.channel_url || `https://www.youtube.com/results?search_query=${encodeURIComponent(channel.channel_title)}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-white">Open Channel on YouTube <ExternalLink className="h-3 w-3" /></a></div>
          <h1 className="text-2xl font-bold sm:text-3xl">{channel.channel_title}</h1>
          <div className="mt-2 flex flex-wrap gap-1.5">{channel.tags.map((tag) => <span key={tag} className="rounded-md border border-neutral-700 bg-neutral-800 px-2 py-0.5 text-xs text-neutral-300">#{tag}</span>)}</div>
          <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">{[["Total Videos", videos.length], ["Subtitles Ready", ready], ["Watched", `${watched} / ${videos.length}`], ["Watch Progress", `${progress}%`]].map(([label, value]) => <div key={label} className="rounded-xl border border-neutral-800 bg-[#1b1b1b] p-4"><div className="text-xs text-neutral-400">{label}</div><div className="mt-1 text-2xl font-bold">{value}</div></div>)}</div>
        </section>

        {nextVideo ? <section className="mt-6 rounded-2xl border border-amber-500/40 bg-gradient-to-br from-amber-500/10 to-transparent p-5 sm:p-7">
          <div className="mb-4 flex flex-wrap items-center gap-2 text-xs"><span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/50 bg-amber-500/10 px-3 py-1 font-semibold text-amber-300"><Play className="h-3.5 w-3.5" fill="currentColor" /> CONTINUE WATCHING</span><span className="rounded-full border border-neutral-700 bg-[#1b1b1b] px-3 py-1 text-neutral-300">{nextVideo.watch_status === "DOING" ? "In progress" : "Next up"}</span></div>
          <div className="flex flex-col gap-5 md:flex-row md:items-center">
            <a href={nextVideo.youtube_url} target="_blank" rel="noreferrer" className="relative aspect-video w-full shrink-0 overflow-hidden rounded-xl bg-[#151515] md:w-72">{nextVideo.thumbnail_url ? <img src={nextVideo.thumbnail_url} alt="" className="h-full w-full object-cover" /> : <Film className="m-auto h-12 w-12 text-neutral-600" />}<span className="absolute inset-0 flex items-center justify-center bg-black/30"><Play className="h-11 w-11 text-white" fill="currentColor" /></span></a>
            <div className="min-w-0 flex-1"><h2 className="text-xl font-bold sm:text-2xl">{nextVideo.title}</h2><div className="mt-3 flex flex-wrap gap-3 text-xs text-neutral-400"><span>{nextVideo.status === "COMPLETED" ? "Subtitle: Ready" : `Subtitle: ${nextVideo.status.replaceAll("_", " ")}`}</span><a href={nextVideo.youtube_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-white"><Play className="h-3.5 w-3.5" /> Play on YouTube <ExternalLink className="h-3 w-3" /></a></div>
              <div className="mt-4 flex flex-wrap items-center gap-2"><button disabled={savingStatusId === nextVideo.id} onClick={() => void updateStatus(nextVideo, "DONE")} className="inline-flex items-center gap-2 rounded-xl border border-neutral-700 bg-neutral-800 px-4 py-2.5 text-sm hover:bg-neutral-700 disabled:opacity-50"><CheckCircle2 className="h-4 w-4" /> Mark as Done</button><button disabled={savingStatusId === nextVideo.id} onClick={() => void updateStatus(nextVideo, "DOING")} className="inline-flex items-center gap-2 rounded-xl border border-amber-500/50 bg-amber-500/10 px-4 py-2.5 text-sm text-amber-200 hover:bg-amber-500/20 disabled:opacity-50">● Mark as Doing</button>{nextVideo.chatgpt_link && !editingLink && <a href={nextVideo.chatgpt_link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-medium text-neutral-900 hover:bg-neutral-200"><MessageSquare className="h-4 w-4" /> ChatGPT Link <ExternalLink className="h-3.5 w-3.5" /></a>}{!editingLink && <button onClick={() => setEditingLink(true)} className="inline-flex items-center gap-2 rounded-xl border border-neutral-700 bg-[#1b1b1b] px-4 py-2.5 text-sm text-neutral-200 hover:bg-neutral-800"><Pencil className="h-4 w-4" /> {nextVideo.chatgpt_link ? "Edit ChatGPT Link" : "Add ChatGPT Link"}</button>}</div>
              {editingLink && <form onSubmit={saveLink} className="mt-4 flex flex-col gap-2 sm:flex-row"><input type="url" value={chatgptLink} onChange={(event) => setChatgptLink(event.target.value)} placeholder="https://chatgpt.com/c/..." className="min-w-0 flex-1 rounded-xl border border-neutral-700 bg-[#151515] px-3 py-2.5 text-sm outline-none focus:border-neutral-400"/><button disabled={savingLink} className="inline-flex items-center justify-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-medium text-neutral-900 disabled:opacity-50"><Save className="h-4 w-4" /> {savingLink ? "Saving…" : "Save Link"}</button><button type="button" onClick={() => { setChatgptLink(nextVideo.chatgpt_link || ""); setEditingLink(false); }} className="inline-flex items-center justify-center gap-2 rounded-xl border border-neutral-700 px-4 py-2.5 text-sm text-neutral-300"><X className="h-4 w-4" /> Cancel</button></form>}
            </div>
          </div>
        </section> : <section className="mt-6 rounded-2xl border border-neutral-800 bg-[#262626] p-6 text-sm text-neutral-400">All videos in this channel are marked as watched.</section>}

        <section className="mt-7"><div className="mb-4"><h2 className="text-xl font-bold">Channel Videos</h2><p className="mt-1 text-sm text-neutral-400">{videos.length} videos · {ready} subtitles ready</p></div><div className="space-y-3">{videos.map((video, index) => <article key={video.id} className={`flex flex-col gap-4 rounded-2xl border p-4 sm:flex-row sm:items-center ${video.id === nextVideo?.id ? "border-amber-500/30 bg-amber-500/[0.04]" : "border-neutral-800 bg-[#262626]"}`}><div className="flex min-w-0 flex-1 items-center gap-4"><span className="w-7 shrink-0 text-center font-mono text-sm text-neutral-500">{index + 1}</span><a href={video.youtube_url} target="_blank" rel="noreferrer" className="h-16 w-28 shrink-0 overflow-hidden rounded-lg bg-[#151515]">{video.thumbnail_url ? <img src={video.thumbnail_url} alt="" className="h-full w-full object-cover" /> : <Film className="m-auto h-7 w-7 text-neutral-600" />}</a><div className="min-w-0"><a href={video.youtube_url} target="_blank" rel="noreferrer" className="line-clamp-2 text-sm font-semibold hover:underline">{video.title}</a><div className="mt-1.5 flex flex-wrap gap-2 text-[11px] text-neutral-400"><span>{video.status === "COMPLETED" ? "Subtitle Ready" : video.status.replaceAll("_", " ")}</span>{video.subtitle_language && <span>· {video.subtitle_language}</span>}{video.id === nextVideo?.id && <span className="font-medium text-amber-300">· Next up</span>}</div></div></div><div className="flex flex-wrap items-center gap-2 sm:justify-end"><select aria-label={`Watch status for ${video.title}`} value={video.watch_status} disabled={savingStatusId === video.id} onChange={(event) => void updateStatus(video, event.target.value as WatchStatus)} className="rounded-lg border border-neutral-700 bg-[#1b1b1b] px-2.5 py-2 text-xs text-neutral-200 outline-none"><option value="TO_DO">To do</option><option value="DOING">Doing</option><option value="DONE">Done</option></select>{video.chatgpt_link ? <a href={video.chatgpt_link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-700 bg-[#1b1b1b] px-3 py-2 text-xs text-sky-300 hover:text-sky-200"><MessageSquare className="h-3.5 w-3.5" /> ChatGPT</a> : <span className="text-xs text-neutral-600">No ChatGPT link</span>}</div></article>)}</div></section>
      </>}
    </main>
    <IngestModal isOpen={ingestOpen} onClose={() => setIngestOpen(false)} onStart={ingest} />
  </div>;
}
