import { signTicket } from "../tickets";
import { safeMediaUrl } from "../urls";
import type { MediaItem, MediaVariant } from "../types";

export type JsonRecord = Record<string, unknown>;
export function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}
export function text(value: unknown, fallback = ""): string { return typeof value === "string" ? value : fallback; }
export function array(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }
export function positive(value: unknown): number | undefined { return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined; }
export function imageMime(url: string): MediaVariant["mimeType"] {
  const u = new URL(url);
  const ext = u.searchParams.get("format") ?? u.pathname.split(".").pop()?.toLowerCase();
  return ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
}
export function imageExtension(mime: MediaVariant["mimeType"]) { return mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg"; }

export function variant(id: string, url: string, label: string, filename: string, mimeType: MediaVariant["mimeType"], size?: number): MediaVariant {
  return { id, url, label, filename, mimeType, size, downloadUrl: `/api/file?token=${signTicket({ url, filename, mimeType })}` };
}
export function imageItem(id: string, value: unknown, filename: string): MediaItem | undefined {
  const url = safeMediaUrl(value);
  if (!url) return;
  const mime = imageMime(url);
  return { id, type: "image", thumbnail: url, variants: [variant(`${id}-original`, url, "Original image", `${filename}.${imageExtension(mime)}`, mime)] };
}

export function walkObjects(value: unknown, visit: (value: JsonRecord) => void) {
  const queue: { value: unknown; depth: number }[] = [{ value, depth: 0 }];
  let count = 0;
  while (queue.length && count++ < 30_000) {
    const entry = queue.pop()!;
    if (!entry.value || typeof entry.value !== "object" || entry.depth > 45) continue;
    if (!Array.isArray(entry.value)) visit(entry.value as JsonRecord);
    for (const child of Object.values(entry.value)) if (child && typeof child === "object") queue.push({ value: child, depth: entry.depth + 1 });
  }
}
