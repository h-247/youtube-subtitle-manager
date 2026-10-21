import { describe, expect, it } from "vitest";
import { videoEditSchema, videoIngestSchema } from "../lib/validation";

describe("server request validation", () => {
  it("accepts supported YouTube video and playlist URLs", () => {
    expect(videoIngestSchema.safeParse({ url: "https://youtu.be/abcdefghijk" }).success).toBe(true);
    expect(videoIngestSchema.safeParse({
      url: "https://www.youtube.com/playlist?list=PL123",
      mode: "playlist",
      tags: ["Research"],
    }).success).toBe(true);
  });

  it("rejects non-YouTube URLs, unknown fields, and oversized tag lists", () => {
    expect(videoIngestSchema.safeParse({ url: "https://example.com/video" }).success).toBe(false);
    expect(videoIngestSchema.safeParse({ url: "https://youtube.com/watch?v=abcdefghijk", admin: true }).success).toBe(false);
    expect(videoIngestSchema.safeParse({
      url: "https://youtube.com/watch?v=abcdefghijk",
      tags: Array.from({ length: 26 }, (_, index) => `tag-${index}`),
    }).success).toBe(false);
  });

  it("accepts the supported edit fields and rejects invalid status values", () => {
    expect(videoEditSchema.safeParse({ watch_status: "DONE", processing_paused: true, tags: ["Course"] }).success).toBe(true);
    expect(videoEditSchema.safeParse({ status: "ADMIN" }).success).toBe(false);
  });
});
