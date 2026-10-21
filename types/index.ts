export interface User {
  id: string;
  email: string;
  is_active: boolean;
  has_drive_connected: boolean;
  created_at: string;
}

export type WatchStatus = "TO_DO" | "DOING" | "DONE";
export type VideoStatus = "PENDING" | "PROCESSING" | "COMPLETED" | "NO_SUBTITLES" | "FAILED";
export type SubtitleType = "MANUAL" | "AUTO" | "IMPORTED" | "NONE";

export type VideoIngestInput = { url: string; mode: "video" | "playlist"; tags: string[] };
export function videoTags(video: { tags?: string[]; channel_tags?: string | null }): string[] {
  return Array.isArray(video.tags) ? video.tags : (video.channel_tags || "").split(",").map(t => t.trim()).filter(Boolean);
}
export interface Video {
  tags?: string[];
  id: number;
  user_id: number;
  video_id: string;
  youtube_url: string;
  title: string;
  channel_title: string | null;
  channel_url?: string | null;
  channel_tags?: string | null;
  duration: number | null;
  thumbnail_url: string | null;
  status: VideoStatus;
  watch_status: WatchStatus;
  subtitle_type: SubtitleType;
  subtitle_language: string | null;
  drive_file_id: string | null;
  drive_file_url: string | null;
  chatgpt_link: string | null;
  processing_paused?: boolean;
  error_category?: string | null;
  retry_count: number;
  progress_message: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

export interface VideoIngestResultItem {
  video_id: string;
  title: string;
  status: VideoStatus;
  subtitle_type: SubtitleType;
  is_duplicate: boolean;
  error?: string | null;
  video?: Video | null;
}

export interface VideoIngestResponse {
  total_found: number;
  processed: number;
  skipped_duplicates: number;
  failed: number;
  results: VideoIngestResultItem[];
}

export interface VideoListResponse {
  items: Video[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

export interface DriveStatus {
  is_configured: boolean;
  is_connected: boolean;
}

export interface ChannelItem {
  channel_title: string;
  channel_url?: string | null;
  channel_tags?: string | null;
  tags: string[];
  video_count: number;
}

export type YouTubeStatus = {
  is_configured: boolean; is_connected: boolean; connection_error?: string | null;
  connect_url: string; pending_count: number; removed_count: number; failed_count: number;
  jobs: Array<{video_id: string; playlist_id: string; state: string; error: string | null}>;
};
