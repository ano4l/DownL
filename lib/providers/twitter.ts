import { DownloadError } from "../errors";
import { fetchAllowed, readJson } from "../network";
import { isProviderUrl, safeMediaUrl } from "../urls";
import type { MediaItem, ResolveResult } from "../types";
import { array, imageItem, record, text, variant } from "./common";

export function parseTwitter(data: unknown, id: string): ResolveResult {
  const tweet = record(data);
  if (!tweet.id_str || text(tweet.id_str) !== id) throw new DownloadError("X couldn't return this post. It may be private, deleted or unavailable for embedding.", "SOURCE_UNAVAILABLE");
  const details = array(tweet.mediaDetails);
  const unifiedCard = record(record(record(tweet.card).binding_values).unified_card).string_value;
  if (typeof unifiedCard === "string") {
    try { details.push(...Object.values(record(record(JSON.parse(unifiedCard)).media_entities))); } catch { /* Optional card data. */ }
  }
  if (!details.length) {
    for (const p of array(tweet.photos)) details.push({ type: "photo", media_url_https: record(p).url });
    const v = record(tweet.video);
    if (v.variants) details.push({ type: "video", media_url_https: v.poster, video_info: { variants: array(v.variants).map(x => ({ content_type: record(x).type, url: record(x).src })) } });
  }
  const media: MediaItem[] = [];
  const seen = new Set<string>();
  for (const [index, raw] of details.entries()) {
    const detail = record(raw);
    const thumbnail = safeMediaUrl(detail.media_url_https);
    const itemId = `twitter-${id}-${index + 1}`;
    if (detail.type === "photo" && thumbnail) {
      const u = new URL(thumbnail);
      u.searchParams.set("name", "orig");
      const image = imageItem(itemId, u.href, itemId);
      if (image && !seen.has(u.href)) { media.push(image); seen.add(u.href); }
      continue;
    }
    const videos = array(record(detail.video_info).variants)
      .map(record)
      .filter(v => v.content_type === "video/mp4" && safeMediaUrl(v.url))
      .sort((a,b) => Number(b.bitrate ?? 0) - Number(a.bitrate ?? 0));
    const variants = videos.flatMap((v,i) => {
      const url = safeMediaUrl(v.url)!;
      if (seen.has(url)) return [];
      seen.add(url);
      const dimensions = new URL(url).pathname.match(/\/(\d+)x(\d+)\//);
      const label = dimensions ? `${Math.min(Number(dimensions[1]), Number(dimensions[2]))}p` : i === 0 ? "Best available" : `Quality ${i + 1}`;
      return [variant(`${itemId}-${i}`, url, label, `${itemId}-${dimensions ? label : i + 1}.mp4`, "video/mp4")];
    });
    if (variants.length) media.push({ id: itemId, type: "video", thumbnail, variants });
  }
  if (!media.length) throw new DownloadError("No downloadable photos or MP4 video were found. X doesn't expose all posts through its public embed service.", "NO_MEDIA");
  return { platform: "twitter", sourceUrl: `https://x.com/i/status/${id}`, title: text(tweet.text, "X post").slice(0,300), author: text(record(tweet.user).name) || undefined, thumbnail: media[0].thumbnail, media };
}

export async function resolveTwitter(id: string): Promise<ResolveResult> {
  const token = ((Number(id) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, "");
  const url = new URL("https://cdn.syndication.twimg.com/tweet-result");
  url.search = new URLSearchParams({ id, token, lang: "en" }).toString();
  const response = await fetchAllowed(url.href, isProviderUrl);
  return parseTwitter(await readJson(response), id);
}
