"use client";

import { useState } from "react";
import { Tv } from "lucide-react";

export default function ChannelThumbnail({ videoId, title }: { videoId?: string; title: string }) {
  const [fallback, setFallback] = useState(false);
  const [failed, setFailed] = useState(false);
  if (!videoId || failed) return <div className="absolute inset-0 flex items-center justify-center text-neutral-500"><Tv aria-label="Thumbnail unavailable" className="h-10 w-10" /></div>;
  const source = fallback ? `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/hqdefault.jpg` : `/api/thumbnails/${encodeURIComponent(videoId)}`;
  return <img src={source} alt={`${title} video thumbnail`} width={640} height={360}
    loading="lazy" decoding="async" referrerPolicy="no-referrer"
    onError={() => fallback ? setFailed(true) : setFallback(true)}
    className="absolute inset-0 h-full w-full object-cover" />;
}
