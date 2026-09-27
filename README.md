# Pocket

A phone-first Pinterest, X / Twitter and TikTok downloader built with Next.js, ready for Vercel. Paste a post link (or copied share text), preview its real media, choose an available quality, then download or share the file. No account or database is needed.

**Live app:** https://pocket-downloader.vercel.app

## On your phone

1. Open the deployed site in Safari on iPhone or Chrome on Android.
2. Tap **Get the app** for Add to Home Screen / Install instructions.
3. Copy a post's link, paste it, and tap **Get media**.
4. **Download video / image** saves directly through the browser. For the gallery, tap **Prepare to save to gallery**, then **Save to gallery / Share file**. That second tap opens the native file share sheet where supported.

On iPhone, choose **Save Video** or **Save Image** in the share sheet. If unavailable, download to Files, open the file, and use Share. On Android, browser downloads go to Downloads; gallery apps may show them automatically, or you can move them to Pictures / Movies. Websites cannot silently write into a phone's gallery. Native share support and destinations depend on the browser and device.

Installed Android browsers that support Web Share Target can send a post link directly to Pocket from another app's share menu. iPhone uses copy / paste. Recent links are stored on this device and re-resolved when opened; media files are not kept in that list. The app shell can open offline, but media extraction and downloads require a connection.

## Development

Requires Node.js 22 or 24. Dependencies are pinned in package.json and package-lock.json.

```sh
npm ci
npm run dev
```

Development creates an in-memory signing key if `DOWNLOAD_SECRET` is absent. For production or stable local tickets, copy `.env.example` to `.env.local` and set a random secret of at least 32 characters:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

## Deploy on Vercel

Import this directory as a Next.js project or run `vercel link`. Set **DOWNLOAD_SECRET** in the project's Production environment before deploying. Use a separate Preview setting if enabling preview downloads. Do not expose this secret as a NEXT_PUBLIC variable.

```sh
npm run check
npm run build
vercel --prod
```

The API resolves only public post URLs. Downloads require a signed ticket valid for 15 minutes; the media route permits only known source CDN domains and checks every redirect. Media is streamed through a same-origin attachment route, never stored on the server or buffered into a large serverless response. The direct download limit is 200 MiB. File sharing preparation is limited to 80 MiB to avoid excessive phone memory use; larger files use direct download. Requests are bounded with source timeouts, page response limits and a per-instance burst guard. For a widely advertised public service, configure a durable global limit in Vercel Firewall; the built-in limiter is not shared across serverless instances.

## Sources and reliability

This is an original web implementation informed by the supplied projects, not a wrapper that runs desktop programs on Vercel:

- [PinterestVideoDownloader](https://github.com/UxHarshit/PinterestVideoDownloader) is a Python page extractor. Pocket first uses Pinterest's public pin resource, then falls back to structured page data, with MP4 links scoped to the requested / canonical pin. It avoids unrelated recommendations. Images are supported; HLS-only pins currently return an explanatory error. The resource approach is also used by [yt-dlp's Pinterest extractor](https://github.com/yt-dlp/yt-dlp/blob/master/yt_dlp/extractor/pinterest.py).
- [TwitterMediaHarvest](https://github.com/EltonChou/TwitterMediaHarvest) is a browser extension. Pocket instead uses X's public syndication endpoint, preserving mixed photo/video posts and MP4 qualities. It can also read unified media cards. Private, restricted, non-embeddable or removed posts may fail; not all media is exposed by syndication.
- [Tikorgzo](https://github.com/Scoofszlo/Tikorgzo) uses TikWM and, for some flows, a desktop browser. Pocket calls the [TikWM API](https://www.tikwm.com/) directly and supports video qualities and photo posts. The post URL is sent to TikWM for resolution. Third-party availability, rate limits, CDN restrictions and quality can change. HD is offered only when returned; no guaranteed 4K or original-source quality claim is made.

No platform login cookies are collected or forwarded. The service worker caches only the app shell and its static assets, never media API results or files. Media previews load from the source CDN. Save content you have permission to keep.

## Verification

```sh
npm run check
node scripts/smoke.mjs http://localhost:3017
node scripts/smoke.mjs https://YOUR-PRODUCTION-DOMAIN
```

Tests cover URL boundaries, redirect safety, signed tickets, canonical-pin extraction, mixed X media, TikTok photo posts, request validation, and a streamed attachment larger than 4.5 MB. The live smoke script contacts all three services, checks download byte counts and MP4 signatures, and prints no download tickets. See VERIFICATION.md for observed results and physical-device limits.
