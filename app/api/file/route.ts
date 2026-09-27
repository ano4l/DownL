import { DownloadError, errorResponse } from "@/lib/errors";
import { fetchAllowed } from "@/lib/network";
import { checkRateLimit } from "@/lib/rate-limit";
import { verifyTicket } from "@/lib/tickets";
import { isMediaUrl } from "@/lib/urls";

export const runtime = "nodejs";
export const maxDuration = 300;
const MAX_BYTES = 200 * 1024 * 1024;

export async function GET(request: Request) {
  try {
    checkRateLimit(request,"file");
    const ticket = verifyTicket(new URL(request.url).searchParams.get("token"));
    const upstreamController = new AbortController();
    const signal = AbortSignal.any([request.signal, upstreamController.signal, AbortSignal.timeout(240_000)]);
    const upstream = await fetchAllowed(ticket.url, isMediaUrl, { signal, headers: { "Accept": `${ticket.mimeType},application/octet-stream;q=0.9` } });
    if (!upstream.body) throw new DownloadError("The source returned an empty file.");
    const size = Number(upstream.headers.get("content-length"));
    if (size > MAX_BYTES) {
      await upstream.body.cancel();
      throw new DownloadError("This file is over 200 MB. Choose a smaller quality.", "FILE_TOO_LARGE", 413);
    }
    const upstreamMime = upstream.headers.get("content-type")?.split(";")[0].trim();
    if (upstreamMime && !["video/mp4", "image/jpeg", "image/png", "image/webp", "application/octet-stream", "binary/octet-stream"].includes(upstreamMime)) {
      await upstream.body.cancel();
      throw new DownloadError("The source returned a page instead of a media file. Get the media again.", "SOURCE_FORMAT");
    }
    const reader = upstream.body.getReader();
    let sent = 0;
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const { done, value } = await reader.read();
          if (done) { reader.releaseLock(); controller.close(); return; }
          sent += value.byteLength;
          if (sent > MAX_BYTES) throw new Error("File too large");
          controller.enqueue(value);
        } catch (error) { upstreamController.abort(); await reader.cancel().catch(() => {}); controller.error(error); }
      },
      async cancel() { upstreamController.abort(); await reader.cancel().catch(() => {}); },
    });
    const headers = new Headers({
      "Content-Type": ticket.mimeType,
      "Content-Disposition": `attachment; filename="${ticket.filename}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "X-Robots-Tag": "noindex, nofollow",
    });
    if (size > 0) { headers.set("Content-Length", String(size)); headers.set("X-File-Size", String(size)); }
    // Forward a stream, never buffer video in a serverless response or save it to disk.
    return new Response(body, { headers });
  } catch (error) { return errorResponse(error); }
}
