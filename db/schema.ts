import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const videos = sqliteTable("videos", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: text("user_id").notNull(),
  videoId: text("video_id").notNull(),
  youtubeUrl: text("youtube_url").notNull(),
  title: text("title").notNull(),
  channelTitle: text("channel_title"),
  channelUrl: text("channel_url"),
  duration: integer("duration"),
  thumbnailUrl: text("thumbnail_url"),
  status: text("status").notNull().default("PROCESSING"),
  processingSource: text("processing_source").notNull().default("SITE"),
  watchStatus: text("watch_status").notNull().default("TO_DO"),
  channelTags: text("channel_tags"),
  subtitleType: text("subtitle_type").notNull().default("NONE"),
  subtitleLanguage: text("subtitle_language"),
  subtitleText: text("subtitle_text"),
  tagsJson: text("tags_json"),
  driveFileId: text("drive_file_id"),
  driveFileUrl: text("drive_file_url"),
  driveRetryCount: integer("drive_retry_count").notNull().default(0),
  driveLastAttemptAt: text("drive_last_attempt_at"),
  chatgptLink: text("chatgpt_link"),
  chatgptPromptLink: text("chatgpt_prompt_link"),
  processingPaused: integer("processing_paused").notNull().default(0),
  errorCategory: text("error_category"),
  retryCount: integer("retry_count").notNull().default(0),
  progressMessage: text("progress_message"),
  errorMessage: text("error_message"),
  lastAttemptAt: text("last_attempt_at"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("uq_user_video").on(table.userId, table.videoId),
  index("ix_videos_user_created").on(table.userId, table.createdAt),
  index("ix_videos_user_status").on(table.userId, table.status),
]);

export const channelTags = sqliteTable("channel_tags", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: text("user_id").notNull(),
  channelTitle: text("channel_title").notNull(),
  tag: text("tag").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("uq_user_channel_tag").on(table.userId, table.channelTitle, table.tag),
  index("ix_channel_tags_user").on(table.userId),
]);

export const driveConnections = sqliteTable("drive_connections", {
  userId: text("user_id").primaryKey(),
  encryptedCredentials: text("encrypted_credentials").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const userPromptSettings = sqliteTable("user_prompt_settings", {
  userId: text("user_id").primaryKey(),
  chatgptPromptLink: text("chatgpt_prompt_link"),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const driveOauthStates = sqliteTable("drive_oauth_states", {
  state: text("state").primaryKey(),
  userId: text("user_id").notNull(),
  expiresAt: integer("expires_at").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("ix_drive_oauth_states_expiry").on(table.expiresAt)]);

export const localSyncTokens = sqliteTable("local_sync_tokens", {
  tokenHash: text("token_hash").primaryKey(),
  userId: text("user_id").notNull(),
  userEmail: text("user_email"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  revokedAt: text("revoked_at"),
}, (table) => [index("ix_local_sync_tokens_user").on(table.userId)]);

export const syncTombstones = sqliteTable("sync_tombstones", {
  userId: text("user_id").notNull(),
  videoId: text("video_id").notNull(),
  deletedAt: text("deleted_at").notNull(),
}, table => [uniqueIndex("uq_sync_tombstone").on(table.userId, table.videoId)]);

export const youtubeConnections = sqliteTable("youtube_connections", {
  userId: text("user_id").primaryKey(),
  encryptedCredentials: text("encrypted_credentials").notNull(),
  updatedAt: text("updated_at").notNull(),
});
export const youtubeOauthStates = sqliteTable("youtube_oauth_states", {
  state: text("state").primaryKey(),
  userId: text("user_id").notNull(),
  expiresAt: integer("expires_at").notNull(),
});
export const playlistCleanupJobs = sqliteTable("playlist_cleanup_jobs", {
  id: integer("id").primaryKey({autoIncrement: true}),
  userId: text("user_id").notNull(),
  videoId: text("video_id").notNull(),
  playlistId: text("playlist_id").notNull(),
  playlistItemId: text("playlist_item_id").notNull(),
  state: text("state").notNull().default("PENDING"),
  attempts: integer("attempts").notNull().default(0),
  nextAttempt: integer("next_attempt").notNull().default(0),
  leaseUntil: integer("lease_until").notNull().default(0),
  error: text("error"),
  updatedAt: text("updated_at").notNull(),
}, t => [uniqueIndex("uq_playlist_cleanup_item").on(t.userId, t.playlistItemId), index("ix_playlist_cleanup_due").on(t.userId, t.state, t.nextAttempt)]);
