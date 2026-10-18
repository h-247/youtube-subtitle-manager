"use client";

import React, { useState, useEffect } from "react";
import { useAuth } from "../lib/auth";
import { api } from "../lib/api";
import { DriveStatus } from "../types";
import { Video, LogOut, HardDrive, PlusCircle, CheckCircle2, AlertCircle, Link2 } from "lucide-react";

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

  useEffect(() => {
    if (user) {
      api.drive.getStatus().then(setDriveStatus).catch(() => {});
      setCheckingSites(true);
      api.sitesSync.getStatus().then((status) => {
        setSitesConnected(status.is_connected);
        setSitesDriveConfigured(status.drive_is_configured ?? null);
        setSitesDriveConnected(status.drive_is_connected ?? null);
        if (status.is_connected && status.drive_is_connected === true) void refreshSitesDriveLinks();
      }).catch(() => {}).finally(() => setCheckingSites(false));
    }
  }, [user]);

  useEffect(() => {
    if (!user) return;
    let active = true;
    const refresh = () => api.sitesSync.getStatus().then(status => {
      if (active) setSyncSummary(status.sync_error
        ? `${status.pending_count ?? 0} pending: ${status.sync_error}`
        : status.pending_count ? `${status.pending_count} changes waiting to sync`
        : status.is_connected ? "Sites sync up to date" : "Sites sync disconnected");
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
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        {/* Brand */}
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-xl bg-neutral-800 border border-neutral-700/80 flex items-center justify-center text-neutral-100 shadow-sm">
            <Video className="w-6 h-6" />
          </div>
          <div>
            <h1 className="font-bold text-lg text-neutral-100 leading-tight">
              YouTube Subtitle Manager
            </h1>
            <p className="text-xs text-neutral-400">Local-First Archive & Drive Sync</p>
          </div>
        </div>

        {/* Right side controls */}
        {user && (
          <div className="flex items-center space-x-3">
            <button onClick={handleSitesSync} disabled={checkingSites} className="flex items-center bg-neutral-800 hover:bg-neutral-700 text-neutral-200 border border-neutral-700 px-3 py-1.5 rounded-lg text-xs font-medium space-x-1.5 transition disabled:opacity-60" title="Sync local downloads to your ChatGPT Site">
              {sitesConnected ? <CheckCircle2 className="w-4 h-4 text-neutral-300" /> : <Link2 className="w-4 h-4 text-neutral-400" />}
              <span>{sitesConnected ? "Sites Connected" : "Connect Sites"}</span>
            </button>
            <span role="status" className="text-xs text-neutral-400 max-w-48" title={syncSummary}>{syncSummary}</span>
            {/* Drive Connection Status */}
            {driveStatus?.is_connected ? (
              <div className="flex items-center bg-neutral-800 text-neutral-200 border border-neutral-700 px-3 py-1.5 rounded-lg text-xs font-medium space-x-1.5" title="Subtitles upload directly from this local app to Google Drive">
                <CheckCircle2 className="w-4 h-4 text-neutral-300" />
                <span>Drive Connected</span>
                <button
                  onClick={handleDisconnectDrive}
                  className="ml-1 text-neutral-400 hover:text-rose-400 hover:underline pl-1 border-l border-neutral-700"
                  title="Disconnect Google Drive from this local app"
                >
                  Disconnect
                </button>
              </div>
            ) : sitesConnected && sitesDriveConnected === true ? (
              <div className="flex items-center bg-neutral-800 text-neutral-200 border border-neutral-700 px-3 py-1.5 rounded-lg text-xs font-medium space-x-1.5" title="Local subtitles sync to your ChatGPT Site, which uploads them using its connected Google Drive account">
                <CheckCircle2 className="w-4 h-4 text-neutral-300" />
                <span>Drive via Sites</span>
              </div>
            ) : sitesConnected && sitesDriveConfigured === true && sitesDriveConnected === false ? (
              <div className="flex items-center bg-neutral-800 text-amber-300 border border-neutral-700 px-3 py-1.5 rounded-lg text-xs font-medium space-x-1.5" title="Connect Google Drive from your ChatGPT Site; local downloads will then upload through that connection">
                <AlertCircle className="w-4 h-4 text-amber-400" />
                <span>Connect Drive on Sites</span>
              </div>
            ) : driveStatus?.is_configured ? (
              <button
                onClick={handleConnectDrive}
                disabled={connectingDrive}
                className="flex items-center bg-neutral-800 hover:bg-neutral-700 text-amber-300 border border-neutral-700 px-3 py-1.5 rounded-lg text-xs font-medium space-x-1.5 transition"
                title="Connect Google Drive directly to this local app"
              >
                <HardDrive className="w-4 h-4 text-amber-400" />
                <span>{connectingDrive ? "Connecting..." : "Connect Drive"}</span>
              </button>
            ) : sitesConnected && sitesDriveConfigured === false ? (
              <div className="flex items-center bg-neutral-800 text-neutral-400 border border-neutral-700 px-2.5 py-1 rounded-md text-xs font-normal" title="Google Drive OAuth is not configured on Sites">
                <AlertCircle className="w-3.5 h-3.5 text-neutral-500 mr-1" />
                Drive not configured on Sites
              </div>
            ) : sitesConnected ? (
              <div className="flex items-center bg-neutral-800 text-amber-300 border border-neutral-700 px-2.5 py-1 rounded-md text-xs font-normal" title="This local backend has not loaded the Sites Drive status update. Restart the local app to refresh it.">
                <AlertCircle className="w-3.5 h-3.5 text-amber-400 mr-1" />
                Drive status needs backend restart
              </div>
            ) : (
              <div className="flex items-center bg-neutral-800 text-neutral-400 border border-neutral-700 px-2.5 py-1 rounded-md text-xs font-normal" title="Connect Sites to use its Drive account, or configure local Google Drive OAuth">
                <AlertCircle className="w-3.5 h-3.5 text-neutral-500 mr-1" />
                Drive unavailable
              </div>
            )}



            {/* Ingest Action Button */}
            <button
              onClick={onOpenIngest}
              className="flex items-center bg-white hover:bg-neutral-200 text-neutral-900 font-medium px-4 py-2 rounded-lg text-sm shadow-sm transition space-x-1.5"
            >
              <PlusCircle className="w-4 h-4" />
              <span>Ingest Videos</span>
            </button>

            {/* User info & Logout */}
            <div className="flex items-center pl-3 border-l border-neutral-800 space-x-2">
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
