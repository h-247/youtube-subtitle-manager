"use client";

import React, { useState, useEffect } from "react";
import { useAuth } from "../lib/auth";
import { api } from "../lib/api";
import { DriveStatus } from "../types";
import { Video as VideoIcon, LogOut, HardDrive, PlusCircle, CheckCircle2, AlertCircle, Link2 } from "lucide-react";
import ChatGPTPromptLinkControl from "./ChatGPTPromptLinkControl";

interface NavbarProps {
  onOpenIngest: () => void;
}

export default function Navbar({ onOpenIngest }: NavbarProps) {
  const { user, logout, refreshUser } = useAuth();
  const [driveStatus, setDriveStatus] = useState<DriveStatus | null>(null);
  const [connectingDrive, setConnectingDrive] = useState(false);
  const [pairingLocal, setPairingLocal] = useState(false);
  const [promptLink, setPromptLink] = useState<string | null>(null);

  const handlePairLocal = async () => {
    try {
      setPairingLocal(true);
      const response = await fetch("/api/sync/pair", { method: "POST" });
      const data = await response.json() as { token?: string; detail?: string };
      if (!response.ok || !data.token) throw new Error(data.detail || "Could not create a local app pairing code.");
      window.prompt("Copy this code, then paste it into ChatGPT Site sign-in in your local app:", data.token);
    } catch (error) {
      alert(error instanceof Error ? error.message : "Could not create a local app pairing code.");
    } finally {
      setPairingLocal(false);
    }
  };

  useEffect(() => {
    if (user) {
      api.drive.getStatus().then(setDriveStatus).catch(() => {});
      api.preferences.getPromptLink().then((result) => setPromptLink(result.chatgpt_prompt_link)).catch(() => {});
    }
  }, [user]);

  const savePromptLink = async (value: string | null) => {
    const result = await api.preferences.setPromptLink(value);
    setPromptLink(result.chatgpt_prompt_link);
  };

  const handleConnectDrive = async () => {
    try {
      setConnectingDrive(true);
      const { url } = await api.drive.getAuthUrl();
      window.location.href = url;
    } catch (err: any) {
      alert(err.message || "Failed to initiate Google Drive connection");
      setConnectingDrive(false);
    }
  };

  const handleDisconnectDrive = async () => {
    if (!confirm("Are you sure you want to disconnect Google Drive? New subtitles will not be uploaded.")) return;
    try {
      await api.drive.disconnect();
      await refreshUser();
      if (driveStatus) {
        setDriveStatus({ ...driveStatus, is_connected: false });
      }
    } catch (err: any) {
      alert(err.message || "Failed to disconnect Google Drive");
    }
  };

  return (
    <header className="bg-[#212121]/90 backdrop-blur-sm border-b border-neutral-800 sticky top-0 z-30 shadow-sm">
      <div className="max-w-[1600px] mx-auto px-3 sm:px-5 min-h-16 py-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        {/* Brand */}
        <div className="flex min-w-0 items-center gap-2">
          <div className="w-9 h-9 shrink-0 rounded-lg bg-neutral-800 border border-neutral-700/80 flex items-center justify-center text-neutral-100 shadow-sm">
            <VideoIcon className="w-5 h-5" />
          </div>
          <div>
            <h1 className="font-bold text-base text-neutral-100 leading-tight">
              YouTube Subtitle Manager
            </h1>
            <p className="hidden sm:block text-[11px] text-neutral-400">Local-First Archive & Drive Sync</p>
          </div>
        </div>

        {user && <nav aria-label="Library" className="flex gap-1 text-xs text-neutral-300"><a href="/dashboard/videos" className="rounded-md px-2 py-1.5 hover:bg-neutral-800 hover:text-white">Videos</a><a href="/dashboard/channels" className="rounded-md px-2 py-1.5 hover:bg-neutral-800 hover:text-white">Channels</a></nav>}
        {/* Right side controls */}
        {user && (
          <div className="flex flex-1 flex-wrap items-center justify-end gap-1.5">
            <button onClick={handlePairLocal} disabled={pairingLocal} className="flex shrink-0 items-center bg-neutral-800 hover:bg-neutral-700 text-neutral-200 border border-neutral-700 px-2.5 py-1.5 rounded-md text-[11px] font-medium gap-1.5 transition whitespace-nowrap" title="Pair this library with your local subtitle downloader">
              <Link2 className="w-3.5 h-3.5 text-neutral-300" />
              <span>{pairingLocal ? "Creating code…" : "Pair Local App"}</span>
            </button>
            {/* Drive Connection Status */}
            {driveStatus?.is_configured ? (
              driveStatus.is_connected && driveStatus.needs_reconnect ? (
                <div className="flex items-center bg-neutral-800 text-amber-300 border border-amber-900/70 px-2.5 py-1.5 rounded-md text-[11px] font-medium gap-1.5 whitespace-nowrap">
                  <AlertCircle className="w-3.5 h-3.5 text-amber-400" />
                  <span>Reconnect Drive</span>
                  <button
                    onClick={handleConnectDrive}
                    disabled={connectingDrive}
                    className="text-amber-200 hover:text-white hover:underline pl-2 border-l border-neutral-700"
                    title="Renew Google Drive access so saved subtitles can upload"
                  >
                    {connectingDrive ? "Connecting..." : "Reconnect"}
                  </button>
                </div>
              ) : driveStatus.is_connected ? (
                <div className="flex items-center bg-neutral-800 text-neutral-200 border border-neutral-700 px-2.5 py-1.5 rounded-md text-[11px] font-medium gap-1.5 whitespace-nowrap">
                  <CheckCircle2 className="w-3.5 h-3.5 text-neutral-300" />
                  <span>Drive Connected</span>
                  <button
                    onClick={handleDisconnectDrive}
                  className="ml-0.5 text-neutral-400 hover:text-rose-400 hover:underline pl-1 border-l border-neutral-700"
                    title="Disconnect Google Drive"
                  >
                    Disconnect
                  </button>
                </div>
              ) : (
                <button
                  onClick={handleConnectDrive}
                  disabled={connectingDrive}
                  className="flex items-center bg-neutral-800 hover:bg-neutral-700 text-amber-300 border border-neutral-700 px-2.5 py-1.5 rounded-md text-[11px] font-medium gap-1.5 transition whitespace-nowrap"
                >
                  <HardDrive className="w-3.5 h-3.5 text-amber-400" />
                  <span>{connectingDrive ? "Connecting..." : "Connect Drive"}</span>
                </button>
              )
            ) : (
              <div className="flex items-center bg-neutral-800 text-neutral-400 border border-neutral-700 px-2 py-1 rounded-md text-[10px] font-normal whitespace-nowrap" title="Add Google OAuth client ID and secret to this Site to enable Drive">
                <AlertCircle className="w-3.5 h-3.5 text-neutral-500 mr-1" />
                Drive setup required
              </div>
            )}



            <ChatGPTPromptLinkControl value={promptLink} onSave={savePromptLink} />

            {/* Ingest Action Button */}
            <button
              onClick={onOpenIngest}
              className="flex shrink-0 items-center bg-white hover:bg-neutral-200 text-neutral-900 font-medium px-3 py-1.5 rounded-md text-xs shadow-sm transition gap-1.5 whitespace-nowrap"
            >
              <PlusCircle className="w-3.5 h-3.5" />
              <span>Ingest Videos</span>
            </button>

            {/* User info & Logout */}
            <div className="flex items-center pl-2 border-l border-neutral-800 gap-1.5">
              <span className="text-xs font-medium text-neutral-300 hidden md:inline-block max-w-[150px] truncate">
                {user.email}
              </span>
              <button
                onClick={logout}
                className="p-2 text-neutral-400 hover:text-neutral-100 hover:bg-neutral-800 rounded-lg transition"
                title="Log out"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </header>
  );
}
