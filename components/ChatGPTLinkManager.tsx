"use client";

import { useState } from "react";
import { ExternalLink, Loader2, MessageSquare, Save, X } from "lucide-react";
import { api } from "../lib/api";
import { Video } from "../types";

export default function ChatGPTLinkManager({
  videos,
  onClose,
  onUpdated,
}: {
  videos: Video[];
  onClose: () => void;
  onUpdated: (video: Video) => void;
}) {
  const [links, setLinks] = useState<Record<number, string>>(() =>
    Object.fromEntries(videos.map((video) => [video.id, video.chatgpt_prompt_link || ""]))
  );
  const [savingId, setSavingId] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [savedId, setSavedId] = useState<number | null>(null);

  const saveLink = async (video: Video) => {
    const value = links[video.id]?.trim() || "";
    if (value) {
      try {
        const parsed = new URL(value);
        if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error("Invalid protocol");
      } catch {
        setError("Enter a valid HTTP or HTTPS ChatGPT link.");
        return;
      }
    }
    setSavingId(video.id);
    setError("");
    setSavedId(null);
    try {
      const updated = await api.videos.update(video.id, {
        chatgpt_prompt_link: value || null,
      });
      onUpdated(updated);
      setLinks((current) => ({ ...current, [video.id]: updated.chatgpt_prompt_link || "" }));
      setSavedId(video.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save ChatGPT link.");
    } finally {
      setSavingId(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <section
        role="dialog"
        aria-modal="true"
        aria-label="Manage ChatGPT links"
        className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-neutral-700 bg-[#262626] p-5 text-neutral-100 shadow-2xl sm:p-6"
      >
        <div className="mb-1 flex items-start justify-between gap-4">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-bold">
              <MessageSquare className="h-5 w-5 text-neutral-300" />
              ChatGPT Prompt Links
            </h2>
            <p className="mt-1 text-xs text-neutral-400">
              Add or edit a link for each video shown on this page. Saved links appear beside Google Drive on the video row.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-neutral-400 hover:bg-neutral-800 hover:text-white"
            aria-label="Close ChatGPT link manager"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {error && <p role="alert" className="my-3 rounded-lg border border-rose-900 bg-rose-950/40 p-3 text-sm text-rose-300">{error}</p>}

        <div className="mt-4 divide-y divide-neutral-800 rounded-xl border border-neutral-800">
          {videos.map((video) => (
            <div key={video.id} className="grid gap-3 p-3 sm:grid-cols-[minmax(0,1fr)_minmax(16rem,1.4fr)_auto] sm:items-center sm:p-4">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium" title={video.title}>{video.title}</p>
                <p className="mt-0.5 truncate text-xs text-neutral-500">{video.channel_title || "Unknown channel"}</p>
              </div>
              <div className="flex min-w-0 items-center gap-2">
                <input
                  type="url"
                  value={links[video.id] || ""}
                  onChange={(event) => setLinks((current) => ({ ...current, [video.id]: event.target.value }))}
                  placeholder="https://chatgpt.com/c/..."
                  aria-label={`ChatGPT prompt link for ${video.title}`}
                  className="min-w-0 flex-1 rounded-lg border border-neutral-700 bg-[#191919] px-3 py-2 text-xs text-neutral-100 outline-none placeholder:text-neutral-500 focus:border-neutral-400"
                />
                {video.chatgpt_prompt_link && (
                  <a href={video.chatgpt_prompt_link} target="_blank" rel="noopener noreferrer" title="Open saved ChatGPT prompt link" className="shrink-0 text-neutral-400 hover:text-white">
                    <ExternalLink className="h-4 w-4" />
                  </a>
                )}
              </div>
              <button
                type="button"
                onClick={() => void saveLink(video)}
                disabled={savingId !== null}
                className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-white px-3 py-2 text-xs font-medium text-neutral-900 hover:bg-neutral-200 disabled:opacity-50"
              >
                {savingId === video.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                {savedId === video.id ? "Saved" : savingId === video.id ? "Saving…" : "Save link"}
              </button>
            </div>
          ))}
          {videos.length === 0 && <p className="p-4 text-sm text-neutral-400">No videos are available on this page.</p>}
        </div>

        <div className="mt-4 flex justify-end">
          <button type="button" onClick={onClose} className="rounded-lg border border-neutral-700 px-4 py-2 text-sm text-neutral-300 hover:bg-neutral-800">Close</button>
        </div>
      </section>
    </div>
  );
}
