import { DownloadError } from "./errors";
import type { Platform } from "./types";

const PINTEREST_DOMAINS = ["pinterest.com", "pinterest.co.uk", "pinterest.ca", "pinterest.de", "pinterest.fr", "pinterest.es", "pinterest.it", "pinterest.pt", "pinterest.com.au", "pinterest.jp", "pinterest.co.kr", "pinterest.cl", "pinterest.com.mx", "pinterest.nz", "pinterest.at", "pinterest.ch", "pinterest.se", "pinterest.dk", "pinterest.ie"];
const MEDIA_DOMAINS = ["pinimg.com", "twimg.com", "tiktokcdn.com", "tiktokcdn-us.com", "tiktokcdn-eu.com", "tiktokv.com", "byteoversea.com", "ibytedtos.com", "muscdn.com", "musical.ly", "tikwm.com"];

export function domainMatches(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

function checkedUrl(input: string): URL {
  let url: URL;
  try { url = new URL(input); } catch { throw new DownloadError("Paste a complete Pinterest, X or TikTok post link.", "INVALID_URL", 400); }
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) {
    throw new DownloadError("Use a public HTTPS post link.", "INVALID_URL", 400);
  }
  return url;
}

export function platformForHost(host: string): Platform | undefined {
  if (host === "pin.it" || PINTEREST_DOMAINS.some(d => domainMatches(host, d))) return "pinterest";
  if (["x.com", "twitter.com"].some(d => [d, `www.${d}`, `m.${d}`, `mobile.${d}`].includes(host))) return "twitter";
  if (["tiktok.com", "www.tiktok.com", "m.tiktok.com", "vm.tiktok.com", "vt.tiktok.com"].includes(host)) return "tiktok";
}

export function parsePostInput(input: unknown): { url: URL; platform: Platform; id?: string } {
  if (typeof input !== "string" || input.length > 4000) throw new DownloadError("Paste one Pinterest, X or TikTok post link.", "INVALID_URL", 400);
  const candidates = input.trim().match(/https?:\/\/[^\s<>"']+/gi) ?? [];
  const candidate = candidates.find(s => {
    try { return platformForHost(new URL(s.replace(/[),.!?;]+$/, "")).hostname); } catch { return false; }
  });
  const url = checkedUrl((candidate ?? input.trim()).replace(/[),.!?;]+$/, ""));
  const platform = platformForHost(url.hostname);
  if (!platform) throw new DownloadError("This app supports Pinterest, X / Twitter and TikTok links.", "UNSUPPORTED_PLATFORM", 400);
  let id: string | undefined;
  if (platform === "pinterest" && url.hostname !== "pin.it") {
    id = url.pathname.match(/^\/pin\/(?:[^/]*--)?(\d+)\/?$/)?.[1];
    if (!id) throw new DownloadError("Copy the link to a pin, rather than a board or profile.", "INVALID_POST", 400);
    return { platform, id, url: new URL(`https://www.pinterest.com/pin/${id}/`) };
  }
  if (platform === "twitter") {
    id = url.pathname.match(/^\/(?:[A-Za-z0-9_]+\/status|i\/web\/status|i\/status)\/(\d+)(?:\/(?:video|photo)\/\d+)?\/?$/)?.[1];
    if (!id) throw new DownloadError("Copy the link to an X post, rather than a profile.", "INVALID_POST", 400);
    return { platform, id, url: new URL(`https://x.com/i/status/${id}`) };
  }
  if (platform === "tiktok") {
    id = url.pathname.match(/^\/@[^/]+\/(?:video|photo)\/(\d+)\/?$/)?.[1];
    if (!id && !["vm.tiktok.com", "vt.tiktok.com"].includes(url.hostname) && !/^\/t\/[\w-]+\/?$/.test(url.pathname)) {
      throw new DownloadError("Copy the link to a TikTok video or photo post.", "INVALID_POST", 400);
    }
    url.search = "";
  } else if (!/^\/[\w-]+\/?$/.test(url.pathname)) {
    throw new DownloadError("That Pinterest short link doesn't look complete.", "INVALID_POST", 400);
  }
  url.hash = "";
  return { url, platform, id };
}

export function isMediaUrl(input: string): boolean {
  try {
    const u = checkedUrl(input);
    return MEDIA_DOMAINS.some(d => domainMatches(u.hostname, d));
  } catch { return false; }
}

export function isPageUrl(input: string, platform?: Platform): boolean {
  try {
    const u = checkedUrl(input);
    const found = platformForHost(u.hostname);
    return !!found && (!platform || found === platform);
  } catch { return false; }
}

export function isProviderUrl(input: string): boolean {
  try {
    const u = checkedUrl(input);
    return ["www.tikwm.com", "tikwm.com", "cdn.syndication.twimg.com"].includes(u.hostname);
  } catch { return false; }
}

export function safeMediaUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 6000) return;
  const url = value.startsWith("/") ? `https://www.tikwm.com${value}` : value.replace(/^http:/, "https:");
  return isMediaUrl(url) ? url : undefined;
}
