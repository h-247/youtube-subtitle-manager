"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { ChannelItem, Video } from "../types";
import Navbar from "./Navbar";
import IngestModal from "./IngestModal";
import ChannelsModal from "./ChannelsModal";
import VideoLibraryControls from "./VideoLibraryControls";
import { ChevronDown, ExternalLink, Loader2, Play, Search, Tag, Tv } from "lucide-react";

export default function ChannelsPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const [channels, setChannels] = useState<ChannelItem[]>([]);
  const [videos, setVideos] = useState<Video[]>([]);
  const [allTags, setAllTags] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const [progressFilter, setProgressFilter] = useState("");
  const [channelFilter, setChannelFilter] = useState("");
  const [sort, setSort] = useState("recent");
  const [isIngestOpen, setIsIngestOpen] = useState(false);
  const [isManageOpen, setIsManageOpen] = useState(false);


  useEffect(() => {
    if (!authLoading && !user) router.replace("/login");
  }, [authLoading, user, router]);

  const refreshing = useRef(false);
  const loadLibrary = useCallback(async (silent = false) => {
    if (!user || refreshing.current) return;
    refreshing.current = true;
    if (!silent) setLoading(true);
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
      refreshing.current = false;
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    void loadLibrary();
  }, [loadLibrary]);

  useEffect(() => {
    if (!user) return;
    const refresh = () => {
      if (document.visibilityState === "visible" && !isManageOpen && !isIngestOpen) void loadLibrary(true);
    };
    const interval = window.setInterval(refresh, 10000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("sites-drive-links-refreshed", refresh);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("sites-drive-links-refreshed", refresh);
    };
  }, [user, loadLibrary, isManageOpen, isIngestOpen]);

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
        const channelVideos = videos.filter((video) => video.channel_title === channel.channel_title);
        const watchedCount = channelVideos.filter((video) => video.watch_status === "DONE").length;
        return { channel, channelVideos, nextVideo: queue[0] ?? null, watchedCount, subtitlesCount: channelVideos.filter((video) => video.status === "COMPLETED").length };
      })
      .filter(({ channel, channelVideos, watchedCount }) => {
        if (tagFilter && !channel.tags.includes(tagFilter)) return false;
        if (channelFilter && channel.channel_title !== channelFilter) return false;
        if (progressFilter === "not-started" && channelVideos.some((video) => video.watch_status !== "TO_DO")) return false;
        if (progressFilter === "watching" && !channelVideos.some((video) => video.watch_status === "DOING")) return false;
        if (progressFilter === "completed" && (!channelVideos.length || watchedCount !== channelVideos.length)) return false;
        return true;
      })
      .sort((a, b) => {
        if (sort === "name") return a.channel.channel_title.localeCompare(b.channel.channel_title);
        if (sort === "progress") return (b.watchedCount / (b.channelVideos.length || 1)) - (a.watchedCount / (a.channelVideos.length || 1));
        const latest = (items: Video[]) => items.reduce((value, video) => Math.max(value, Date.parse(video.updated_at) || Date.parse(video.created_at) || 0), 0);
        return latest(b.channelVideos) - latest(a.channelVideos) || a.channel.channel_title.localeCompare(b.channel.channel_title);
      });
  }, [channels, videos, search, tagFilter, progressFilter, channelFilter, sort]);

  const onVideoUpdated = (updated: Video) => {
    setVideos((current) => current.map((item) => item.id === updated.id ? updated : item));
  };

  const startIngestion = async (url: string) => {
    try {
      await api.videos.ingest(url);
      await loadLibrary();
    } catch (reason) {
      alert(reason instanceof Error ? reason.message : "Could not add videos.");
    }
  };

  if (authLoading || !user) {
    return <div className="min-h-screen flex items-center justify-center bg-[#212121]"><Loader2 className="h-8 w-8 animate-spin text-neutral-300" /></div>;
  }

  return (
    <div className="min-h-screen bg-[#212121] text-neutral-100 flex flex-col">
      <Navbar onOpenIngest={() => setIsIngestOpen(true)} />
      <main className="mx-auto w-full max-w-[1680px] flex-1 px-4 py-3 sm:px-6 lg:px-8">
        <h1 className="sr-only">Channels</h1>
        <div className="mb-3 flex flex-col gap-2 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <button aria-pressed={!search && !tagFilter && !progressFilter && !channelFilter} onClick={() => { setSearch(""); setTagFilter(""); setProgressFilter(""); setChannelFilter(""); }} className="h-9 rounded-full border border-neutral-700 bg-[#262626] px-3 text-sm font-semibold text-neutral-200 transition hover:bg-neutral-700">All channels</button>
            <label className="relative">
              <span className="sr-only">Category</span>
              <select aria-label="Category" value={tagFilter} onChange={(event) => setTagFilter(event.target.value)} className="h-9 max-w-48 appearance-none rounded-full border border-neutral-700 bg-[#262626] pl-3 pr-8 text-sm font-semibold text-neutral-200 outline-none focus:border-neutral-400">
                <option value="">Category</option>{allTags.map((tag) => <option key={tag} value={tag}>{tag}</option>)}
              </select><ChevronDown aria-hidden="true" className="pointer-events-none absolute right-3 top-3 h-3 w-3 text-neutral-400" />
            </label>
            <label className="relative">
              <span className="sr-only">Status</span>
              <select aria-label="Status" value={progressFilter} onChange={(event) => setProgressFilter(event.target.value)} className="h-9 appearance-none rounded-full border border-neutral-700 bg-[#262626] pl-3 pr-8 text-sm font-semibold text-neutral-200 outline-none focus:border-neutral-400">
                <option value="">Status</option><option value="not-started">To do</option><option value="watching">Doing</option><option value="completed">Done</option>
              </select><ChevronDown aria-hidden="true" className="pointer-events-none absolute right-3 top-3 h-3 w-3 text-neutral-400" />
            </label>
            <label className="relative">
              <span className="sr-only">Channel</span>
              <select aria-label="Channel" value={channelFilter} onChange={(event) => setChannelFilter(event.target.value)} className="h-9 max-w-56 appearance-none rounded-full border border-neutral-700 bg-[#262626] pl-3 pr-8 text-sm font-semibold text-neutral-200 outline-none focus:border-neutral-400">
                <option value="">Channel</option>{channels.map((channel) => <option key={channel.channel_title} value={channel.channel_title}>{channel.channel_title}</option>)}
              </select><ChevronDown aria-hidden="true" className="pointer-events-none absolute right-3 top-3 h-3 w-3 text-neutral-400" />
            </label>
          </div>
          <form role="search" onSubmit={(event) => event.preventDefault()} className="flex w-full gap-2 xl:w-[340px] xl:shrink-0">
            <input aria-label="Search channels or tags" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search my channels" className="h-9 min-w-0 flex-1 rounded-md border border-neutral-700 bg-transparent px-3 text-sm text-neutral-200 outline-none placeholder:text-neutral-500 focus:border-neutral-400" />
            <button type="submit" aria-label="Search" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-neutral-800 text-neutral-300 transition hover:bg-neutral-700"><Search className="h-4 w-4" /></button>
          </form>
        </div>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <p role="status" className="text-sm font-semibold text-neutral-200">{loading ? "Loading channels…" : `${channelCards.length} ${channelCards.length === 1 ? "channel" : "channels"}`}</p>
          <div className="flex flex-wrap items-center gap-4">
            <button onClick={() => setIsManageOpen(true)} className="inline-flex items-center gap-1.5 text-sm text-neutral-400 hover:text-white"><Tag className="h-3.5 w-3.5" /> Manage channels & tags</button>
            <label className="relative">
              <span className="sr-only">Sort channels</span>
              <select aria-label="Sort channels" value={sort} onChange={(event) => setSort(event.target.value)} className="appearance-none bg-[#212121] py-1 pl-1 pr-6 text-sm font-semibold text-neutral-200 outline-none focus:ring-1 focus:ring-neutral-500">
                <option value="recent">Recently updated</option><option value="name">Channel name</option><option value="progress">Watch progress</option>
              </select><ChevronDown aria-hidden="true" className="pointer-events-none absolute right-1 top-1.5 h-3 w-3 text-neutral-400" />
            </label>
          </div>
        </div>

        {error && <div className="mb-5 rounded-xl border border-rose-800/60 bg-rose-950/40 p-4 text-sm text-rose-200">{error}</div>}
        {loading ? (
          <div className="flex items-center justify-center gap-3 rounded-2xl border border-neutral-800 bg-[#262626] py-16 text-sm text-neutral-400"><Loader2 className="h-4 w-4 animate-spin" /> Loading channels and watch queue…</div>
        ) : channelCards.length === 0 ? (
          <div className="rounded-2xl border border-neutral-800 bg-[#262626] px-6 py-16 text-center">
            <Tv className="mx-auto mb-3 h-8 w-8 text-neutral-500" />
            <p className="font-medium">{search || tagFilter || progressFilter || channelFilter ? "No matching channels" : "No channels yet"}</p>
            <p className="mt-1 text-sm text-neutral-400">{search || tagFilter || progressFilter || channelFilter ? "Try changing your filters or search." : "Ingest videos to build your channel library."}</p>
          </div>
        ) : (
          <section aria-label="Channel library">
            <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,250px),280px))] items-start gap-4">
              {channelCards.map(({ channel, channelVideos, nextVideo, watchedCount, subtitlesCount }) => {
                const progress = channel.video_count ? Math.round((watchedCount / channel.video_count) * 100) : 0;
                const detailHref = `/dashboard/channels/${encodeURIComponent(channel.channel_title)}`;
                return (
                  <article key={channel.channel_title} className="overflow-hidden rounded-xl border border-neutral-800 bg-[#262626]">
                    <a href={detailHref} aria-label={`View ${channel.channel_title} videos`} className="relative block aspect-video overflow-hidden bg-[#171717]">
                      {(nextVideo || channelVideos[0])?.thumbnail_url ? <img src={(nextVideo || channelVideos[0])!.thumbnail_url!} alt="" className="h-full w-full object-cover" /> : <Tv className="absolute inset-0 m-auto h-10 w-10 text-neutral-600" />}
                    </a>
                    <div className="p-2.5">
                      <div className="flex items-start justify-between gap-2">
                        <a href={detailHref} className="line-clamp-1 text-xs font-semibold hover:underline">{channel.channel_title}</a>
                        <a href={channel.channel_url || `https://www.youtube.com/results?search_query=${encodeURIComponent(channel.channel_title)}`} target="_blank" rel="noreferrer" aria-label="Open channel on YouTube" className="shrink-0 text-neutral-400 hover:text-white"><ExternalLink className="h-3.5 w-3.5" /></a>
                      </div>
                      <div className="mt-2 h-1 overflow-hidden rounded-full bg-[#171717]"><div className="h-full bg-neutral-300 transition-all" style={{ width: `${progress}%` }} /></div>
                      <div className="mt-1.5 flex justify-between gap-2 text-[10px] text-neutral-400"><span>{watchedCount}/{channel.video_count} watched · {progress}%</span><span>{subtitlesCount} subtitles</span></div>
                      {nextVideo ? <div className="mt-2">
                        <p className="mb-1 flex items-center gap-1 text-[10px] font-medium text-amber-300"><Play className="h-3 w-3" /> {nextVideo.watch_status === "DOING" ? "Continue Watching" : "Next Video"}</p>
                        <a href={nextVideo.youtube_url} target="_blank" rel="noreferrer" className="line-clamp-2 text-xs leading-4 hover:underline">{nextVideo.title}</a>
                        <VideoLibraryControls key={nextVideo.id} video={nextVideo} onUpdated={onVideoUpdated} />
                      </div> : <p className="mt-2 text-xs text-neutral-400">All videos watched.</p>}
                      {channelVideos.some((video) => video.id !== nextVideo?.id) && <details className="mt-2 border-t border-neutral-800 pt-2">
                        <summary className="cursor-pointer text-xs text-neutral-400">More videos ({channelVideos.filter((video) => video.id !== nextVideo?.id).length})</summary>
                        <div className="mt-2 space-y-4">{channelVideos.filter((video) => video.id !== nextVideo?.id).map((video) => <div key={video.id}>
                          <a href={video.youtube_url} target="_blank" rel="noreferrer" className="line-clamp-2 text-xs font-medium hover:underline">{video.title}</a>
                          <VideoLibraryControls video={video} onUpdated={onVideoUpdated} />
                        </div>)}</div>
                      </details>}
                      {channel.tags.length > 0 && <div className="mt-2 flex flex-wrap gap-1">{channel.tags.map((tag) => <span key={tag} className="text-[10px] text-neutral-400">#{tag}</span>)}</div>}
                      <a href={detailHref} className="mt-2 flex items-center justify-between border-t border-neutral-800 pt-2 text-xs text-neutral-300 hover:text-white"><span>View Channel Content</span><span aria-hidden="true">→</span></a>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        )}
      </main>
      <IngestModal isOpen={isIngestOpen} onClose={() => setIsIngestOpen(false)} onStart={startIngestion} />
      <ChannelsModal isOpen={isManageOpen} onClose={() => setIsManageOpen(false)} allTags={allTags} onChannelsChanged={() => void loadLibrary()} />
    </div>
  );
}
