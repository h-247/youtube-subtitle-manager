"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../lib/auth";
import Link from "next/link";
import { Video, Shield, HardDrive, Search, Sparkles } from "lucide-react";

export default function HomePage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && user) {
      router.push("/dashboard");
    }
  }, [user, loading, router]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#212121]">
        <div className="w-8 h-8 border-4 border-neutral-400 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-[#212121] text-neutral-100 flex flex-col">
      <header className="max-w-7xl mx-auto w-full px-6 py-6 flex items-center justify-between border-b border-neutral-800">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-xl bg-neutral-800 border border-neutral-700/80 flex items-center justify-center text-neutral-100 shadow-sm">
            <Video className="w-6 h-6" />
          </div>
          <span className="font-bold text-lg text-neutral-100">YouTube Subtitle Manager</span>
        </div>
        <div>
          <Link
            href="/login"
            className="px-4 py-2 text-sm font-medium text-neutral-900 bg-white hover:bg-neutral-200 rounded-xl shadow-sm transition"
          >
            Sign In
          </Link>
        </div>
      </header>

      <section className="flex-1 flex flex-col items-center justify-center text-center px-4 max-w-4xl mx-auto py-16">
        <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-neutral-800/80 text-neutral-300 text-xs font-medium mb-6 border border-neutral-700/80">
          <Sparkles className="w-3.5 h-3.5" />
          <span>Local-first architecture with isolated Drive sync</span>
        </div>

        <h1 className="text-4xl sm:text-5xl font-extrabold text-neutral-100 tracking-tight leading-tight mb-6">
          Archive, Manage & Sync <br />
          <span className="text-white">YouTube Subtitles</span> with Ease
        </h1>

        <p className="text-base sm:text-lg text-neutral-400 max-w-2xl mb-8 leading-relaxed">
          Extract manual and automatic English captions from YouTube videos, Shorts, and playlists.
          Sync automatically to Google Drive and keep your AI workflows organized.
        </p>

        <div className="flex justify-center">
          <Link
            href="/login"
            className="px-8 py-3.5 bg-white hover:bg-neutral-200 text-neutral-900 font-medium rounded-xl shadow-sm text-sm transition"
          >
            Sign In to Library
          </Link>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-16 text-left w-full">
          <div className="bg-[#262626] p-6 rounded-2xl border border-neutral-800 shadow-sm">
            <div className="w-10 h-10 rounded-xl bg-neutral-800 text-neutral-300 border border-neutral-700/80 flex items-center justify-center mb-4">
              <Shield className="w-5 h-5" />
            </div>
            <h3 className="font-bold text-neutral-100 text-base mb-1">User Isolation</h3>
            <p className="text-xs text-neutral-400 leading-relaxed">
              Strict per-user data boundaries and duplicate prevention for all video records.
            </p>
          </div>

          <div className="bg-[#262626] p-6 rounded-2xl border border-neutral-800 shadow-sm">
            <div className="w-10 h-10 rounded-xl bg-neutral-800 text-neutral-300 border border-neutral-700/80 flex items-center justify-center mb-4">
              <Search className="w-5 h-5" />
            </div>
            <h3 className="font-bold text-neutral-100 text-base mb-1">Smart Caption Selection</h3>
            <p className="text-xs text-neutral-400 leading-relaxed">
              Prefers manual human captions and seamlessly falls back to auto-generated English captions.
            </p>
          </div>

          <div className="bg-[#262626] p-6 rounded-2xl border border-neutral-800 shadow-sm">
            <div className="w-10 h-10 rounded-xl bg-neutral-800 text-neutral-300 border border-neutral-700/80 flex items-center justify-center mb-4">
              <HardDrive className="w-5 h-5" />
            </div>
            <h3 className="font-bold text-neutral-100 text-base mb-1">Isolated Google Drive Sync</h3>
            <p className="text-xs text-neutral-400 leading-relaxed">
              Direct OAuth upload to your Google Drive, deleting local temporary files only after confirmed upload.
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}
