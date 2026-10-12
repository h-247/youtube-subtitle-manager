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
  watchStatus: text("watch_status").notNull().default("TO_DO"),
  channelTags: text("channel_tags"),
  subtitleType: text("subtitle_type").notNull().default("NONE"),
  subtitleLanguage: text("subtitle_language"),
  subtitleText: text("subtitle_text"),
  driveFileId: text("drive_file_id"),
  driveFileUrl: text("drive_file_url"),
  driveRetryCount: integer("drive_retry_count").notNull().default(0),
  driveLastAttemptAt: text("drive_last_attempt_at"),
  chatgptLink: text("chatgpt_link"),
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

export const driveOauthStates = sqliteTable("drive_oauth_states", {
  state: text("state").primaryKey(),
  userId: text("user_id").notNull(),
  expiresAt: integer("expires_at").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("ix_drive_oauth_states_expiry").on(table.expiresAt)]);
