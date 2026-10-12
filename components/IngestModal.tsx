"use client";

import React, { useState, useEffect } from "react";
import { X, PlaySquare } from "lucide-react";

interface IngestModalProps {
  isOpen: boolean;
  onClose: () => void;
  onStart: (url: string) => void;
}

export default function IngestModal({ isOpen, onClose, onStart }: IngestModalProps) {
  const [url, setUrl] = useState("");

  useEffect(() => {
    if (!isOpen) {
      setUrl("");
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;

    onStart(url.trim());
    handleClose();
  };

  const handleClose = () => {
    setUrl("");
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="bg-[#262626] rounded-2xl shadow-2xl max-w-2xl w-full p-6 relative border border-neutral-800 my-8 text-neutral-100">
        <button
          onClick={handleClose}
          className="absolute top-5 right-5 text-neutral-400 hover:text-neutral-100 transition"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center space-x-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-neutral-800 text-neutral-100 border border-neutral-700/80 flex items-center justify-center">
            <PlaySquare className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-neutral-100">Ingest YouTube Content</h2>
            <p className="text-xs text-neutral-400">
              Paste a YouTube video, Short, or playlist URL to archive subtitles
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-neutral-300 uppercase mb-1">
              YouTube URL
            </label>
            <input
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="e.g. https://www.youtube.com/watch?v=... or playlist URL"
              className="w-full px-4 py-2.5 text-sm bg-[#1a1a1a] border border-neutral-700 text-neutral-100 placeholder-neutral-500 rounded-xl focus:ring-2 focus:ring-neutral-500/50 focus:border-neutral-400 focus:outline-none transition"
              required
            />
            <p className="text-xs text-neutral-400 mt-1">
              Supports single video watch links, /shorts/ links, and full /playlist?list=... links.
            </p>
          </div>

          <div className="flex justify-end space-x-3 pt-2">
            <button
              type="button"
              onClick={handleClose}
              className="px-4 py-2 text-sm text-neutral-300 hover:bg-neutral-800 rounded-xl transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!url.trim()}
              className="flex items-center space-x-2 px-5 py-2 text-sm font-medium text-neutral-900 bg-white hover:bg-neutral-200 disabled:opacity-50 rounded-xl transition shadow-sm"
            >
              <span>Start Ingestion</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
