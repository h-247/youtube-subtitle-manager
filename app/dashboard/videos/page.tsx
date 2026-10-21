"use client";

import React, { useState, useEffect, useCallback, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "../../../lib/auth";
import { api } from "../../../lib/api";
import { VideoIngestInput, videoTags, Video } from "../../../types";
import Navbar from "../../../components/Navbar";
import IngestModal from "../../../components/IngestModal";
import EditModal from "../../../components/EditModal";
import {
  Search,
  ExternalLink,
  HardDrive,
  MessageSquare,
  Edit,
  Trash2,
  Clock,
  Clapperboard,
  AlertCircle,
  AlertTriangle,
  CheckCircle,
  FileText,
  RotateCw,
  Copy,
  Check,
  Tag,
  Tv,
  Loader2,
  Upload,
} from "lucide-react";

type IngestionNoticeKind = "running" | "success" | "partial-failure" | "error";

type IngestionNotice = {
  id: string;
  kind: IngestionNoticeKind;
  message: string;
};

const requiresYouTubeVerification = (video: Video) =>
  /YouTube verification required from Sites|Sites request was not accepted|Sign in to confirm you.re not a bot/i.test(video.error_message || "");

function DashboardContent() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [videos, setVideos] = useState<Video[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  // Search & Filter state
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [watchStatusFilter, setWatchStatusFilter] = useState("ALL");
  const [tagFilter, setTagFilter] = useState("ALL");
  const [allTags, setAllTags] = useState<string[]>([]);

  // Modals state
  const [isIngestOpen, setIsIngestOpen] = useState(false);
  const [editingVideo, setEditingVideo] = useState<Video | null>(null);
  // Notification banner from OAuth redirect, notices & toasts
  const [bannerMessage, setBannerMessage] = useState<string | null>(null);
  const [ingestionNotices, setIngestionNotices] = useState<IngestionNotice[]>([]);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [copiedDriveId, setCopiedDriveId] = useState<number | null>(null);
  const [sharedPromptLink, setSharedPromptLink] = useState<string | null>(null);
  const [uploadingCaptionId, setUploadingCaptionId] = useState<number | null>(null);

  useEffect(() => {
    if (!authLoading && !user) {
      router.push("/login");
    }
  }, [user, authLoading, router]);

  useEffect(() => {
    if (user) api.preferences.getPromptLink().then(result => setSharedPromptLink(result.chatgpt_prompt_link)).catch(() => {});
  }, [user]);

  useEffect(() => {
    const onPromptLinkUpdated = (event: Event) => setSharedPromptLink((event as CustomEvent<{ value: string | null }>).detail.value);
    window.addEventListener("chatgpt-prompt-link-updated", onPromptLinkUpdated);
    return () => window.removeEventListener("chatgpt-prompt-link-updated", onPromptLinkUpdated);
  }, []);

  useEffect(() => {
    if (searchParams.get("youtube_connected") === "true") {
      setBannerMessage("YouTube connected. Imported playlist entries will be removed after subtitles are saved.");
    } else if (searchParams.get("youtube_error")) {
      setBannerMessage(searchParams.get("youtube_error"));
    } else if (searchParams.get("drive_connected") === "true") {
      setBannerMessage("Google Drive connected. Completed subtitles will sync as the dashboard refreshes.");
    } else if (searchParams.get("drive_error")) {
      setBannerMessage(`Drive Connection Error: ${searchParams.get("drive_error")}`);
    }
  }, [searchParams]);

  // Auto-dismiss bannerMessage after 5s
  useEffect(() => {
    if (!bannerMessage) return;
    const timer = setTimeout(() => {
      setBannerMessage(null);
    }, 5000);
    return () => clearTimeout(timer);
  }, [bannerMessage]);

  // Auto-dismiss finished ingestion notices after 5s
  useEffect(() => {
    const finishedNotices = ingestionNotices.filter((n) => n.kind !== "running");
    if (finishedNotices.length === 0) return;

    const timer = setTimeout(() => {
      setIngestionNotices((prev) => prev.filter((item) => item.kind === "running"));
    }, 5000);

    return () => clearTimeout(timer);
  }, [ingestionNotices]);

  // Auto-dismiss toastMessage after 3s
  useEffect(() => {
    if (!toastMessage) return;
    const timer = setTimeout(() => {
      setToastMessage(null);
    }, 3000);
    return () => clearTimeout(timer);
  }, [toastMessage]);

  // Auto-clear copiedDriveId after 2s
  useEffect(() => {
    if (copiedDriveId === null) return;
    const timer = setTimeout(() => {
      setCopiedDriveId(null);
    }, 2000);
    return () => clearTimeout(timer);
  }, [copiedDriveId]);

  const loadTags = useCallback(async () => {
    if (!user) return;
    try {
      const tags = await api.videos.getTags();
      setAllTags(tags);
    } catch (err) {
      console.error("Failed to load tags:", err);
    }
  }, [user]);

  useEffect(() => {
    loadTags();
  }, [loadTags]);

  const loadVideos = useCallback(async (silent = false) => {
    if (!user) return;
    if (!silent) setLoading(true);
    try {
      const data = await api.videos.list({
        search: search.trim() || undefined,
        status: statusFilter,
        watch_status: watchStatusFilter,
        tag: tagFilter,
        page,
        page_size: 15,
      });
      setVideos(data.items);
      setTotal(data.total);
      setTotalPages(data.total_pages);
    } catch (err) {
      console.error("Failed to load videos:", err);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [user, search, statusFilter, watchStatusFilter, tagFilter, page]);

  useEffect(() => {
    loadVideos();
  }, [loadVideos]);

  // AC5: Dashboard polls only while queued processing exists (PROCESSING or PENDING videos)
  useEffect(() => {
    const hasActiveProcessing = videos.some(
      (v) => v.status === "PROCESSING" || v.status === "PENDING"
    );
    if (!hasActiveProcessing) return;

    const intervalId = setInterval(() => {
      loadVideos(true);
    }, 2500);

    return () => clearInterval(intervalId);
  }, [videos, loadVideos]);

  // Receive tag edits made on the paired app even when no download is active.
  useEffect(() => {
    if (!user || editingVideo || isIngestOpen) return;
    const refresh = () => {
      if (document.visibilityState === "visible") {
        void loadVideos(true);
        void loadTags();
      }
    };
    const interval = window.setInterval(refresh, 10000);
    window.addEventListener("focus", refresh);
    return () => { window.clearInterval(interval); window.removeEventListener("focus", refresh); };
  }, [user, editingVideo, isIngestOpen, loadVideos, loadTags]);

  const startIngestion = useCallback(
    (input: VideoIngestInput) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      setIngestionNotices((notices) => [
        { id, kind: "running", message: "Queuing video ingestion in the background…" },
        ...notices,
      ]);

      void api.videos
        .ingest(input)
        .then((response) => {
          const kind: IngestionNoticeKind =
            response.failed > 0
              ? response.processed > 0 || response.skipped_duplicates > 0
                ? "partial-failure"
                : "error"
              : "success";
          const message =
            response.failed > 0
              ? `Ingestion queued: ${response.processed} processing, ${response.failed} failed.`
              : `Ingestion queued: ${response.processed} processing, ${response.skipped_duplicates} duplicates skipped.`;
          setIngestionNotices((notices) =>
            notices.map((notice) => (notice.id === id ? { ...notice, kind, message } : notice))
          );
          void loadVideos();
          void loadTags();
        })
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : "Failed to ingest videos";
          setIngestionNotices((notices) =>
            notices.map((notice) => (notice.id === id ? { ...notice, kind: "error", message } : notice))
          );
        });
    },
    [loadVideos, loadTags]
  );

  const handleDelete = async (video: Video) => {
    const confirmed = confirm(
      `Are you sure you want to remove "${video.title}" from your library?\n\nNote: If this file was uploaded to Google Drive, the file in Google Drive will NOT be deleted.`
    );
    if (!confirmed) return;

    try {
      await api.videos.delete(video.id);
      loadVideos();
      loadTags();
    } catch (err: any) {
      alert(err.message || "Failed to delete video");
    }
  };

  const formatDuration = (seconds?: number | null) => {
    if (!seconds) return null;
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const handleCopyDriveLink = async (driveUrl: string, videoId: number) => {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(driveUrl);
      } else {
        const textarea = document.createElement("textarea");
        textarea.value = driveUrl;
        textarea.style.position = "fixed";
        textarea.style.left = "-9999px";
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
      }
      setCopiedDriveId(videoId);
      setToastMessage("Google Drive link copied to clipboard!");
    } catch (err) {
      console.error("Failed to copy link:", err);
      setToastMessage("Failed to copy link to clipboard.");
    }
  };

  const handleImportCaptions = async (video: Video, file: File) => {
    if (file.size > 2_000_000) {
      setToastMessage("Caption file must be 2 MB or smaller.");
      return;
    }
    setUploadingCaptionId(video.id);
    try {
      await api.videos.importCaptions(video.id, file);
      setToastMessage("English captions imported. SRT and Drive sync are ready.");
      await loadVideos(true);
    } catch (error) {
      setToastMessage(error instanceof Error ? error.message : "Could not import captions.");
    } finally {
      setUploadingCaptionId(null);
    }
  };

  const handleQuickWatchStatusChange = async (video: Video, newStatus: string) => {
    try {
      const updated = await api.videos.update(video.id, {
        watch_status: newStatus as any,
      });
      setVideos((prev) =>
        prev.map((v) => (v.id === video.id ? { ...v, watch_status: updated.watch_status } : v))
      );
      const label =
        newStatus === "TO_DO"
          ? "To do"
          : newStatus === "DOING"
          ? "Doing"
          : newStatus === "DONE"
          ? "Done"
          : newStatus;
      setToastMessage(`Watch status updated to "${label}"`);
    } catch (err: any) {
      console.error("Failed to update watch status:", err);
      setToastMessage(err.message || "Failed to update watch status");
    }
  };

  const getWatchStatusBadgeClass = (status: string) => {
    switch (status) {
      case "TO_DO":
        return "bg-amber-950/50 text-amber-300 border-amber-800/70 hover:bg-amber-900/60";
      case "DOING":
        return "bg-sky-950/50 text-sky-300 border-sky-800/70 hover:bg-sky-900/60";
      case "DONE":
        return "bg-emerald-950/50 text-emerald-300 border-emerald-800/70 hover:bg-emerald-900/60";
      default:
        return "bg-neutral-800 text-neutral-300 border-neutral-700";
    }
  };

  const getSubtitleStatusBadgeClass = (status: string) => {
    switch (status) {
      case "COMPLETED":
        return "bg-neutral-800 text-neutral-200 border-neutral-600";
      case "PROCESSING":
        return "bg-blue-950/40 text-blue-400 border-blue-800/50";
      case "NO_SUBTITLES":
        return "bg-neutral-800/80 text-neutral-400 border-neutral-700";
      case "FAILED":
        return "bg-rose-950/40 text-rose-300 border-rose-800/50";
      default:
        return "bg-neutral-800 text-neutral-400 border-neutral-700";
    }
  };

  if (authLoading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#212121]">
        <div className="w-8 h-8 border-4 border-neutral-400 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const isDriveError = Boolean(searchParams.get("drive_error"));

  return (
    <div className="min-h-screen bg-[#212121] text-neutral-100 flex flex-col">
      <Navbar
        onOpenIngest={() => setIsIngestOpen(true)}
      />

      <main className="max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-8 flex-1">
        {ingestionNotices.length > 0 && (
          <div className="space-y-2 mb-6" aria-live="polite">
            {ingestionNotices.map((notice) => (
              <div
                key={notice.id}
                className={`p-3 rounded-xl border text-sm flex items-center justify-between ${
                  notice.kind === "error"
                    ? "bg-rose-950/40 border-rose-800/60 text-rose-200"
                    : notice.kind === "partial-failure"
                    ? "bg-amber-950/40 border-amber-800/60 text-amber-200"
                    : "bg-neutral-800/90 border-neutral-700 text-neutral-200"
                }`}
              >
                <div className="flex items-center space-x-2">
                  {notice.kind === "running" ? (
                    <RotateCw className="w-4 h-4 animate-spin text-neutral-300 flex-shrink-0" />
                  ) : notice.kind === "error" ? (
                    <AlertCircle className="w-4 h-4 text-rose-400 flex-shrink-0" />
                  ) : notice.kind === "partial-failure" ? (
                    <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0" />
                  ) : (
                    <CheckCircle className="w-4 h-4 text-neutral-300 flex-shrink-0" />
                  )}
                  <span>{notice.message}</span>
                </div>
                <button
                  onClick={() => setIngestionNotices((notices) => notices.filter((item) => item.id !== notice.id))}
                  className="text-xs text-neutral-400 hover:text-neutral-200 hover:underline ml-4"
                >
                  Dismiss
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Drive OAuth callback notification banner */}
        {bannerMessage && (
          <div
            className={`mb-6 p-4 rounded-xl border text-sm flex items-center justify-between ${
              isDriveError
                ? "bg-rose-950/40 border-rose-800/60 text-rose-200"
                : "bg-neutral-800/90 border-neutral-700 text-neutral-200"
            }`}
          >
            <div className="flex items-center space-x-2">
              {isDriveError ? (
                <AlertCircle className="w-5 h-5 text-rose-400 flex-shrink-0" />
              ) : (
                <CheckCircle className="w-5 h-5 text-neutral-300 flex-shrink-0" />
              )}
              <span>{bannerMessage}</span>
            </div>
            <button
              onClick={() => setBannerMessage(null)}
              className={`text-xs hover:underline font-medium ${
                isDriveError ? "text-rose-400 hover:text-rose-300" : "text-neutral-400 hover:text-neutral-300"
              }`}
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Channel Tags Filter Bar (Pills) */}
        <div className="flex items-center space-x-2 mb-4 overflow-x-auto pb-1.5 text-xs scrollbar-thin">
          <div className="flex items-center space-x-1 text-neutral-400 font-medium flex-shrink-0 mr-1">
            <Tag className="w-3.5 h-3.5 text-neutral-400" />
            <span>Video Tags:</span>
          </div>
          <button
            onClick={() => {
              setTagFilter("ALL");
              setPage(1);
            }}
            className={`px-3 py-1 rounded-full text-xs font-medium transition flex-shrink-0 ${
              tagFilter === "ALL"
                ? "bg-white text-neutral-900 shadow-sm font-semibold"
                : "bg-[#262626] text-neutral-300 hover:bg-neutral-800 border border-neutral-700"
            }`}
          >
            All Tags
          </button>
          {allTags.map((tag) => (
            <button
              key={tag}
              onClick={() => {
                setTagFilter(tagFilter === tag ? "ALL" : tag);
                setPage(1);
              }}
              className={`px-3 py-1 rounded-full text-xs font-medium transition flex items-center space-x-1 flex-shrink-0 ${
                tagFilter === tag
                  ? "bg-neutral-200 text-neutral-900 shadow-sm font-semibold"
                  : "bg-[#262626] text-neutral-300 hover:bg-neutral-800 border border-neutral-700"
              }`}
            >
              <span>#{tag}</span>
            </button>
          ))}
          {allTags.length === 0 ? (
            <span className="text-neutral-500 text-xs italic">
              Choose video tags when adding a video, or edit a video record.
            </span>
          ) : null}

          {/* Shortcut to open Channels manager */}
          <a
            href="/dashboard/channels"
            className="px-2.5 py-1 rounded-full text-xs text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800 border border-dashed border-neutral-700 transition flex items-center space-x-1 flex-shrink-0 ml-auto"
            title="Browse channels"
          >
            <Tv className="w-3 h-3 text-neutral-400" />
            <span>Browse Channels</span>
          </a>
        </div>

        {/* Toolbar: Search, Filter, Stats */}
        <div className="bg-[#262626] p-4 rounded-2xl border border-neutral-800 shadow-sm mb-6 flex flex-col lg:flex-row gap-4 items-center justify-between">
          {/* Search Box */}
          <div className="relative w-full lg:w-80">
            <Search className="w-4 h-4 text-neutral-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="Search by title, channel..."
              className="w-full pl-10 pr-10 py-2 text-sm bg-[#1a1a1a] text-neutral-100 placeholder-neutral-500 border border-neutral-700 rounded-xl focus:ring-2 focus:ring-neutral-500/50 focus:border-neutral-400 focus:outline-none transition"
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-neutral-400 hover:text-neutral-200"
              >
                Clear
              </button>
            )}
          </div>

          {/* Watch Status & Subtitle Filter & Refresh */}
          <div className="flex items-center flex-wrap gap-3 w-full lg:w-auto justify-between lg:justify-end">
            {/* Watch status filter */}
            <div className="flex items-center space-x-2 text-xs text-neutral-400 font-medium">
              <span>Watch:</span>
              <select
                value={watchStatusFilter}
                onChange={(e) => {
                  setWatchStatusFilter(e.target.value);
                  setPage(1);
                }}
                className="px-3 py-1.5 border border-neutral-700 rounded-xl text-xs text-neutral-200 bg-[#1a1a1a] focus:outline-none focus:ring-2 focus:ring-neutral-500/50 focus:border-neutral-400"
              >
                <option value="ALL" className="bg-[#262626] text-neutral-200">All Watch Status</option>
                <option value="TO_DO" className="bg-[#262626] text-neutral-200">To do</option>
                <option value="DOING" className="bg-[#262626] text-neutral-200">Doing</option>
                <option value="DONE" className="bg-[#262626] text-neutral-200">Done</option>
              </select>
            </div>

            {/* Subtitle status filter */}
            <div className="flex items-center space-x-2 text-xs text-neutral-400 font-medium">
              <span>Subtitles:</span>
              <select
                value={statusFilter}
                onChange={(e) => {
                  setStatusFilter(e.target.value);
                  setPage(1);
                }}
                className="px-3 py-1.5 border border-neutral-700 rounded-xl text-xs text-neutral-200 bg-[#1a1a1a] focus:outline-none focus:ring-2 focus:ring-neutral-500/50 focus:border-neutral-400"
              >
                <option value="ALL" className="bg-[#262626] text-neutral-200">All Subtitles</option>
                <option value="COMPLETED" className="bg-[#262626] text-neutral-200">Completed (Subtitles Ready)</option>
                <option value="PROCESSING" className="bg-[#262626] text-neutral-200">Processing</option>
                <option value="NO_SUBTITLES" className="bg-[#262626] text-neutral-200">No Subtitles</option>
                <option value="FAILED" className="bg-[#262626] text-neutral-200">Failed</option>
                <option value="PENDING" className="bg-[#262626] text-neutral-200">Pending</option>
              </select>
            </div>

            <button
              onClick={() => {
                loadVideos();
                loadTags();
              }}
              className="p-2 text-neutral-400 hover:text-neutral-100 hover:bg-neutral-800 rounded-xl transition"
              title="Refresh list"
            >
              <RotateCw className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Video Table / Grid */}
        {loading ? (
          <div className="flex flex-col items-center justify-center py-24 text-neutral-400">
            <div className="w-8 h-8 border-4 border-neutral-400 border-t-transparent rounded-full animate-spin mb-3" />
            <p className="text-sm">Loading videos...</p>
          </div>
        ) : videos.length === 0 ? (
          <div className="text-center py-20 bg-[#262626] rounded-2xl border border-dashed border-neutral-800 p-8">
            <div className="w-12 h-12 rounded-2xl bg-neutral-800 text-neutral-400 flex items-center justify-center mx-auto mb-3">
              <FileText className="w-6 h-6" />
            </div>
            <h3 className="font-bold text-neutral-200 text-base mb-1">No videos found</h3>
            <p className="text-xs text-neutral-400 max-w-sm mx-auto mb-4">
              {search || statusFilter !== "ALL" || watchStatusFilter !== "ALL" || tagFilter !== "ALL"
                ? "Try adjusting your search query, watch status, subtitle status, or tag filter."
                : "Your library is empty. Start by ingesting a YouTube video or playlist."}
            </p>
            <button
              onClick={() => setIsIngestOpen(true)}
              className="px-4 py-2 bg-white hover:bg-neutral-200 text-neutral-900 text-xs font-medium rounded-xl shadow-sm transition"
            >
              + Ingest First Video
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="text-xs text-neutral-400 px-1 flex justify-between items-center">
              <span>Showing {videos.length} of {total} videos</span>
            </div>

            <div className="bg-[#262626] rounded-2xl border border-neutral-800 shadow-sm overflow-hidden divide-y divide-neutral-800">
              {videos.map((video) => (
                <div
                  key={video.id}
                  className="p-4 sm:p-5 flex flex-col md:flex-row items-start md:items-center justify-between gap-4 hover:bg-neutral-800/40 transition"
                >
                  {/* Left: Thumbnail & Details */}
                  <div className="flex items-start space-x-4 min-w-0 flex-1">
                    {/* Thumbnail */}
                    <div className="relative w-28 h-18 sm:w-36 sm:h-20 bg-[#1a1a1a] rounded-xl overflow-hidden flex-shrink-0 border border-neutral-800">
                      {video.thumbnail_url ? (
                        <img
                          src={video.thumbnail_url}
                          alt={video.title}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-neutral-600">
                          <Clapperboard className="w-8 h-8" />
                        </div>
                      )}
                      {video.duration && (
                        <span className="absolute bottom-1 right-1 bg-black/80 text-neutral-200 text-[10px] px-1.5 py-0.5 rounded font-mono flex items-center space-x-0.5">
                          <Clock className="w-2.5 h-2.5" />
                          <span>{formatDuration(video.duration)}</span>
                        </span>
                      )}
                    </div>

                    {/* Metadata */}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center space-x-2">
                        <a
                          href={video.youtube_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-bold text-sm text-neutral-100 hover:text-white line-clamp-1 group transition"
                        >
                          <span>{video.title}</span>
                          <ExternalLink className="w-3 h-3 inline ml-1 opacity-0 group-hover:opacity-100 transition" />
                        </a>
                      </div>

                      <div className="flex items-center flex-wrap gap-1.5 mt-0.5">
                        <a
                          href={
                            video.channel_url ||
                            `https://www.youtube.com/results?search_query=${encodeURIComponent(
                              video.channel_title || ""
                            )}`
                          }
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-neutral-400 hover:text-neutral-200 transition group inline-flex items-center space-x-1"
                          title={
                            video.channel_title
                              ? `Open ${video.channel_title} on YouTube`
                              : "Open Channel on YouTube"
                          }
                        >
                          <span className="line-clamp-1">{video.channel_title || "Unknown Channel"}</span>
                          <ExternalLink className="w-2.5 h-2.5 inline opacity-0 group-hover:opacity-100 transition" />
                        </a>

                        {/* Video tags */}
                        {videoTags(video).length ? (
                          videoTags(video).map((t) => {
                            const cleanTag = t.trim().replace(/^#/, "");
                            if (!cleanTag) return null;
                            return (
                              <button
                                key={cleanTag}
                                onClick={() => {
                                  setTagFilter(cleanTag);
                                  setPage(1);
                                }}
                                className={`px-1.5 py-0.5 rounded text-[10px] font-medium border transition ${
                                  tagFilter === cleanTag
                                    ? "bg-white text-neutral-900 border-white shadow-sm font-semibold"
                                    : "bg-neutral-800 text-neutral-300 border-neutral-700 hover:border-neutral-500"
                                }`}
                                title={`Filter videos by tag #${cleanTag}`}
                              >
                                #{cleanTag}
                              </button>
                            );
                          })
                        ) : null}

                        <button
                          onClick={() => setEditingVideo(video)}
                          className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] text-neutral-400 hover:text-neutral-100"
                          title={`Edit tags for ${video.title}`}
                          aria-label={`Edit tags for ${video.title}`}
                        >
                          <Tag className="h-3 w-3" />
                          Edit tags
                        </button>

                      </div>

                      {/* Badges */}
                      <div className="flex flex-wrap items-center gap-1.5 mt-2">
                        {/* Watch Status Selector ("To do, Doing, Done") */}
                        <div className="relative inline-block">
                          <select
                            value={video.watch_status || "TO_DO"}
                            onChange={(e) => handleQuickWatchStatusChange(video, e.target.value)}
                            className={`appearance-none cursor-pointer pl-2.5 pr-5 py-0.5 rounded-full text-[10px] font-semibold tracking-wider border focus:outline-none transition ${getWatchStatusBadgeClass(
                              video.watch_status || "TO_DO"
                            )}`}
                            title="Watch status: Click to change (To do, Doing, Done)"
                          >
                            <option value="TO_DO" className="bg-[#262626] text-neutral-100">To do</option>
                            <option value="DOING" className="bg-[#262626] text-neutral-100">Doing</option>
                            <option value="DONE" className="bg-[#262626] text-neutral-100">Done</option>
                          </select>
                          <span className="pointer-events-none absolute inset-y-0 right-1.5 flex items-center text-[8px] text-neutral-400">
                            ▾
                          </span>
                        </div>

                        {/* Subtitle Processing Status Badge */}
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider border flex items-center space-x-1 ${getSubtitleStatusBadgeClass(
                            video.status
                          )}`}
                          title="Subtitle download status"
                        >
                          {video.status === "PROCESSING" && !requiresYouTubeVerification(video) && (
                            <RotateCw className="w-2.5 h-2.5 animate-spin mr-1 inline-block" />
                          )}
                          <span>{video.status === "COMPLETED" ? "Subtitles Ready" : video.status === "PROCESSING" && requiresYouTubeVerification(video) ? "Waiting on YouTube" : video.status}</span>
                        </span>

                        {/* Retry counter badge */}
                        {video.retry_count > 0 && (
                          <span className="px-2 py-0.5 rounded-full bg-amber-950/40 border border-amber-800/50 text-amber-300 text-[10px] font-medium">
                            Retry #{video.retry_count}
                          </span>
                        )}

                        {/* Progress or retry message */}
                        {video.status === "PROCESSING" && requiresYouTubeVerification(video) && (
                          <span className="px-2 py-0.5 rounded-full bg-amber-950/40 border border-amber-800/50 text-amber-200 text-[10px] font-medium" title={video.error_message || undefined}>
                            YouTube verification required. Try Import VTT/SRT; automatic retry continues later.
                          </span>
                        )}
                        {video.status === "PROCESSING" && !requiresYouTubeVerification(video) && (video.progress_message || video.error_message) && (
                          <span
                            className="px-2 py-0.5 rounded-full bg-blue-950/30 border border-blue-800/40 text-blue-300 text-[10px] truncate max-w-sm"
                            title={video.progress_message || video.error_message || undefined}
                          >
                            {video.progress_message || video.error_message}
                          </span>
                        )}

                        {/* Subtitle type */}
                        {video.subtitle_type !== "NONE" && (
                          <span className="px-2 py-0.5 rounded-full bg-neutral-800 border border-neutral-700 text-neutral-300 text-[10px] font-medium">
                            {video.subtitle_type} Captions
                          </span>
                        )}

                        {/* Error preview if any */}
                        {video.error_message && video.status !== "PROCESSING" && (
                          <span
                            className="px-2 py-0.5 rounded-full bg-rose-950/40 border border-rose-800/50 text-rose-300 text-[10px] truncate max-w-xs cursor-help"
                            title={video.error_message}
                          >
                            Error: {video.error_message}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Right: External Links & Action Buttons */}
                  <div className="flex items-center flex-wrap gap-2 w-full md:w-auto justify-end border-t md:border-t-0 pt-3 md:pt-0 border-neutral-800">
                    {video.status !== "COMPLETED" && (
                      <label className={`flex items-center space-x-1.5 px-3 py-1.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 border border-neutral-700 rounded-xl text-xs font-medium transition ${uploadingCaptionId === video.id ? "opacity-60 pointer-events-none" : "cursor-pointer"}`} title="Import an English VTT or SRT caption file">
                        {uploadingCaptionId === video.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                        <span>{uploadingCaptionId === video.id ? "Importing…" : "Import VTT/SRT"}</span>
                        <input
                          type="file"
                          className="sr-only"
                          accept=".vtt,.srt,text/vtt,application/x-subrip"
                          disabled={uploadingCaptionId === video.id}
                          onChange={(event) => {
                            const file = event.currentTarget.files?.[0];
                            event.currentTarget.value = "";
                            if (file) void handleImportCaptions(video, file);
                          }}
                        />
                      </label>
                    )}
                    {/* Google Drive link */}
                    {video.drive_file_url ? (
                      <a
                        href={video.drive_file_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center space-x-1.5 px-3 py-1.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 border border-neutral-700 rounded-xl text-xs font-medium transition"
                        title="View subtitle in Google Drive"
                      >
                        <HardDrive className="w-3.5 h-3.5 text-neutral-400" />
                        <span>Google Drive</span>
                        <ExternalLink className="w-3 h-3 text-neutral-400" />
                      </a>
                    ) : (
                      <span className="text-neutral-500 text-xs px-2 py-1">No Drive file</span>
                    )}

                    {sharedPromptLink ? <a href={sharedPromptLink} target="_blank" rel="noopener noreferrer" className="flex items-center space-x-1.5 px-3 py-1.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 border border-neutral-700 rounded-xl text-xs font-medium transition" title="Open the shared ChatGPT prompt link"><MessageSquare className="w-3.5 h-3.5 text-neutral-400" /><span>Prompt</span><ExternalLink className="w-3 h-3 text-neutral-400" /></a> : null}

                    {/* Original per-video ChatGPT link */}
                    {video.chatgpt_link ? (
                      <a
                        href={video.chatgpt_link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center space-x-1.5 px-3 py-1.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 border border-neutral-700 rounded-xl text-xs font-medium transition"
                        title="Open ChatGPT conversation"
                      >
                        <MessageSquare className="w-3.5 h-3.5 text-neutral-400" />
                        <span>ChatGPT</span>
                        <ExternalLink className="w-3 h-3 text-neutral-400" />
                      </a>
                    ) : null}

                    {video.drive_file_url && (
                      <button
                        onClick={() => handleCopyDriveLink(video.drive_file_url!, video.id)}
                        className="p-2 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 hover:text-white border border-neutral-700 rounded-xl text-xs transition"
                        title="Copy Google Drive link"
                      >
                        {copiedDriveId === video.id ? (
                          <Check className="w-3.5 h-3.5 text-emerald-400" />
                        ) : (
                          <Copy className="w-3.5 h-3.5 text-neutral-400" />
                        )}
                      </button>
                    )}

                    {/* Edit button */}
                    <button
                      onClick={() => setEditingVideo(video)}
                      className="p-2 text-neutral-400 hover:text-neutral-100 hover:bg-neutral-800 rounded-xl transition"
                      title="Edit video status or tags"
                    >
                      <Edit className="w-4 h-4" />
                    </button>

                    {/* Delete button (leaves Drive intact) */}
                    <button
                      onClick={() => handleDelete(video)}
                      className="p-2 text-neutral-400 hover:text-rose-400 hover:bg-neutral-800 rounded-xl transition"
                      title="Delete from library (leaves Google Drive file intact)"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between pt-4 px-2">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  className="px-3 py-1.5 text-xs font-medium text-neutral-300 bg-neutral-800 border border-neutral-700 rounded-xl hover:bg-neutral-700 disabled:opacity-40 transition"
                >
                  Previous
                </button>
                <span className="text-xs text-neutral-400">
                  Page {page} of {totalPages}
                </span>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                  className="px-3 py-1.5 text-xs font-medium text-neutral-300 bg-neutral-800 border border-neutral-700 rounded-xl hover:bg-neutral-700 disabled:opacity-40 transition"
                >
                  Next
                </button>
              </div>
            )}
          </div>
        )}
      </main>

      {/* Ingest Modal */}
      <IngestModal
        isOpen={isIngestOpen}
        onClose={() => setIsIngestOpen(false)}
        onStart={startIngestion}
      />

      {/* Edit Modal */}
      <EditModal
        video={editingVideo}
        isOpen={Boolean(editingVideo)}
        allTags={allTags}
        onClose={() => setEditingVideo(null)}
        onUpdated={() => {
          loadVideos();
          loadTags();
        }}
      />

    </div>
  );
}

export default function DashboardPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-[#212121]">
          <div className="w-8 h-8 border-4 border-neutral-400 border-t-transparent rounded-full animate-spin" />
        </div>
      }
    >
      <DashboardContent />
    </Suspense>
  );
}
