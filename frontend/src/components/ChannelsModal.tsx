"use client";

import React, { useState, useEffect } from "react";
import { ChannelItem } from "../types";
import { api } from "../lib/api";
import {
  X,
  Search,
  Tag,
  ExternalLink,
  Loader2,
  Plus,
  Check,
  Tv,
  Film,
  Edit2,
} from "lucide-react";

interface ChannelsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectTagFilter?: (tag: string) => void;
  onChannelsChanged?: () => void;
  allTags: string[];
}

export default function ChannelsModal({
  isOpen,
  onClose,
  onSelectTagFilter,
  onChannelsChanged,
  allTags,
}: ChannelsModalProps) {
  const [channels, setChannels] = useState<ChannelItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Editing state for a specific channel
  const [editingChannel, setEditingChannel] = useState<string | null>(null);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [newTagInput, setNewTagInput] = useState("");
  const [savingTags, setSavingTags] = useState(false);

  useEffect(() => {
    if (isOpen) {
      loadChannels();
      setEditingChannel(null);
      setError(null);
    }
  }, [isOpen]);

  const loadChannels = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.videos.getChannels();
      setChannels(data);
    } catch (err: any) {
      setError(err.message || "Failed to load channels");
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  const handleStartEdit = (channel: ChannelItem) => {
    setEditingChannel(channel.channel_title);
    setSelectedTags(channel.tags || []);
    setNewTagInput("");
  };

  const handleCancelEdit = () => {
    setEditingChannel(null);
    setSelectedTags([]);
    setNewTagInput("");
  };

  const handleToggleTag = (tag: string) => {
    const normalized = tag.trim().replace(/^#/, "").toLowerCase();
    if (!normalized) return;
    if (selectedTags.includes(normalized)) {
      setSelectedTags(selectedTags.filter((t) => t !== normalized));
    } else {
      setSelectedTags([...selectedTags, normalized]);
    }
  };

  const handleAddNewTag = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const clean = newTagInput.trim().replace(/^#/, "").toLowerCase();
    if (clean && !selectedTags.includes(clean)) {
      setSelectedTags([...selectedTags, clean]);
    }
    setNewTagInput("");
  };

  const handleSaveTags = async (channelTitle: string) => {
    setSavingTags(true);
    try {
      const tagsStr = selectedTags.join(", ");
      await api.videos.setChannelTags(channelTitle, tagsStr);
      // Update local state
      setChannels((prev) =>
        prev.map((c) =>
          c.channel_title === channelTitle
            ? { ...c, tags: selectedTags, channel_tags: tagsStr || null }
            : c
        )
      );
      setEditingChannel(null);
      if (onChannelsChanged) {
        onChannelsChanged();
      }
    } catch (err: any) {
      alert(err.message || "Failed to update channel tags");
    } finally {
      setSavingTags(false);
    }
  };

  const filteredChannels = channels.filter((c) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    if (c.channel_title.toLowerCase().includes(q)) return true;
    return c.tags.some((t) => t.toLowerCase().includes(q));
  });

  // Combine all distinct tags from props + channels
  const combinedExistingTags = Array.from(
    new Set([...allTags, ...channels.flatMap((c) => c.tags)])
  ).sort();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="bg-[#262626] rounded-2xl shadow-2xl max-w-2xl w-full p-6 relative border border-neutral-800 text-neutral-100 max-h-[90vh] flex flex-col">
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-5 right-5 text-neutral-400 hover:text-neutral-100 transition"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Header */}
        <div className="flex items-center space-x-3 mb-5">
          <div className="w-10 h-10 rounded-xl bg-neutral-800 text-neutral-100 border border-neutral-700/80 flex items-center justify-center shadow-sm">
            <Tv className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-neutral-100">Channels & Tags</h2>
            <p className="text-xs text-neutral-400">
              View ingested channels and assign tags to easily filter videos
            </p>
          </div>
        </div>

        {/* Search Bar */}
        <div className="relative mb-4">
          <Search className="w-4 h-4 text-neutral-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search channels or tags..."
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

        {/* Content list */}
        <div className="flex-1 overflow-y-auto space-y-3 pr-1 scrollbar-thin">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-12 text-neutral-400">
              <Loader2 className="w-6 h-6 animate-spin mb-2" />
              <p className="text-xs">Loading channels...</p>
            </div>
          ) : error ? (
            <div className="p-4 bg-rose-950/40 border border-rose-800/60 text-rose-300 rounded-xl text-xs">
              {error}
            </div>
          ) : filteredChannels.length === 0 ? (
            <div className="text-center py-12 bg-[#1a1a1a] rounded-xl border border-neutral-800 p-6">
              <Film className="w-8 h-8 text-neutral-600 mx-auto mb-2" />
              <p className="text-sm font-medium text-neutral-300">
                {search ? "No matching channels found" : "No channels in library yet"}
              </p>
              <p className="text-xs text-neutral-500 mt-1">
                {search
                  ? "Try searching with a different term."
                  : "Ingest videos to automatically populate channels."}
              </p>
            </div>
          ) : (
            filteredChannels.map((channel) => {
              const isEditing = editingChannel === channel.channel_title;

              return (
                <div
                  key={channel.channel_title}
                  className="p-4 rounded-xl bg-[#1e1e1e] border border-neutral-800 hover:border-neutral-700 transition"
                >
                  <div className="flex items-start justify-between gap-3">
                    {/* Left: Channel Info */}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center space-x-2">
                        <a
                          href={
                            channel.channel_url ||
                            `https://www.youtube.com/results?search_query=${encodeURIComponent(
                              channel.channel_title
                            )}`
                          }
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-semibold text-sm text-neutral-100 hover:text-white transition group inline-flex items-center space-x-1"
                          title="Open Channel on YouTube"
                        >
                          <span className="truncate">{channel.channel_title}</span>
                          <ExternalLink className="w-3 h-3 opacity-0 group-hover:opacity-100 transition" />
                        </a>
                        <span className="text-[11px] px-2 py-0.5 rounded-full bg-neutral-800 text-neutral-400 border border-neutral-700">
                          {channel.video_count} video{channel.video_count !== 1 ? "s" : ""}
                        </span>
                      </div>

                      {/* Normal mode: Tag pills */}
                      {!isEditing && (
                        <div className="flex items-center flex-wrap gap-1.5 mt-2">
                          {channel.tags && channel.tags.length > 0 ? (
                            channel.tags.map((tag) => (
                              <button
                                key={tag}
                                onClick={() => {
                                  if (onSelectTagFilter) {
                                    onSelectTagFilter(tag);
                                    onClose();
                                  }
                                }}
                                className="px-2 py-0.5 rounded-md text-xs font-medium bg-neutral-800 text-neutral-300 border border-neutral-700 hover:border-neutral-500 hover:text-white transition flex items-center space-x-1"
                                title={`Filter videos by tag #${tag}`}
                              >
                                <Tag className="w-2.5 h-2.5 text-neutral-400" />
                                <span>#{tag}</span>
                              </button>
                            ))
                          ) : (
                            <span className="text-xs text-neutral-500 italic">No tags assigned</span>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Right: Edit Button */}
                    {!isEditing && (
                      <button
                        onClick={() => handleStartEdit(channel)}
                        className="px-3 py-1.5 text-xs text-neutral-300 hover:text-white bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 rounded-lg flex items-center space-x-1.5 transition flex-shrink-0"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                        <span>{channel.tags?.length ? "Edit Tags" : "+ Add Tags"}</span>
                      </button>
                    )}
                  </div>

                  {/* Editing Mode: Tag Picker with Existing Tags */}
                  {isEditing && (
                    <div className="mt-3 pt-3 border-t border-neutral-800/80 space-y-3">
                      <div>
                        <div className="text-xs font-semibold text-neutral-300 mb-1.5 flex items-center justify-between">
                          <span>Assigned Tags:</span>
                          <span className="text-[11px] font-normal text-neutral-400">
                            Click to toggle or remove
                          </span>
                        </div>

                        {/* Selected tags badges */}
                        <div className="flex flex-wrap gap-1.5 min-h-[28px] p-2 bg-[#141414] rounded-lg border border-neutral-800">
                          {selectedTags.length > 0 ? (
                            selectedTags.map((tag) => (
                              <button
                                key={tag}
                                type="button"
                                onClick={() => handleToggleTag(tag)}
                                className="px-2.5 py-1 rounded-md text-xs font-medium bg-white text-neutral-900 flex items-center space-x-1 shadow-sm hover:bg-rose-100 hover:text-rose-900 transition group"
                                title="Click to remove tag"
                              >
                                <span>#{tag}</span>
                                <X className="w-3 h-3 group-hover:inline opacity-70 group-hover:opacity-100" />
                              </button>
                            ))
                          ) : (
                            <span className="text-xs text-neutral-500 italic">
                              Select from existing tags below or type a new tag.
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Quick Select from Existing Tags */}
                      {combinedExistingTags.length > 0 && (
                        <div>
                          <div className="text-[11px] font-medium text-neutral-400 mb-1.5">
                            Previously added tags (click to add/toggle):
                          </div>
                          <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto">
                            {combinedExistingTags.map((tag) => {
                              const isSelected = selectedTags.includes(tag);
                              return (
                                <button
                                  key={tag}
                                  type="button"
                                  onClick={() => handleToggleTag(tag)}
                                  className={`px-2 py-0.5 rounded text-xs font-medium border transition flex items-center space-x-1 ${
                                    isSelected
                                      ? "bg-neutral-200 text-neutral-900 border-neutral-300 font-semibold"
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

                      {/* Add Custom / New Tag Input */}
                      <form onSubmit={handleAddNewTag} className="flex items-center space-x-2">
                        <input
                          type="text"
                          value={newTagInput}
                          onChange={(e) => setNewTagInput(e.target.value)}
                          placeholder="Type new tag (e.g. news, python)..."
                          className="flex-1 px-3 py-1.5 text-xs bg-[#141414] border border-neutral-700 rounded-lg text-neutral-100 placeholder-neutral-500 focus:outline-none focus:border-neutral-400"
                        />
                        <button
                          type="submit"
                          disabled={!newTagInput.trim()}
                          className="px-3 py-1.5 text-xs font-medium bg-neutral-700 hover:bg-neutral-600 disabled:opacity-40 text-neutral-200 rounded-lg transition"
                        >
                          + Add Tag
                        </button>
                      </form>

                      {/* Actions */}
                      <div className="flex justify-end space-x-2 pt-2">
                        <button
                          type="button"
                          onClick={handleCancelEdit}
                          disabled={savingTags}
                          className="px-3 py-1.5 text-xs text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800 rounded-lg transition"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={() => handleSaveTags(channel.channel_title)}
                          disabled={savingTags}
                          className="flex items-center space-x-1 px-4 py-1.5 text-xs font-medium text-neutral-900 bg-white hover:bg-neutral-200 disabled:opacity-50 rounded-lg transition shadow-sm"
                        >
                          {savingTags && <Loader2 className="w-3 h-3 animate-spin" />}
                          <span>{savingTags ? "Saving..." : "Save Tags"}</span>
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Footer info */}
        <div className="pt-4 mt-2 border-t border-neutral-800 text-xs text-neutral-500 flex items-center justify-between">
          <span>{channels.length} channel{channels.length !== 1 ? "s" : ""} total</span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-xs font-medium text-neutral-300 hover:text-white bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 rounded-lg transition"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
