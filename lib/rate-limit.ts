import { DownloadError } from "./errors";
// A personal-app burst guard, per warm function instance. Use Vercel Firewall
// for a durable global limit if exposing this app to a large public audience.
const windows = new Map<string, { start: number; count: number }>();
export function checkRateLimit(request: Request, bucket: "resolve" | "file") {
  const now = Date.now();
  const address = (request.headers.get("x-vercel-forwarded-for") ?? request.headers.get("x-forwarded-for") ?? "local").split(",")[0].trim().slice(0,80);
  const key = `${bucket}:${address}`;
  const window = windows.get(key);
  if (!window || now - window.start > 60_000) windows.set(key, { start: now, count: 1 });
  else if (++window.count > (bucket === "resolve" ? 15 : 45)) throw new DownloadError("A few too many requests. Wait a minute, then try again.", "RATE_LIMIT", 429);
  if (windows.size > 5000) for (const [key, value] of windows) if (now - value.start > 60_000) windows.delete(key);
}
