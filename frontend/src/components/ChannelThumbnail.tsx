"use client";

import { useState } from "react";
import { Tv } from "lucide-react";

export default function ChannelThumbnail({ videoId, title }: { videoId?: string; title: string }) {
  const [failed, setFailed] = useState(false);
  if (!videoId || failed) return <Tv aria-label="Thumbnail unavailable" className="absolute inset-0 m-auto h-10 w-10 text-neutral-600" />;
  return <img src={`/api/thumbnails/${encodeURIComponent(videoId)}`} alt={`${title} thumbnail`}
    referrerPolicy="no-referrer" onError={() => setFailed(true)}
    className="absolute inset-0 h-full w-full object-cover" />;
}
