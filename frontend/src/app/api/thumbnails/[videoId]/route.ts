import { NextResponse } from "next/server";

export async function GET(_request: Request, { params }: { params: { videoId: string } }) {
  const id = params.videoId;
  if (!/^[A-Za-z0-9_-]{11}$/.test(id)) return new NextResponse("Invalid video ID", { status: 400 });

  // Public thumbnails only: never accept an arbitrary upstream URL.
  for (const size of ["maxresdefault", "hqdefault"]) {
    try {
      const response = await fetch(`https://i.ytimg.com/vi/${id}/${size}.jpg`, {
        next: { revalidate: 3600 },
        signal: AbortSignal.timeout(8000),
      });
      const contentType = response.headers.get("content-type") || "";
      if (!response.ok || !contentType.startsWith("image/")) continue;
      return new NextResponse(await response.arrayBuffer(), {
        headers: {
          "Content-Type": contentType,
          "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
          "X-Content-Type-Options": "nosniff",
        },
      });
    } catch {
      // Try the standard thumbnail when the larger image is unavailable.
    }
  }
  return new NextResponse("Thumbnail unavailable", { status: 502, headers: { "Cache-Control": "no-store" } });
}
