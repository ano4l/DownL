import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { DownloadError } from "./errors";
import { isMediaUrl } from "./urls";
import type { MediaVariant } from "./types";

type Ticket = { url: string; filename: string; mimeType: MediaVariant["mimeType"]; expires: number };
const developmentSecret = randomBytes(32).toString("hex");
function secret() {
  const key = process.env.DOWNLOAD_SECRET;
  if (key && key.length >= 32) return key;
  if (process.env.VERCEL || process.env.NODE_ENV === "production") throw new DownloadError("The app needs its DOWNLOAD_SECRET setting. Please contact the owner.", "CONFIGURATION", 503);
  return developmentSecret;
}
const mimes = ["video/mp4", "image/jpeg", "image/png", "image/webp"];
export function signTicket(variant: Omit<Ticket, "expires">, now = Date.now()): string {
  if (!isMediaUrl(variant.url)) throw new DownloadError("Unsupported media source.", "UNSAFE_URL");
  const payload = Buffer.from(JSON.stringify({ ...variant, expires: now + 15 * 60_000 })).toString("base64url");
  const sig = createHmac("sha256", secret()).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}
export function verifyTicket(token: string | null, now = Date.now()): Ticket {
  if (!token || token.length > 14_000) throw new DownloadError("This download link is invalid. Get the media again.", "INVALID_TICKET", 400);
  const pieces = token.split(".");
  if (pieces.length !== 2) throw new DownloadError("This download link is invalid. Get the media again.", "INVALID_TICKET", 400);
  const [payload, sig] = pieces;
  const expected = createHmac("sha256", secret()).update(payload).digest();
  const actual = Buffer.from(sig, "base64url");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new DownloadError("This download link is invalid. Get the media again.", "INVALID_TICKET", 400);
  let ticket: Ticket;
  try { ticket = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")); }
  catch { throw new DownloadError("This download link is invalid.", "INVALID_TICKET", 400); }
  if (typeof ticket.expires !== "number" || ticket.expires <= now || ticket.expires > now + 16 * 60_000) throw new DownloadError("This download link expired. Get the media again.", "EXPIRED_TICKET", 410);
  if (typeof ticket.url !== "string" || !isMediaUrl(ticket.url) || !mimes.includes(ticket.mimeType) || !/^[A-Za-z0-9._-]{1,120}$/.test(ticket.filename)) throw new DownloadError("This download link is invalid.", "INVALID_TICKET", 400);
  return ticket;
}
