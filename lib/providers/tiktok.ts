import { DownloadError } from "../errors";
import { fetchAllowed, readJson } from "../network";
import { isProviderUrl, safeMediaUrl } from "../urls";
import type { MediaItem, ResolveResult } from "../types";
import { array, imageItem, positive, record, text, variant } from "./common";

export function parseTikTok(payload: unknown, sourceUrl: string): ResolveResult {
  const result = record(payload);
  if (result.code !== 0) throw new DownloadError("TikTok couldn't return this post. Check that it is public, then try again later.", "SOURCE_UNAVAILABLE");
  const data = record(result.data);
  const id = text(data.id);
  if (!/^\d+$/.test(id)) throw new DownloadError("TikTok returned incomplete media. Try again later.", "SOURCE_FORMAT");
  const media: MediaItem[] = [];
  for (const [index, url] of array(data.images).slice(0,40).entries()) {
    const image = imageItem(`tiktok-${id}-${index + 1}`, url, `tiktok-${id}-${index + 1}`);
    if (image) media.push(image);
  }
  if (!media.length) {
    const seen = new Set<string>();
    const variants = [{ value: data.hdplay, label: "HD", key: "hd", size: data.hd_size }, { value: data.play, label: "Standard", key: "standard", size: data.size }].flatMap(v => {
      const url = safeMediaUrl(v.value);
      if (!url || seen.has(url)) return [];
      seen.add(url);
      return [variant(`tiktok-${id}-${v.key}`, url, v.label, `tiktok-${id}-${v.key}.mp4`, "video/mp4", positive(v.size))];
    });
    if (variants.length) media.push({ id: `tiktok-${id}`, type: "video", thumbnail: safeMediaUrl(data.cover), variants });
  }
  if (!media.length) throw new DownloadError("No downloadable video or photos were returned for this post.", "NO_MEDIA");
  return { platform: "tiktok", sourceUrl, title: text(data.title, "TikTok post").slice(0,300), author: text(record(data.author).nickname) || undefined, thumbnail: safeMediaUrl(data.cover) ?? media[0].thumbnail, media };
}

export async function resolveTikTok(sourceUrl: string): Promise<ResolveResult> {
  const url = new URL("https://www.tikwm.com/api/");
  url.search = new URLSearchParams({ url: sourceUrl, hd: "1" }).toString();
  const response = await fetchAllowed(url.href, isProviderUrl);
  return parseTikTok(await readJson(response), sourceUrl);
}
