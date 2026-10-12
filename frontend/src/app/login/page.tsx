"use client";

import React, { useState } from "react";
import { useAuth } from "../../lib/auth";
import { Video, Loader2, AlertCircle } from "lucide-react";

export default function LoginPage() {
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      await login(email.trim(), password);
    } catch (err: any) {
      setError(err.message || "Invalid email or password");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#212121] flex items-center justify-center p-4">
      <div className="bg-[#262626] rounded-2xl border border-neutral-800 shadow-xl p-8 max-w-md w-full">
        <div className="text-center mb-6">
          <div className="w-12 h-12 bg-neutral-800 border border-neutral-700/80 rounded-2xl flex items-center justify-center text-neutral-100 mx-auto mb-3 shadow-sm">
            <Video className="w-6 h-6" />
          </div>
          <h1 className="text-xl font-bold text-neutral-100">Welcome Back</h1>
          <p className="text-xs text-neutral-400 mt-1">Sign in to your YouTube Subtitle Manager</p>
        </div>

        {error && (
          <div className="p-3 mb-4 bg-rose-950/40 border border-rose-800/60 text-rose-300 rounded-xl text-xs flex items-center space-x-2">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-neutral-300 uppercase mb-1">
              Email Address
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="user@example.com"
              required
              className="w-full px-3 py-2 text-sm bg-[#1a1a1a] border border-neutral-700 rounded-xl text-neutral-100 placeholder-neutral-500 focus:ring-2 focus:ring-neutral-500/50 focus:border-neutral-400 focus:outline-none transition"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-neutral-300 uppercase mb-1">
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              className="w-full px-3 py-2 text-sm bg-[#1a1a1a] border border-neutral-700 rounded-xl text-neutral-100 placeholder-neutral-500 focus:ring-2 focus:ring-neutral-500/50 focus:border-neutral-400 focus:outline-none transition"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 text-sm font-medium text-neutral-900 bg-white hover:bg-neutral-200 disabled:opacity-50 rounded-xl transition shadow-sm flex items-center justify-center space-x-2 mt-2"
          >
            {loading && <Loader2 className="w-4 h-4 animate-spin" />}
            <span>{loading ? "Signing in..." : "Sign In"}</span>
          </button>
        </form>
      </div>
    </div>
  );
}
