"use client";

import React, { useState, useEffect } from "react";
import { useAuth } from "../lib/auth";
import { api } from "../lib/api";
import { DriveStatus } from "../types";
import { Video, LogOut, HardDrive, PlusCircle, CheckCircle2, AlertCircle, Link2 } from "lucide-react";
import ChatGPTPromptLinkControl from "./ChatGPTPromptLinkControl";

interface NavbarProps {
  onOpenIngest: () => void;
}

async function refreshSitesDriveLinks() {
  try {
    await api.sitesSync.refreshDriveLinks();
    window.dispatchEvent(new Event("sites-drive-links-refreshed"));
  } catch {
    // The Drive connection badge remains valid even if link reconciliation fails.
  }
}

export default function Navbar({ onOpenIngest }: NavbarProps) {
  const { user, logout, refreshUser } = useAuth();
  const [driveStatus, setDriveStatus] = useState<DriveStatus | null>(null);
  const [connectingDrive, setConnectingDrive] = useState(false);
  const [sitesConnected, setSitesConnected] = useState(false);
  const [sitesDriveConfigured, setSitesDriveConfigured] = useState<boolean | null>(null);
  const [sitesDriveConnected, setSitesDriveConnected] = useState<boolean | null>(null);
  const [syncSummary, setSyncSummary] = useState("Sync status loading...");
  const [checkingSites, setCheckingSites] = useState(false);
  const [promptLink, setPromptLink] = useState<string | null>(null);

  useEffect(() => {
    if (user) {
      api.drive.getStatus().then(setDriveStatus).catch(() => {});
      api.preferences.getPromptLink().then((result) => setPromptLink(result.chatgpt_prompt_link)).catch(() => {});
      setCheckingSites(true);
      api.sitesSync.getStatus().then((status) => {
        setSitesConnected(status.is_connected);
        setSitesDriveConfigured(status.drive_is_configured ?? null);
        setSitesDriveConnected(status.drive_is_connected ?? null);
        if (status.is_connected && status.drive_is_connected === true) void refreshSitesDriveLinks();
      }).catch(() => {}).finally(() => setCheckingSites(false));
    }
  }, [user]);

  const savePromptLink = async (value: string | null) => {
    const result = await api.preferences.setPromptLink(value);
    setPromptLink(result.chatgpt_prompt_link);
  };

  useEffect(() => {
    if (!user) return;
    let active = true;
    const refresh = () => api.sitesSync.getStatus().then(status => {
      if (active) setSyncSummary(status.sync_error
        ? `${status.pending_count ?? 0} pending: ${status.sync_error}`
        : status.pending_count ? `${status.pending_count} changes waiting to sync`
        : status.is_connected ? "All queued changes sent" : "Sites sync disconnected");
    }).catch(() => { if (active) setSyncSummary("Sync status unavailable; reconnecting automatically"); });
    void refresh();
    const timer = setInterval(refresh, 10000);
    return () => { active = false; clearInterval(timer); };
  }, [user]);

  const handleSitesSync = async () => {
    try {
      if (sitesConnected) {
        if (!confirm("Disconnect Sites? Local downloads will stop syncing there.")) return;
        await api.sitesSync.disconnect();
        setSitesConnected(false);
        setSitesDriveConfigured(null);
        setSitesDriveConnected(null);
        return;
      }
      const token = window.prompt("Paste the one-time pairing code from the Pair Local App button on Sites:")?.trim();
      if (!token) return;
      await api.sitesSync.connect(token);
      const status = await api.sitesSync.getStatus();
      setSitesConnected(status.is_connected);
      setSitesDriveConfigured(status.drive_is_configured ?? null);
      setSitesDriveConnected(status.drive_is_connected ?? null);
      if (status.is_connected && status.drive_is_connected === true) void refreshSitesDriveLinks();
      alert("Sites connected. Your existing local videos are syncing now.");
    } catch (error) {
      alert(error instanceof Error ? error.message : "Could not connect Sites.");
    }
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
            <Video className="w-5 h-5" />
          </div>
          <div>
            <h1 className="font-bold text-base text-neutral-100 leading-tight">
              YouTube Subtitle Manager
            </h1>
            <p className="hidden sm:block text-[11px] text-neutral-400">Local-First Archive & Drive Sync</p>
          </div>
        </div>

        {user && <nav aria-label="Library" className="flex gap-1 text-xs text-neutral-300">
          <a href="/dashboard/videos" className="rounded-md px-2 py-1.5 hover:bg-neutral-800 hover:text-white">Videos</a>
          <a href="/dashboard/channels" className="rounded-md px-2 py-1.5 hover:bg-neutral-800 hover:text-white">Channels</a>
        </nav>}
        {/* Right side controls */}
        {user && (
          <div className="flex flex-1 flex-wrap items-center justify-end gap-1.5">
            <button onClick={handleSitesSync} disabled={checkingSites} className="flex shrink-0 items-center bg-neutral-800 hover:bg-neutral-700 text-neutral-200 border border-neutral-700 px-2.5 py-1.5 rounded-md text-[11px] font-medium gap-1.5 transition disabled:opacity-60 whitespace-nowrap" title="Sync local downloads to your ChatGPT Site">
              {sitesConnected ? <CheckCircle2 className="w-3.5 h-3.5 text-neutral-300" /> : <Link2 className="w-3.5 h-3.5 text-neutral-400" />}
              <span>{sitesConnected ? "Sites Connected" : "Connect Sites"}</span>
            </button>
            <span role="status" className="hidden 2xl:inline max-w-32 truncate text-[11px] text-neutral-400" title={syncSummary}>{syncSummary}</span>
            {/* Drive Connection Status */}
            {driveStatus?.is_connected ? (
              <div className="flex items-center bg-neutral-800 text-neutral-200 border border-neutral-700 px-2.5 py-1.5 rounded-md text-[11px] font-medium gap-1.5 whitespace-nowrap" title="Subtitles upload directly from this local app to Google Drive">
                <CheckCircle2 className="w-3.5 h-3.5 text-neutral-300" />
                <span>Drive Connected</span>
                <button
                  onClick={handleDisconnectDrive}
                  className="ml-0.5 text-neutral-400 hover:text-rose-400 hover:underline pl-1 border-l border-neutral-700"
                  title="Disconnect Google Drive from this local app"
                >
                  Disconnect
                </button>
              </div>
            ) : sitesConnected && sitesDriveConnected === true ? (
              <div className="flex items-center bg-neutral-800 text-neutral-200 border border-neutral-700 px-2.5 py-1.5 rounded-md text-[11px] font-medium gap-1.5 whitespace-nowrap" title="Local subtitles sync to your ChatGPT Site, which uploads them using its connected Google Drive account">
                <CheckCircle2 className="w-3.5 h-3.5 text-neutral-300" />
                <span>Drive via Sites</span>
              </div>
            ) : sitesConnected && sitesDriveConfigured === true && sitesDriveConnected === false ? (
              <div className="flex items-center bg-neutral-800 text-amber-300 border border-neutral-700 px-2.5 py-1.5 rounded-md text-[11px] font-medium gap-1.5 whitespace-nowrap" title="Connect Google Drive from your ChatGPT Site; local downloads will then upload through that connection">
                <AlertCircle className="w-3.5 h-3.5 text-amber-400" />
                <span>Connect Drive on Sites</span>
              </div>
            ) : driveStatus?.is_configured ? (
              <button
                onClick={handleConnectDrive}
                disabled={connectingDrive}
                className="flex items-center bg-neutral-800 hover:bg-neutral-700 text-amber-300 border border-neutral-700 px-2.5 py-1.5 rounded-md text-[11px] font-medium gap-1.5 transition whitespace-nowrap"
                title="Connect Google Drive directly to this local app"
              >
                <HardDrive className="w-3.5 h-3.5 text-amber-400" />
                <span>{connectingDrive ? "Connecting..." : "Connect Drive"}</span>
              </button>
            ) : sitesConnected && sitesDriveConfigured === false ? (
              <div className="flex items-center bg-neutral-800 text-neutral-400 border border-neutral-700 px-2 py-1 rounded-md text-[10px] font-normal whitespace-nowrap" title="Google Drive OAuth is not configured on Sites">
                <AlertCircle className="w-3.5 h-3.5 text-neutral-500 mr-1" />
                Drive not configured on Sites
              </div>
            ) : sitesConnected ? (
              <div className="flex items-center bg-neutral-800 text-amber-300 border border-neutral-700 px-2 py-1 rounded-md text-[10px] font-normal whitespace-nowrap" title="This local backend has not loaded the Sites Drive status update. Restart the local app to refresh it.">
                <AlertCircle className="w-3.5 h-3.5 text-amber-400 mr-1" />
                Drive status needs backend restart
              </div>
            ) : (
              <div className="flex items-center bg-neutral-800 text-neutral-400 border border-neutral-700 px-2 py-1 rounded-md text-[10px] font-normal whitespace-nowrap" title="Connect Sites to use its Drive account, or configure local Google Drive OAuth">
                <AlertCircle className="w-3.5 h-3.5 text-neutral-500 mr-1" />
                Drive unavailable
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
