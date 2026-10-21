import { YouTubeStatus, VideoIngestInput, User, Video, VideoIngestResponse, VideoListResponse, VideoStatus, WatchStatus, DriveStatus, ChannelItem } from "../types";

const API_BASE = "/api";

function getAuthHeader(): Record<string, string> {
  if (typeof window === "undefined") return {};
  const token = localStorage.getItem("token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const headers = {
    "Content-Type": "application/json",
    ...getAuthHeader(),
    ...options.headers,
  };

  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers,
  });

  if (!response.ok) {
    let errorDetail = "An unexpected error occurred.";
    try {
      const errorJson = await response.json() as { detail?: unknown };
      if (Array.isArray(errorJson.detail)) {
        errorDetail = errorJson.detail
          .map((item: { msg?: string; loc?: unknown[] }) => {
            const field = Array.isArray(item.loc) ? item.loc.at(-1) : undefined;
            return field ? `${field}: ${item.msg || "Invalid value"}` : item.msg || "Invalid value";
          })
          .join("; ");
      } else if (typeof errorJson.detail === "string") {
        errorDetail = errorJson.detail;
      } else if (errorJson.detail) {
        errorDetail = JSON.stringify(errorJson.detail);
      }
    } catch {
      // Fallback to response text or status text
      errorDetail = response.statusText || errorDetail;
    }
    throw new Error(errorDetail);
  }

  return response.json();
}

export const api = {
  youtube: {
    getStatus: () => request<YouTubeStatus>("/youtube/status"),
    retry: () => request("/youtube/retry", {method: "POST"}),
    disconnect: () => request("/youtube/disconnect", {method: "POST"}),
  },
  auth: {
    async login(email: string, password: string): Promise<{ access_token: string; user: User }> {
      return request<{ access_token: string; user: User }>("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
    },

    async loginWithSites(pairingCode: string): Promise<{ access_token: string; user: User }> {
      return request<{ access_token: string; user: User }>("/auth/sites-login", {
        method: "POST",
        body: JSON.stringify({ pairing_code: pairingCode }),
      });
    },

    async getMe(): Promise<User> {
      return request<User>("/auth/me");
    },

    async logout(): Promise<void> {
      try {
        await request("/auth/logout", { method: "POST" });
      } finally {
        if (typeof window !== "undefined") {
          localStorage.removeItem("token");
        }
      }
    },
  },

  videos: {
    async ingest(input: VideoIngestInput): Promise<VideoIngestResponse> {
      return request<VideoIngestResponse>("/videos/ingest", {
        method: "POST",
        body: JSON.stringify(input),
      });
    },

    async list(params: {
      search?: string;
      status?: string;
      watch_status?: string;
      tag?: string;
      page?: number;
      page_size?: number;
    } = {}): Promise<VideoListResponse> {
      const query = new URLSearchParams();
      if (params.search) query.set("search", params.search);
      if (params.status && params.status !== "ALL") query.set("status", params.status);
      if (params.watch_status && params.watch_status !== "ALL") query.set("watch_status", params.watch_status);
      if (params.tag && params.tag !== "ALL") query.set("tag", params.tag);
      if (params.page) query.set("page", params.page.toString());
      if (params.page_size) query.set("page_size", params.page_size.toString());

      return request<VideoListResponse>(`/videos?${query.toString()}`);
    },

    async getTags(): Promise<string[]> {
      return request<string[]>("/videos/tags");
    },

    async getChannels(): Promise<ChannelItem[]> {
      return request<ChannelItem[]>("/videos/channels");
    },

    async get(id: number | string): Promise<Video> {
      return request<Video>(`/videos/${id}`);
    },

    async update(
      id: number,
      data: {
        tags?: string[];
        processing_paused?: boolean;
        status?: VideoStatus | string;
        watch_status?: WatchStatus | string;
        chatgpt_link?: string | null;
        channel_tags?: string | null;
      }
    ): Promise<Video> {
      return request<Video>(`/videos/${id}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      });
    },

    async delete(id: number): Promise<{ message: string }> {
      return request<{ message: string }>(`/videos/${id}`, {
        method: "DELETE",
      });
    },
  },

  drive: {
    async getStatus(): Promise<DriveStatus> {
      return request<DriveStatus>("/drive/status");
    },

    async getAuthUrl(): Promise<{ url: string }> {
      return request<{ url: string }>("/drive/auth-url");
    },

    async disconnect(): Promise<{ message: string }> {
      return request<{ message: string }>("/drive/disconnect", {
        method: "POST",
      });
    },
  },

  sitesSync: {
    async getStatus(): Promise<{ is_connected: boolean; drive_is_configured?: boolean; drive_is_connected?: boolean; site_url: string; pending_count?: number; failed_count?: number; sync_error?: string | null }> {
      return request<{ is_connected: boolean; drive_is_configured?: boolean; drive_is_connected?: boolean; site_url: string; pending_count?: number; failed_count?: number; sync_error?: string | null }>("/sites-sync/status");
    },

    async refreshDriveLinks(): Promise<{ updated: number }> {
      return request<{ updated: number }>("/sites-sync/refresh-drive-links", { method: "POST" });
    },

    async connect(token: string): Promise<{ is_connected: boolean; message: string }> {
      return request<{ is_connected: boolean; message: string }>("/sites-sync/connect", {
        method: "POST",
        body: JSON.stringify({ token }),
      });
    },

    async disconnect(): Promise<{ is_connected: boolean }> {
      return request<{ is_connected: boolean }>("/sites-sync/connect", { method: "DELETE" });
    },
  },

  preferences: {
    async getPromptLink(): Promise<{ chatgpt_prompt_link: string | null }> {
      return request<{ chatgpt_prompt_link: string | null }>("/preferences/prompt-link");
    },
    async setPromptLink(chatgpt_prompt_link: string | null): Promise<{ chatgpt_prompt_link: string | null }> {
      return request<{ chatgpt_prompt_link: string | null }>("/preferences/prompt-link", {
        method: "PATCH",
        body: JSON.stringify({ chatgpt_prompt_link }),
      });
    },
  },
};
