export async function GET(_request: Request, { params }: { params: Promise<{ videoId: string }> }) {
  const { videoId } = await params;
  if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) return new Response("Invalid video ID", { status: 400 });
  // Only fetch public YouTube images from a fixed host.
  for (const size of ["maxresdefault", "hqdefault"]) {
    try {
      const response = await fetch(`https://i.ytimg.com/vi/${videoId}/${size}.jpg`, {
        signal: AbortSignal.timeout(8000),
      });
      const contentType = response.headers.get("content-type") || "";
      if (!response.ok || !contentType.startsWith("image/")) continue;
      return new Response(await response.arrayBuffer(), { headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
        "X-Content-Type-Options": "nosniff",
      } });
    } catch {
      // Fall back to the standard image if the larger image is unavailable.
    }
  }
  return new Response("Thumbnail unavailable", { status: 502, headers: { "Cache-Control": "no-store" } });
}
