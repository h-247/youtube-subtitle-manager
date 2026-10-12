"use client";

import React, { useState, useEffect } from "react";
import { Video, VideoStatus, WatchStatus } from "../types";
import { api } from "../lib/api";
import { X, Loader2, MessageSquare, ExternalLink, Tag, Plus, Check } from "lucide-react";

interface EditModalProps {
  video: Video | null;
  isOpen: boolean;
  onClose: () => void;
  onUpdated: (updated: Video) => void;
  allTags?: string[];
}

export default function EditModal({
  video,
  isOpen,
  onClose,
  onUpdated,
  allTags = [],
}: EditModalProps) {
  const [watchStatus, setWatchStatus] = useState<WatchStatus>("TO_DO");
  const [subtitleStatus, setSubtitleStatus] = useState<VideoStatus>("COMPLETED");
  const [channelTags, setChannelTags] = useState("");
  const [chatgptLink, setChatgptLink] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (video) {
      setWatchStatus(video.watch_status || "TO_DO");
      setSubtitleStatus(video.status);
      setChannelTags(video.channel_tags || "");
      setChatgptLink(video.chatgpt_link || "");
      setError(null);
    }
  }, [video]);

  if (!isOpen || !video) return null;

  const currentTagList = channelTags
    .split(",")
    .map((t) => t.trim().replace(/^#/, "").toLowerCase())
    .filter(Boolean);

  const handleToggleTag = (tag: string) => {
    const clean = tag.trim().replace(/^#/, "").toLowerCase();
    if (!clean) return;
    if (currentTagList.includes(clean)) {
      const next = currentTagList.filter((t) => t !== clean);
      setChannelTags(next.join(", "));
    } else {
      const next = [...currentTagList, clean];
      setChannelTags(next.join(", "));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);

    try {
      const updated = await api.videos.update(video.id, {
        watch_status: watchStatus,
        status: subtitleStatus,
        channel_tags: channelTags.trim() || null,
        chatgpt_link: chatgptLink.trim() || null,
      });
      onUpdated(updated);
      onClose();
    } catch (err: any) {
      setError(err.message || "Failed to update video record");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="bg-[#262626] rounded-2xl shadow-2xl max-w-lg w-full p-6 relative border border-neutral-800 text-neutral-100 my-8">
        <button
          onClick={onClose}
          className="absolute top-5 right-5 text-neutral-400 hover:text-neutral-100 transition"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center space-x-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-neutral-800 text-neutral-100 border border-neutral-700/80 flex items-center justify-center">
            <MessageSquare className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-neutral-100">Edit Video Record</h2>
            <p className="text-xs text-neutral-400 truncate max-w-sm">{video.title}</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Watch Status */}
          <div>
            <label className="block text-xs font-semibold text-neutral-300 uppercase mb-1">
              Watch Status
            </label>
            <select
              value={watchStatus}
              onChange={(e) => setWatchStatus(e.target.value as WatchStatus)}
              className="w-full px-3 py-2 text-sm bg-[#1a1a1a] border border-neutral-700 rounded-xl text-neutral-100 focus:ring-2 focus:ring-neutral-500/50 focus:border-neutral-400 focus:outline-none"
            >
              <option value="TO_DO" className="bg-[#262626] text-neutral-100">To do</option>
              <option value="DOING" className="bg-[#262626] text-neutral-100">Doing</option>
              <option value="DONE" className="bg-[#262626] text-neutral-100">Done</option>
            </select>
          </div>

          {/* Channel Tags */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-xs font-semibold text-neutral-300 uppercase flex items-center space-x-1">
                <Tag className="w-3.5 h-3.5 text-neutral-400 mr-1 inline" />
                <span>Channel Tags ({video.channel_title || "Channel"})</span>
              </label>
            </div>

            {/* Quick toggle from existing tags */}
            {allTags.length > 0 && (
              <div className="mb-2">
                <div className="text-[11px] text-neutral-400 mb-1">
                  Click existing tag to toggle:
                </div>
                <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto">
                  {allTags.map((tag) => {
                    const isSelected = currentTagList.includes(tag.toLowerCase());
                    return (
                      <button
                        key={tag}
                        type="button"
                        onClick={() => handleToggleTag(tag)}
                        className={`px-2 py-0.5 rounded text-xs font-medium border transition flex items-center space-x-1 ${
                          isSelected
                            ? "bg-white text-neutral-900 border-white font-semibold"
                            : "bg-neutral-800 text-neutral-400 border-neutral-700 hover:text-neutral-200 hover:border-neutral-500"
                        }`}
                      >
                        {isSelected ? (
                          <Check className="w-3 h-3 text-neutral-900" />
                        ) : (
                          <Plus className="w-3 h-3 text-neutral-400" />
                        )}
                        <span>#{tag}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <input
              type="text"
              value={channelTags}
              onChange={(e) => setChannelTags(e.target.value)}
              placeholder="e.g. en, it, ss..."
              className="w-full px-3 py-2 text-sm bg-[#1a1a1a] border border-neutral-700 rounded-xl text-neutral-100 placeholder-neutral-500 focus:ring-2 focus:ring-neutral-500/50 focus:border-neutral-400 focus:outline-none transition"
            />
            <p className="text-[11px] text-neutral-400 mt-1">
              Comma-separated tags for this channel. All videos from this channel will share these tags.
            </p>
          </div>

          {/* Subtitle status */}
          <div>
            <label className="block text-xs font-semibold text-neutral-300 uppercase mb-1">
              Subtitle Status
            </label>
            <select
              value={subtitleStatus}
              onChange={(e) => setSubtitleStatus(e.target.value as VideoStatus)}
              className="w-full px-3 py-2 text-sm bg-[#1a1a1a] border border-neutral-700 rounded-xl text-neutral-100 focus:ring-2 focus:ring-neutral-500/50 focus:border-neutral-400 focus:outline-none"
            >
              <option value="COMPLETED" className="bg-[#262626] text-neutral-100">COMPLETED</option>
              <option value="PROCESSING" className="bg-[#262626] text-neutral-100">PROCESSING</option>
              <option value="NO_SUBTITLES" className="bg-[#262626] text-neutral-100">NO_SUBTITLES</option>
              <option value="FAILED" className="bg-[#262626] text-neutral-100">FAILED</option>
              <option value="PENDING" className="bg-[#262626] text-neutral-100">PENDING</option>
            </select>
          </div>

          {/* ChatGPT Link */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-xs font-semibold text-neutral-300 uppercase">
                ChatGPT Conversation Link
              </label>
              {chatgptLink && (
                <a
                  href={chatgptLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-neutral-300 hover:text-white hover:underline flex items-center space-x-1"
                >
                  <span>Test Link</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              )}
            </div>
            <input
              type="url"
              value={chatgptLink}
              onChange={(e) => setChatgptLink(e.target.value)}
              placeholder="https://chatgpt.com/c/..."
              className="w-full px-3 py-2 text-sm bg-[#1a1a1a] border border-neutral-700 rounded-xl text-neutral-100 placeholder-neutral-500 focus:ring-2 focus:ring-neutral-500/50 focus:border-neutral-400 focus:outline-none transition"
            />
            <p className="text-[11px] text-neutral-400 mt-1">
              Store a link to the ChatGPT conversation created using these subtitles.
            </p>
          </div>

          {error && (
            <div className="p-3 bg-rose-950/40 border border-rose-800/60 text-rose-300 rounded-xl text-xs">{error}</div>
          )}

          <div className="flex justify-end space-x-3 pt-3 border-t border-neutral-800">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="px-4 py-2 text-sm text-neutral-300 hover:bg-neutral-800 rounded-xl transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex items-center space-x-2 px-5 py-2 text-sm font-medium text-neutral-900 bg-white hover:bg-neutral-200 disabled:opacity-50 rounded-xl transition shadow-sm"
            >
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}
              <span>{saving ? "Saving..." : "Save Changes"}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
