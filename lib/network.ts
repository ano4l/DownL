import { DownloadError } from "./errors";

export const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

export async function fetchAllowed(url: string, allowed: (url: string) => boolean, init: RequestInit = {}): Promise<Response> {
  const timeout = AbortSignal.timeout(20_000);
  const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
  let current = url;
  for (let hop = 0; hop < 6; hop++) {
    if (!allowed(current)) throw new DownloadError("The source returned an unsupported download location.", "UNSAFE_URL", 422);
    const response = await fetch(current, { ...init, signal, redirect: "manual", cache: "no-store", headers: { "User-Agent": USER_AGENT, ...init.headers } });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel();
      const location = response.headers.get("location");
      if (!location) throw new DownloadError("The source returned a broken link.");
      current = new URL(location, current).href;
      // All calls are GET/HEAD; never forward credentials or user cookies.
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel();
      const retryable = response.status === 429 || response.status >= 500;
      throw new DownloadError(response.status === 429 ? "The source is busy. Wait a moment and try again." : "This post is unavailable, private, or the source blocked the request.", retryable && response.status >= 500 ? "SOURCE_RETRYABLE" : "SOURCE_UNAVAILABLE", retryable ? response.status : 422);
    }
    return response;
  }
  throw new DownloadError("This link redirects too many times. Copy the full post link instead.", "REDIRECT_LIMIT", 400);
}

export async function readBoundedText(response: Response, max = 6 * 1024 * 1024): Promise<string> {
  if (!response.body) throw new DownloadError("The source returned an empty response.");
  const reader = response.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > max) throw new DownloadError("The source response was too large. Try another post.", "SOURCE_TOO_LARGE");
      parts.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally { reader.releaseLock(); }
  return Buffer.concat(parts).toString("utf8");
}

export async function readJson(response: Response): Promise<unknown> {
  try { return JSON.parse(await readBoundedText(response, 2 * 1024 * 1024)); }
  catch (error) {
    if (error instanceof SyntaxError) throw new DownloadError("The source couldn't read this post. Try again later.", "SOURCE_FORMAT");
    throw error;
  }
}
