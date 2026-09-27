export type Platform = "pinterest" | "twitter" | "tiktok";

export interface MediaVariant {
  id: string;
  label: string;
  url: string;
  downloadUrl: string;
  mimeType: "video/mp4" | "image/jpeg" | "image/png" | "image/webp";
  filename: string;
  size?: number;
}

export interface MediaItem {
  id: string;
  type: "video" | "image";
  thumbnail?: string;
  variants: MediaVariant[];
}

export interface ResolveResult {
  platform: Platform;
  sourceUrl: string;
  title: string;
  author?: string;
  thumbnail?: string;
  media: MediaItem[];
  notice?: string;
}
