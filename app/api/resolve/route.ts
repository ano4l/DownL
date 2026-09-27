import { DownloadError, errorResponse } from "@/lib/errors";
import { readBoundedText } from "@/lib/network";
import { checkRateLimit } from "@/lib/rate-limit";
import { parsePostInput } from "@/lib/urls";
import { resolvePinterest } from "@/lib/providers/pinterest";
import { resolveTwitter } from "@/lib/providers/twitter";
import { resolveTikTok } from "@/lib/providers/tiktok";

export const runtime = "nodejs";
export const maxDuration = 60;
export async function POST(request: Request) {
  try {
    const origin = request.headers.get("origin");
    // Next's request URL can use its bind address (0.0.0.0) locally. Host is
    // the public authority; browsers cannot override it on cross-origin fetches.
    const requestUrl = new URL(request.url);
    const host = request.headers.get("host") ?? requestUrl.host;
    const protocol = request.headers.get("x-forwarded-proto")?.split(",")[0].trim() ?? requestUrl.protocol.slice(0,-1);
    if (origin && origin !== `${protocol}://${host}`) throw new DownloadError("Open the app to get media.", "BAD_ORIGIN", 403);
    checkRateLimit(request,"resolve");
    if (!request.headers.get("content-type")?.includes("application/json")) throw new DownloadError("Send the link as JSON.", "INVALID_REQUEST", 400);
    let body: { url?: unknown };
    try { body = JSON.parse(await readBoundedText(new Response(request.body), 5000)); }
    catch { throw new DownloadError("That link couldn't be read. Paste it again.", "INVALID_REQUEST", 400); }
    const { platform, url, id } = parsePostInput(body?.url);
    const result = platform === "pinterest" ? await resolvePinterest(url.href) : platform === "twitter" ? await resolveTwitter(id!) : await resolveTikTok(url.href);
    return Response.json(result, { headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  } catch (error) { return errorResponse(error); }
}
