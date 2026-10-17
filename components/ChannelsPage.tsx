"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { ChannelItem, Video } from "../types";
import Navbar from "./Navbar";
import IngestModal from "./IngestModal";
import ChannelsModal from "./ChannelsModal";
import VideoLibraryControls from "./VideoLibraryControls";
import { ExternalLink, Loader2, Play, Search, Tag, Tv } from "lucide-react";

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

  useEffect(() => {
    void loadLibrary();
  }, [loadLibrary]);

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
      });
  }, [channels, videos, search]);

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
      <main className="mx-auto w-full max-w-[1680px] flex-1 px-4 py-6 sm:px-6 lg:px-8">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="mb-2 flex items-center gap-2 text-sm text-neutral-400"><Tv className="h-4 w-4" /> Channel library</div>
            <h1 className="text-2xl font-bold">Channels</h1>
            <p className="mt-1 text-sm text-neutral-400">Browse your channels and open a channel to view its videos.</p>
          </div>
          <button onClick={() => setIsManageOpen(true)} className="inline-flex items-center gap-2 rounded-lg border border-neutral-700 bg-neutral-800 px-4 py-2 text-sm text-neutral-200 transition hover:bg-neutral-700">
            <Tag className="h-4 w-4" /> Manage channels & tags
          </button>
        </div>

        <label className="mb-6 flex max-w-xl items-center gap-3 rounded-xl border border-neutral-800 bg-[#262626] px-4 py-3">
          <Search className="h-4 w-4 text-neutral-500" />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search channels or tags…" className="w-full bg-transparent text-sm outline-none placeholder:text-neutral-500" />
        </label>

        {error && <div className="mb-5 rounded-xl border border-rose-800/60 bg-rose-950/40 p-4 text-sm text-rose-200">{error}</div>}
        {loading ? (
          <div className="flex items-center justify-center gap-3 rounded-2xl border border-neutral-800 bg-[#262626] py-16 text-sm text-neutral-400"><Loader2 className="h-5 w-5 animate-spin" /> Loading channels and watch queue…</div>
        ) : channelCards.length === 0 ? (
          <div className="rounded-2xl border border-neutral-800 bg-[#262626] px-6 py-16 text-center">
            <Tv className="mx-auto mb-3 h-8 w-8 text-neutral-500" />
            <p className="font-medium">{search ? "No matching channels" : "No channels yet"}</p>
            <p className="mt-1 text-sm text-neutral-400">Ingest videos to build your channel library.</p>
          </div>
        ) : (
          <section aria-labelledby="continue-watching-heading">
            <div className="mb-4 flex items-center justify-between">
              <div><h2 id="continue-watching-heading" className="text-lg font-semibold">Continue watching</h2><p className="mt-1 text-xs text-neutral-500">Resume videos in progress, or start the next unwatched video from each channel.</p></div>
              <span className="text-xs text-neutral-500">{channelCards.length} channels</span>
            </div>
            <div className="grid grid-cols-1 items-start gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {channelCards.map(({ channel, channelVideos, nextVideo, watchedCount, subtitlesCount }) => {
                const progress = channel.video_count ? Math.round((watchedCount / channel.video_count) * 100) : 0;
                const detailHref = `/dashboard/channels/${encodeURIComponent(channel.channel_title)}`;
                return (
                  <article key={channel.channel_title} className="overflow-hidden rounded-xl border border-neutral-800 bg-[#262626]">
                    <a href={detailHref} aria-label={`View ${channel.channel_title} videos`} className="relative block aspect-video overflow-hidden bg-[#171717]">
                      {(nextVideo || channelVideos[0])?.thumbnail_url ? <img src={(nextVideo || channelVideos[0])!.thumbnail_url!} alt="" className="h-full w-full object-cover" /> : <Tv className="absolute inset-0 m-auto h-10 w-10 text-neutral-600" />}
                      <span className="absolute bottom-2 right-2 rounded bg-black/75 px-2 py-1 text-[10px] text-white">{channel.video_count} videos</span>
                    </a>
                    <div className="p-3">
                      <div className="flex items-start justify-between gap-2">
                        <a href={detailHref} className="line-clamp-1 text-sm font-semibold hover:underline">{channel.channel_title}</a>
                        <a href={channel.channel_url || `https://www.youtube.com/results?search_query=${encodeURIComponent(channel.channel_title)}`} target="_blank" rel="noreferrer" aria-label="Open channel on YouTube" className="shrink-0 text-neutral-400 hover:text-white"><ExternalLink className="h-3.5 w-3.5" /></a>
                      </div>
                      <div className="mt-2 h-1 overflow-hidden rounded-full bg-[#171717]"><div className="h-full bg-neutral-300 transition-all" style={{ width: `${progress}%` }} /></div>
                      <div className="mt-1.5 flex justify-between gap-2 text-[10px] text-neutral-400"><span>{watchedCount}/{channel.video_count} watched · {progress}%</span><span>{subtitlesCount} subtitles</span></div>
                      {nextVideo ? <div className="mt-3">
                        <p className="mb-1 flex items-center gap-1 text-[10px] font-medium text-amber-300"><Play className="h-3 w-3" /> {nextVideo.watch_status === "DOING" ? "Continue Watching" : "Next Video"}</p>
                        <a href={nextVideo.youtube_url} target="_blank" rel="noreferrer" className="line-clamp-2 min-h-10 text-sm leading-5 hover:underline">{nextVideo.title}</a>
                        <VideoLibraryControls key={nextVideo.id} video={nextVideo} onUpdated={onVideoUpdated} />
                      </div> : <p className="mt-3 text-xs text-neutral-400">All videos watched.</p>}
                      {channelVideos.some((video) => video.id !== nextVideo?.id) && <details className="mt-3 border-t border-neutral-800 pt-2">
                        <summary className="cursor-pointer text-xs text-neutral-400">More videos ({channelVideos.filter((video) => video.id !== nextVideo?.id).length})</summary>
                        <div className="mt-3 space-y-4">{channelVideos.filter((video) => video.id !== nextVideo?.id).map((video) => <div key={video.id}>
                          <a href={video.youtube_url} target="_blank" rel="noreferrer" className="line-clamp-2 text-xs font-medium hover:underline">{video.title}</a>
                          <VideoLibraryControls video={video} onUpdated={onVideoUpdated} />
                        </div>)}</div>
                      </details>}
                      {channel.tags.length > 0 && <div className="mt-2 flex flex-wrap gap-1">{channel.tags.map((tag) => <span key={tag} className="text-[10px] text-neutral-400">#{tag}</span>)}</div>}
                      <a href={detailHref} className="mt-3 flex items-center justify-between border-t border-neutral-800 pt-2 text-xs text-neutral-300 hover:text-white"><span>View Channel Content</span><span aria-hidden="true">→</span></a>
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
