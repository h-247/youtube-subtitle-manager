"use client";

import React, { useState, useEffect } from "react";
import { useAuth } from "../lib/auth";
import { api } from "../lib/api";
import { DriveStatus } from "../types";
import { Video, LogOut, HardDrive, PlusCircle, CheckCircle2, AlertCircle, Tv } from "lucide-react";

interface NavbarProps {
  onOpenIngest: () => void;
  onOpenChannels: () => void;
}

export default function Navbar({ onOpenIngest, onOpenChannels }: NavbarProps) {
  const { user, logout, refreshUser } = useAuth();
  const [driveStatus, setDriveStatus] = useState<DriveStatus | null>(null);
  const [connectingDrive, setConnectingDrive] = useState(false);

  useEffect(() => {
    if (user) {
      api.drive.getStatus().then(setDriveStatus).catch(() => {});
    }
  }, [user]);

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
            {/* Drive Connection Status */}
            {driveStatus?.is_configured ? (
              driveStatus.is_connected ? (
                <div className="flex items-center bg-neutral-800 text-neutral-200 border border-neutral-700 px-3 py-1.5 rounded-lg text-xs font-medium space-x-1.5">
                  <CheckCircle2 className="w-4 h-4 text-neutral-300" />
                  <span>Drive Connected</span>
                  <button
                    onClick={handleDisconnectDrive}
                    className="ml-1 text-neutral-400 hover:text-rose-400 hover:underline pl-1 border-l border-neutral-700"
                    title="Disconnect Google Drive"
                  >
                    Disconnect
                  </button>
                </div>
              ) : (
                <button
                  onClick={handleConnectDrive}
                  disabled={connectingDrive}
                  className="flex items-center bg-neutral-800 hover:bg-neutral-700 text-amber-300 border border-neutral-700 px-3 py-1.5 rounded-lg text-xs font-medium space-x-1.5 transition"
                >
                  <HardDrive className="w-4 h-4 text-amber-400" />
                  <span>{connectingDrive ? "Connecting..." : "Connect Drive"}</span>
                </button>
              )
            ) : (
              <div className="flex items-center bg-neutral-800 text-neutral-400 border border-neutral-700 px-2.5 py-1 rounded-md text-xs font-normal" title="OAuth not configured in server .env">
                <AlertCircle className="w-3.5 h-3.5 text-neutral-500 mr-1" />
                Drive Unconfigured
              </div>
            )}

            {/* Channels Management Button */}
            <button
              onClick={onOpenChannels}
              className="flex items-center bg-neutral-800 hover:bg-neutral-700 text-neutral-200 border border-neutral-700 font-medium px-3.5 py-2 rounded-lg text-sm transition space-x-1.5 shadow-sm"
              title="View and manage channels & tags"
            >
              <Tv className="w-4 h-4 text-neutral-400" />
              <span>Channels</span>
            </button>

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
