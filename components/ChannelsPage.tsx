"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { ChannelItem, Video, WatchStatus } from "../types";
import Navbar from "./Navbar";
import IngestModal from "./IngestModal";
import ChannelsModal from "./ChannelsModal";
import { ExternalLink, Film, Loader2, Play, Search, Tag, Tv } from "lucide-react";

export default function ChannelsPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const [channels, setChannels] = useState<ChannelItem[]>([]);
  const [videos, setVideos] = useState<Video[]>([]);
  const [allTags, setAllTags] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [isIngestOpen, setIsIngestOpen] = useState(false);
  const [isManageOpen, setIsManageOpen] = useState(false);
  const [savingVideoId, setSavingVideoId] = useState<number | null>(null);

  useEffect(() => {
    if (!authLoading && !user) router.replace("/login");
  }, [authLoading, user, router]);

  const loadLibrary = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
    try {
      const [channelData, tagData, firstPage] = await Promise.all([
        api.videos.getChannels(),
        api.videos.getTags(),
        api.videos.list({ page: 1, page_size: 100 }),
      ]);
      const videoPages = await Promise.all(
        Array.from({ length: Math.max(0, firstPage.total_pages - 1) }, (_, index) =>
          api.videos.list({ page: index + 2, page_size: 100 })
        )
      );
      setChannels(channelData);
      setAllTags(tagData);
      setVideos([...firstPage.items, ...videoPages.flatMap((page) => page.items)]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load channels.");
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => { void loadLibrary(); }, [loadLibrary]);

  const channelCards = useMemo(() => {
    const query = search.trim().toLowerCase();
    const eligible = videos.filter((video) => video.watch_status !== "DONE");
    return channels
      .filter((channel) => !query || channel.channel_title.toLowerCase().includes(query) || channel.tags.some((tag) => tag.toLowerCase().includes(query)))
      .map((channel) => {
        const queue = eligible
          .filter((video) => video.channel_title === channel.channel_title)
          .sort((a, b) => {
            const aRank = a.watch_status === "DOING" ? 0 : a.status === "COMPLETED" ? 1 : 2;
            const bRank = b.watch_status === "DOING" ? 0 : b.status === "COMPLETED" ? 1 : 2;
            return aRank - bRank || a.created_at.localeCompare(b.created_at);
          });
        return { channel, nextVideo: queue[0] ?? null };
      });
  }, [channels, videos, search]);

  const updateWatchStatus = async (video: Video, watch_status: WatchStatus) => {
    setSavingVideoId(video.id);
    try {
      const updated = await api.videos.update(video.id, { watch_status });
      setVideos((current) => current.map((item) => item.id === updated.id ? updated : item));
    } catch (reason) {
      alert(reason instanceof Error ? reason.message : "Could not update watch status.");
    } finally {
      setSavingVideoId(null);
    }
  };

  const startIngestion = async (url: string) => {
    try {
      await api.videos.ingest(url);
      await loadLibrary();
    } catch (reason) {
      alert(reason instanceof Error ? reason.message : "Could not add videos.");
    }
  };

  if (authLoading || !user) return <div className="min-h-screen flex items-center justify-center bg-[#212121]"><Loader2 className="h-8 w-8 animate-spin text-neutral-300" /></div>;

  return (
    <div className="min-h-screen bg-[#212121] text-neutral-100 flex flex-col">
      <Navbar onOpenIngest={() => setIsIngestOpen(true)} />
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div><div className="mb-2 flex items-center gap-2 text-sm text-neutral-400"><Tv className="h-4 w-4" /> Channel library</div><h1 className="text-2xl font-bold">Channels</h1><p className="mt-1 text-sm text-neutral-400">Mỗi kênh hiển thị video tiếp theo trong danh sách xem của bạn.</p></div>
          <button onClick={() => setIsManageOpen(true)} className="inline-flex items-center gap-2 rounded-lg border border-neutral-700 bg-neutral-800 px-4 py-2 text-sm text-neutral-200 transition hover:bg-neutral-700"><Tag className="h-4 w-4" /> Manage channels & tags</button>
        </div>
        <label className="mb-6 flex max-w-xl items-center gap-3 rounded-xl border border-neutral-800 bg-[#262626] px-4 py-3"><Search className="h-4 w-4 text-neutral-500" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search channels or tags…" className="w-full bg-transparent text-sm outline-none placeholder:text-neutral-500" /></label>
        {error && <div className="mb-5 rounded-xl border border-rose-800/60 bg-rose-950/40 p-4 text-sm text-rose-200">{error}</div>}
        {loading ? <div className="flex items-center justify-center gap-3 rounded-2xl border border-neutral-800 bg-[#262626] py-16 text-sm text-neutral-400"><Loader2 className="h-5 w-5 animate-spin" /> Loading channels and watch queue…</div> : channelCards.length === 0 ? <div className="rounded-2xl border border-neutral-800 bg-[#262626] px-6 py-16 text-center"><Tv className="mx-auto mb-3 h-8 w-8 text-neutral-500" /><p className="font-medium">{search ? "No matching channels" : "No channels yet"}</p><p className="mt-1 text-sm text-neutral-400">Ingest videos to build your channel library.</p></div> : (
          <section aria-labelledby="continue-watching-heading">
            <div className="mb-4 flex items-center justify-between"><div><h2 id="continue-watching-heading" className="text-lg font-semibold">Continue watching</h2><p className="mt-1 text-xs text-neutral-500">Đang xem được ưu tiên; nếu chưa có, chọn video chưa xem cũ nhất của kênh.</p></div><span className="text-xs text-neutral-500">{channelCards.length} channels</span></div>
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {channelCards.map(({ channel, nextVideo }) => <article key={channel.channel_title} className="overflow-hidden rounded-2xl border border-neutral-800 bg-[#262626]">
                <div className="flex items-start justify-between gap-3 border-b border-neutral-800 px-5 py-4"><div className="min-w-0"><a href={channel.channel_url || `https://www.youtube.com/results?search_query=${encodeURIComponent(channel.channel_title)}`} target="_blank" rel="noreferrer" className="inline-flex max-w-full items-center gap-2 font-semibold hover:text-white"><span className="truncate">{channel.channel_title}</span><ExternalLink className="h-3.5 w-3.5 shrink-0 text-neutral-500" /></a><div className="mt-1 text-xs text-neutral-500">{channel.video_count} videos</div></div><div className="flex max-w-[45%] flex-wrap justify-end gap-1.5">{channel.tags.map((tag) => <span key={tag} className="rounded-md border border-neutral-700 bg-neutral-800 px-2 py-0.5 text-[11px] text-neutral-300">#{tag}</span>)}</div></div>
                {nextVideo ? <div className="flex flex-col gap-4 p-4 sm:flex-row"><a href={nextVideo.youtube_url} target="_blank" rel="noreferrer" className="group relative aspect-video w-full shrink-0 overflow-hidden rounded-xl bg-neutral-900 sm:w-44">{nextVideo.thumbnail_url ? <img src={nextVideo.thumbnail_url} alt="" className="h-full w-full object-cover transition group-hover:scale-105" /> : <Film className="m-auto h-10 w-10 text-neutral-600" />}<span className="absolute inset-0 flex items-center justify-center bg-black/0 transition group-hover:bg-black/30"><Play className="h-8 w-8 text-white opacity-0 group-hover:opacity-100" fill="currentColor" /></span></a><div className="min-w-0 flex-1"><a href={nextVideo.youtube_url} target="_blank" rel="noreferrer" className="line-clamp-2 text-sm font-semibold leading-5 hover:underline">{nextVideo.title}</a><div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-neutral-400"><span className="rounded-full border border-neutral-700 px-2 py-0.5">{nextVideo.watch_status === "DOING" ? "IN PROGRESS" : "UP NEXT"}</span><span>{nextVideo.status === "COMPLETED" ? "Subtitles ready" : nextVideo.status.replaceAll("_", " ")}</span></div><label className="mt-3 flex items-center gap-2 text-xs text-neutral-400">Watch status<select value={nextVideo.watch_status} disabled={savingVideoId === nextVideo.id} onChange={(event) => void updateWatchStatus(nextVideo, event.target.value as WatchStatus)} className="rounded-lg border border-neutral-700 bg-[#1b1b1b] px-2.5 py-1.5 text-xs text-neutral-200 outline-none focus:border-neutral-500"><option value="TO_DO">To do</option><option value="DOING">Watching</option><option value="DONE">Watched</option></select>{savingVideoId === nextVideo.id && <Loader2 className="h-3.5 w-3.5 animate-spin" />}</label></div></div> : <div className="flex items-center gap-3 p-5 text-sm text-neutral-400"><Film className="h-5 w-5 shrink-0" /><span>All saved videos from this channel are marked watched.</span></div>}
              </article>)}
            </div>
          </section>
        )}
      </main>
      <IngestModal isOpen={isIngestOpen} onClose={() => setIsIngestOpen(false)} onStart={startIngestion} />
      <ChannelsModal isOpen={isManageOpen} onClose={() => setIsManageOpen(false)} allTags={allTags} onChannelsChanged={() => void loadLibrary()} />
    </div>
  );
}
