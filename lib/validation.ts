import { z } from "zod";

const youtubeHost = z.string().url().refine((value) => {
  const host = new URL(value).hostname.toLowerCase().replace(/^www\./, "");
  return ["youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be"].includes(host);
}, "Enter a YouTube URL.");

export const videoIngestSchema = z.object({
  url: youtubeHost,
  mode: z.enum(["video", "playlist"]).optional(),
  tags: z.array(z.string().trim().min(1).max(64)).max(25).optional(),
}).strict();

export const videoEditSchema = z.object({
  status: z.enum(["PENDING", "PROCESSING", "COMPLETED", "NO_SUBTITLES", "FAILED"]).optional(),
  watch_status: z.enum(["TO_DO", "DOING", "DONE"]).optional(),
  channel_tags: z.string().max(500).nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(64)).max(25).nullable().optional(),
  chatgpt_link: z.string().max(2048).refine((value) => value === "" || z.string().url().safeParse(value).success, "Enter a valid conversation URL.").nullable().optional(),
  processing_paused: z.boolean().optional(),
}).strict();

export type VideoIngestRequest = z.infer<typeof videoIngestSchema>;
export type VideoEditRequest = z.infer<typeof videoEditSchema>;
