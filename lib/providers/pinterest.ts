import { DownloadError } from "../errors";
import { fetchAllowed, readBoundedText, readJson } from "../network";
import { isPageUrl, safeMediaUrl } from "../urls";
import type { MediaItem, ResolveResult } from "../types";
import { imageItem, record, text, variant, walkObjects, type JsonRecord } from "./common";

function decode(value: string): string {
  return value.replace(/&(?:amp|quot|apos|lt|gt|#39|#x27);/g, entity => ({ "&amp;": "&", "&quot;": '"', "&apos;": "'", "&lt;": "<", "&gt;": ">", "&#39;": "'", "&#x27;": "'" })[entity] ?? entity);
}
function attributes(tag: string): Record<string,string> {
  return Object.fromEntries([...tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)].map(m => [m[1].toLowerCase(), decode(m[2] ?? m[3])]));
}
function meta(html: string, key: string) {
  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attrs = attributes(match[0]);
    if (attrs.property === key || attrs.name === key) return attrs.content;
  }
}

export function parsePinterest(html: string, sourceUrl: string): ResolveResult {
  let canonical = sourceUrl;
  for (const match of html.matchAll(/<link\b[^>]*>/gi)) {
    const attrs = attributes(match[0]);
    if (attrs.rel === "canonical" && attrs.href && isPageUrl(attrs.href, "pinterest") && /\/pin\/(\d+)\//.test(attrs.href)) canonical = attrs.href;
  }
  const id = canonical.match(/\/pin\/(?:[^/]*--)?(\d+)/)?.[1];
  if (!id) throw new DownloadError("Couldn't find this pin. Copy the full Pinterest pin link.", "INVALID_POST");
  const ownPins: JsonRecord[] = [];
  const schemas: JsonRecord[] = [];
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    const attrs = attributes(match[1]);
    if (attrs.type !== "application/ld+json" && !["__PWS_INITIAL_PROPS__", "__PWS_DATA__"].includes(attrs.id)) continue;
    try {
      const data = JSON.parse(match[2]);
      if (attrs.type === "application/ld+json") {
        walkObjects(data, obj => { if (["VideoObject", "SocialMediaPosting"].includes(text(obj["@type"]))) schemas.push(obj); });
      } else {
        // Scope extraction to the requested pin. Never collect global URLs:
        // the page also contains a feed of unrelated pins and previews.
        walkObjects(data, obj => { if (String(obj.id ?? "") === id && (obj.videos || obj.images || obj.story_pin_data)) ownPins.push(obj); });
      }
    } catch { /* Scripts can be truncated when the upstream blocks a request. */ }
  }
  const belongsToPin = (obj: JsonRecord) => {
    const identity = text(obj["@id"]) || text(record(obj.mainEntityOfPage)["@id"]);
    return identity.includes(`/pin/${id}/`);
  };
  const videoSchemas = schemas.filter(obj => obj["@type"] === "VideoObject" && belongsToPin(obj));
  const posting = schemas.find(obj => obj["@type"] === "SocialMediaPosting" && belongsToPin(obj));
  const videos = new Map<string, { url: string; thumbnail?: string; width: number; height: number }>();
  const addVideo = (obj: JsonRecord) => {
    const url = safeMediaUrl(obj.url ?? obj.contentUrl);
    if (!url || !new URL(url).pathname.endsWith(".mp4")) return;
    videos.set(url, { url, thumbnail: safeMediaUrl(obj.thumbnail ?? obj.thumbnailUrl), width: parseInt(String(obj.width)) || 0, height: parseInt(String(obj.height)) || 0 });
  };
  videoSchemas.forEach(addVideo);
  const media: MediaItem[] = [];
  // Each story page can contain distinct clips; preserve those as separate items.
  const ownVideoGroups: JsonRecord[] = [];
  const representedVideos = new Set<string>();
  let hasUndownloadableVideo = videoSchemas.length > 0;
  for (const pin of ownPins) {
    walkObjects(pin.videos ?? pin.story_pin_data, obj => {
      if (obj.video_list) { ownVideoGroups.push(obj); hasUndownloadableVideo = true; }
    });
    if (pin.videos || pin.story_pin_data) hasUndownloadableVideo = true;
  }
  for (const [index, group] of ownVideoGroups.entries()) {
    const candidates = Object.values(record(group.video_list)).map(record).flatMap(v => {
      const url = safeMediaUrl(v.url);
      return url && new URL(url).pathname.endsWith(".mp4") ? [{ url, thumbnail: safeMediaUrl(v.thumbnail), width: Number(v.width) || 0, height: Number(v.height) || 0 }] : [];
    }).sort((a,b) => b.width*b.height - a.width*a.height);
    const unique = [...new Map(candidates.map(v => [v.url, v])).values()].filter(v => !representedVideos.has(v.url));
    if (unique.length) {
      const itemId = `pinterest-${id}-${index + 1}`;
      media.push({ id: itemId, type: "video", thumbnail: unique[0].thumbnail ?? safeMediaUrl(meta(html, "og:image")), variants: unique.map((v,i) => {
        const label = v.width && v.height ? `${Math.min(v.width,v.height)}p` : "Best available";
        videos.delete(v.url);
        representedVideos.add(v.url);
        return variant(`${itemId}-${i}`, v.url, label, `${itemId}-${i + 1}.mp4`, "video/mp4");
      }) });
    }
  }
  if (!media.length && videos.size) {
    const variants = [...videos.values()].sort((a,b) => b.width*b.height - a.width*a.height).map((v,i) => variant(`pinterest-${id}-${i}`, v.url, new URL(v.url).pathname.match(/\/(\d+p)\//)?.[1] ?? "Best available", `pinterest-${id}-${i + 1}.mp4`, "video/mp4"));
    media.push({ id: `pinterest-${id}`, type: "video", thumbnail: [...videos.values()][0].thumbnail ?? safeMediaUrl(meta(html,"og:image")), variants });
  }
  if (!media.length && !hasUndownloadableVideo) {
    const ownImage = ownPins.map(pin => record(record(pin.images).orig).url).find(v => safeMediaUrl(v));
    const item = imageItem(`pinterest-${id}`, ownImage ?? posting?.image, `pinterest-${id}`);
    if (item) media.push(item);
  }
  if (!media.length) throw new DownloadError(hasUndownloadableVideo ? "Pinterest didn't expose an MP4 for this pin. Try another public pin." : "Couldn't read media from this pin. It may be private, removed, or blocked by Pinterest.", "NO_MEDIA");
  const pin = ownPins[0];
  const attribution = record(pin?.native_creator ?? pin?.closeup_attribution ?? pin?.pinner);
  return { platform: "pinterest", sourceUrl: canonical, title: (text(videoSchemas[0]?.name) || text(posting?.headline) || text(pin?.title) || text(pin?.grid_title) || meta(html,"og:title") || "Pinterest pin").slice(0,300), author: text(record(videoSchemas[0]?.creator ?? posting?.author).name) || text(attribution.full_name) || undefined, thumbnail: media[0].thumbnail, media };
}

export function parsePinterestResource(payload: unknown, id: string): ResolveResult {
  const response = record(record(payload).resource_response);
  const pin = record(response.data);
  if (response.status !== "success" || text(pin.id) !== id || (pin.privacy && pin.privacy !== "public")) {
    throw new DownloadError("Pinterest couldn't return this public pin.", "SOURCE_UNAVAILABLE");
  }
  // Adapt the resource into the same scoped structured-data parser. Escape '<'
  // so creator text cannot be mistaken for the end of a JSON script element.
  const data = JSON.stringify({ pin }).replace(/</g,"\\u003c");
  return parsePinterest(`<script id="__PWS_INITIAL_PROPS__" type="application/json">${data}</script>`, `https://www.pinterest.com/pin/${id}/`);
}

const RESOURCE_FIELDS = ["detailed", "unauth_react_main_pin"];

function shouldRetryPinterest(error: unknown): boolean {
  return error instanceof DownloadError
    ? error.code === "TIMEOUT" || error.code === "SOURCE_RETRYABLE" || (error.code === "SOURCE_UNAVAILABLE" && error.status === 429)
    : error instanceof Error && (error.name === "TimeoutError" || error instanceof TypeError);
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(signal.reason ?? new DOMException("Aborted", "AbortError")); return; }
    const onAbort = () => { clearTimeout(timer); reject(signal?.reason ?? new DOMException("Aborted", "AbortError")); };
    const timer = setTimeout(() => { signal?.removeEventListener("abort", onAbort); resolve(); }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

async function resolveResource(id: string, signal?: AbortSignal): Promise<ResolveResult> {
  const url = new URL("https://www.pinterest.com/resource/PinResource/get/");
  let lastError: unknown;
  for (const fieldSet of RESOURCE_FIELDS) {
    url.search = new URLSearchParams({ source_url: `/pin/${id}/`, data: JSON.stringify({ options: { id, field_set_key: fieldSet, noCache: true }, context: {} }) }).toString();
    for (let attempt = 0; attempt < 2; attempt++) {
      if (signal?.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
      try {
        const response = await fetchAllowed(url.href, value => isPageUrl(value,"pinterest"), {
          signal,
          headers: { "X-Pinterest-PWS-Handler": "www/pin/[id].js", "Accept": "application/json" },
        });
        return parsePinterestResource(await readJson(response),id);
      } catch (error) {
        lastError = error;
        if (signal?.aborted || !shouldRetryPinterest(error)) break;
        if (attempt === 0) await delay(300, signal);
      }
    }
    if (signal?.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
  }
  throw lastError ?? new DownloadError("Pinterest couldn't read this pin.", "SOURCE_UNAVAILABLE");
}

export async function resolvePinterest(sourceUrl: string, signal?: AbortSignal): Promise<ResolveResult> {
  const directId = new URL(sourceUrl).pathname.match(/\/pin\/(?:[^/]*--)?(\d+)/)?.[1];
  if (directId) {
    try { return await resolveResource(directId, signal); }
    catch { /* Some pins expose page data even when their resource is unavailable. */ }
  }
  if (signal?.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
  const response = await fetchAllowed(sourceUrl, url => isPageUrl(url, "pinterest"), { signal, headers: { "Accept-Language": "en-US,en;q=0.9" } });
  const html = await readBoundedText(response);
  // pin.it occasionally serves an app-link interstitial instead of HTTP redirect.
  if (new URL(sourceUrl).hostname === "pin.it" && !/<link[^>]*rel=["']canonical["']/i.test(html)) {
    for (const match of html.matchAll(/<(?:link|a)\b[^>]*>/gi)) {
      const attrs = attributes(match[0]);
      const href = attrs.href;
      if (!href) continue;
      let full = href;
      try { full = new URL(href).searchParams.get("url") ?? href; } catch { continue; }
      if (isPageUrl(full,"pinterest") && /\/pin\/(?:[^/]*--)?\d+/.test(full)) {
        return resolvePinterest(full, signal);
      }
    }
  }
  try { return parsePinterest(html, response.url || sourceUrl); }
  catch (error) {
    if (!directId) {
      let redirectedId = (response.url || sourceUrl).match(/\/pin\/(?:[^/]*--)?(\d+)/)?.[1];
      if (!redirectedId) for (const match of html.matchAll(/<link\b[^>]*>/gi)) {
        const attrs = attributes(match[0]);
        if (attrs.rel === "canonical" && attrs.href && isPageUrl(attrs.href,"pinterest")) redirectedId = attrs.href.match(/\/pin\/(?:[^/]*--)?(\d+)/)?.[1];
      }
      if (redirectedId) return resolveResource(redirectedId, signal);
    }
    throw error;
  }
}
