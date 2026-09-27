"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowDownToLine, ArrowRight, Check, Clipboard, Clock3, ExternalLink, HelpCircle, Link2, LoaderCircle, Plus, Smartphone, Trash2, WifiOff, X } from "lucide-react";
import { MediaCard } from "@/components/media-card";
import type { Platform, ResolveResult } from "@/lib/types";

interface RecentLink { url: string; title: string; platform: Platform; thumbnail?: string; openedAt: number }
interface InstallEvent extends Event { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> }
const RECENT_KEY = "pocket:recent:v1";
const platformName: Record<Platform, string> = { pinterest: "Pinterest", twitter: "X / Twitter", tiktok: "TikTok" };

function PlatformMark({ platform }: { platform: Platform }) {
  if (platform === "pinterest") return <span className="platform-mark pinterest" aria-hidden="true">P</span>;
  if (platform === "twitter") return <span className="platform-mark twitter" aria-hidden="true">𝕏</span>;
  return <span className="platform-mark tiktok" aria-hidden="true">♪</span>;
}

export default function Home() {
  const [tab, setTab] = useState<"download" | "recent">("download");
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [clipboardNote, setClipboardNote] = useState("");
  const [result, setResult] = useState<ResolveResult | null>(null);
  const [recent, setRecent] = useState<RecentLink[]>([]);
  const [storageReady, setStorageReady] = useState(false);
  const [storageNote, setStorageNote] = useState("");
  const [offline, setOffline] = useState(false);
  const [dialogMode, setDialogMode] = useState<"help" | "install">("help");
  const [installPrompt, setInstallPrompt] = useState<InstallEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [installBusy, setInstallBusy] = useState(false);
  const [installNote, setInstallNote] = useState("");
  const controller = useRef<AbortController | null>(null);
  const requestId = useRef(0);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const resultsRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const shared = [query.get("url"), query.get("text"), query.get("title")].filter(Boolean).join("\n");
    if (shared) setInput(shared);
    try {
      const stored: unknown = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
      if (Array.isArray(stored)) setRecent(stored.filter((entry): entry is RecentLink => entry && typeof entry.url === "string" && /^https?:\/\//.test(entry.url) && typeof entry.title === "string" && ["pinterest", "twitter", "tiktok"].includes(entry.platform) && typeof entry.openedAt === "number" && Number.isFinite(entry.openedAt) && Math.abs(entry.openedAt) < 8.64e15 && (entry.thumbnail === undefined || typeof entry.thumbnail === "string")).slice(0, 20));
    } catch { setStorageNote("Recent links aren’t available in this browser session."); }
    setStorageReady(true);
    setOffline(!navigator.onLine);
    setInstalled(window.matchMedia("(display-mode: standalone)").matches || Boolean((navigator as Navigator & { standalone?: boolean }).standalone));
    const onOnline = () => setOffline(false);
    const onOffline = () => setOffline(true);
    const onInstall = (event: Event) => { event.preventDefault(); setInstallPrompt(event as InstallEvent); };
    const onInstalled = () => { setInstalled(true); setInstallPrompt(null); };
    window.addEventListener("online", onOnline); window.addEventListener("offline", onOffline); window.addEventListener("beforeinstallprompt", onInstall); window.addEventListener("appinstalled", onInstalled);
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
    return () => { requestId.current += 1; controller.current?.abort(); window.removeEventListener("online", onOnline); window.removeEventListener("offline", onOffline); window.removeEventListener("beforeinstallprompt", onInstall); window.removeEventListener("appinstalled", onInstalled); };
  }, []);

  useEffect(() => {
    if (!storageReady) return;
    try { localStorage.setItem(RECENT_KEY, JSON.stringify(recent)); } catch { setStorageNote("Your browser couldn’t save recent links. Downloads still work."); }
  }, [recent, storageReady]);

  useEffect(() => {
    if (!result) return;
    const frame = requestAnimationFrame(() => resultsRef.current?.scrollIntoView({ block: "start", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" }));
    return () => cancelAnimationFrame(frame);
  }, [result]);

  const resolve = useCallback(async (value: string) => {
    if (!value.trim()) { setError("Paste a Pinterest, X or TikTok link first."); inputRef.current?.focus(); return; }
    controller.current?.abort();
    const current = ++requestId.current;
    const abortController = new AbortController();
    controller.current = abortController;
    setLoading(true); setError(""); setClipboardNote(""); setResult(null); setTab("download"); setInput(value);
    try {
      const response = await fetch("/api/resolve", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: value }), signal: abortController.signal });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Couldn’t find media from this link. Check the link and try again.");
      if (!data.media?.length) throw new Error("No downloadable media was found. Try a public post with a video or images.");
      if (requestId.current !== current || abortController.signal.aborted) return;
      const resolved = data as ResolveResult;
      setResult(resolved);
      setRecent((previous) => [{ url: resolved.sourceUrl, title: resolved.title, platform: resolved.platform, thumbnail: resolved.thumbnail, openedAt: Date.now() }, ...previous.filter((entry) => entry.url !== resolved.sourceUrl)].slice(0, 20));
    } catch (caught) {
      if (requestId.current === current && !abortController.signal.aborted) setError(caught instanceof Error ? caught.message : "Couldn’t reach the downloader. Check your connection and try again.");
    } finally { if (requestId.current === current) { setLoading(false); controller.current = null; } }
  }, []);

  function cancel() { requestId.current += 1; controller.current?.abort(); controller.current = null; setLoading(false); setClipboardNote("Cancelled. Your link is still here."); }
  async function paste() {
    try { const text = await navigator.clipboard.readText(); if (text) { setInput(text); setError(""); setClipboardNote(""); inputRef.current?.focus(); } else setClipboardNote("Your clipboard is empty. Copy a post link first."); }
    catch { setClipboardNote("Tap the link box, then touch and hold to paste."); inputRef.current?.focus(); }
  }
  function openDialog(mode: "help" | "install") { setDialogMode(mode); setInstallNote(""); dialogRef.current?.showModal(); }
  async function install() {
    if (!installPrompt) return;
    setInstallBusy(true);
    try { await installPrompt.prompt(); const choice = await installPrompt.userChoice; setInstallNote(choice.outcome === "accepted" ? "Installation requested. Look for Pocket on your home screen." : "You can install Pocket another time."); setInstallPrompt(null); }
    catch { setInstallNote("Use your browser menu and choose Add to Home Screen or Install app."); }
    finally { setInstallBusy(false); }
  }

  return <div className="app-shell">
    <header className="app-header"><a href="/" className="brand" aria-label="Pocket home"><span className="brand-icon"><ArrowDownToLine size={23} strokeWidth={2.5} /></span><span>Pocket<span className="brand-period">.</span></span></a><div className="header-actions"><button className="install-button" onClick={() => openDialog("install")}><Smartphone size={17} /><span>{installed ? "On your phone" : "Get the app"}</span></button><button className="icon-button" aria-label="How to save media" onClick={() => openDialog("help")}><HelpCircle size={20} /></button></div></header>
    <main>
      <section className="intro"><div className="intro-kicker"><span /> A little keeper for your favorite things</div><h1>Good finds.<br /><span>Keep them.</span></h1><p>That video. That idea. That little inspiration.<br className="desktop-break" /> Save it from your feed to your phone.</p></section>
      <div className="workspace">
        <nav className="tabs" aria-label="Pocket views"><button className={tab === "download" ? "tab active" : "tab"} aria-current={tab === "download" ? "page" : undefined} onClick={() => setTab("download")}><ArrowDown size={17} />Download</button><button className={tab === "recent" ? "tab active" : "tab"} aria-current={tab === "recent" ? "page" : undefined} onClick={() => setTab("recent")}><Clock3 size={17} />Recent{recent.length ? <span className="tab-count">{recent.length}</span> : null}</button></nav>
        {offline ? <p className="offline-note" role="status"><WifiOff size={17} /> You’re offline. Reconnect to get or download media.</p> : null}
        {tab === "download" ? <section className="download-panel" aria-label="Download media">
          <form onSubmit={(event) => { event.preventDefault(); void resolve(input); }}>
            <div className="field-heading"><label htmlFor="post-link">Drop a link here</label><span>We’ll take it from there</span></div>
            <div className={`link-field${error ? " invalid" : ""}`}><Link2 size={20} className="link-field-icon" /><textarea ref={inputRef} id="post-link" placeholder="Paste a Pinterest, X or TikTok link…" value={input} onChange={(event) => { setInput(event.target.value); setError(""); setClipboardNote(""); }} disabled={loading} rows={2} autoComplete="off" autoCapitalize="none" spellCheck={false} aria-describedby={error ? "resolve-error" : "paste-note"} /><div className="field-actions">{input ? <button type="button" className="icon-button clear-input" aria-label="Clear link" disabled={loading} onClick={() => { setInput(""); setResult(null); setError(""); setClipboardNote(""); inputRef.current?.focus(); }}><X size={17} /></button> : null}<button type="button" className="paste-button" disabled={loading} onClick={paste}><Clipboard size={16} /> Paste</button></div></div>
            {error ? <p className="error-note" id="resolve-error" role="alert">{error}</p> : null}<p id="paste-note" className="clipboard-note" role="status">{clipboardNote}</p>
            {loading ? <div className="loading-actions"><button type="button" className="button primary" disabled><LoaderCircle size={19} className="spin" /><span role="status">Finding your media…</span></button><button type="button" className="button secondary cancel-resolve" onClick={cancel}>Cancel</button></div> : <button className="button primary get-media" type="submit" disabled={offline}><span>Get media</span><ArrowRight size={20} /></button>}
          </form>
          <div className="supported-platforms"><span>Works with</span>{(["pinterest", "twitter", "tiktok"] as Platform[]).map((platform) => <span className="platform-label" key={platform}><PlatformMark platform={platform} />{platformName[platform]}</span>)}</div>
        </section> : <section className="recent-panel" aria-label="Recent links"><div className="section-heading"><div><h2>Recent links</h2><p>Reopen a link. Files aren’t stored here.</p></div>{recent.length ? <button className="text-button" onClick={() => setRecent([])}>Clear all</button> : null}</div>{storageNote ? <p className="storage-note" role="status">{storageNote}</p> : null}{recent.length ? <ul className="recent-list">{recent.map((entry) => <li key={entry.url}><button className="recent-open" onClick={() => void resolve(entry.url)}><span className="recent-thumbnail">{entry.thumbnail ? <img src={entry.thumbnail} alt="" loading="lazy" onError={(event) => { event.currentTarget.style.display = "none"; }} /> : <PlatformMark platform={entry.platform} />}</span><span className="recent-copy"><strong>{entry.title || "Saved post"}</strong><span>{platformName[entry.platform]} · {new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(entry.openedAt)}</span></span><ArrowRight size={18} /></button><button className="icon-button delete-recent" aria-label={`Remove ${entry.title || "post"} from recent links`} onClick={() => setRecent((previous) => previous.filter((item) => item.url !== entry.url))}><Trash2 size={17} /></button></li>)}</ul> : <div className="empty-state"><span className="empty-icon"><Clock3 size={28} /></span><h3>Your next good find starts here.</h3><p>Links you open will appear here, ready for another visit.</p><button className="button secondary" onClick={() => { setTab("download"); setTimeout(() => inputRef.current?.focus(), 0); }}>Paste your first link<ArrowRight size={17} /></button></div>}</section>}
      </div>
      {tab === "download" && result ? <section ref={resultsRef} className="results" aria-label="Resolved media" aria-live="polite"><div className="section-heading result-heading"><div><div className="resolved-label"><Check size={15} /> Found your media <span>· {platformName[result.platform]}</span></div><h2>{result.title || "Your find is ready"}</h2>{result.author ? <p>{result.author}</p> : null}</div><a className="icon-button" href={result.sourceUrl} target="_blank" rel="noreferrer" aria-label="Open original post"><ExternalLink size={19} /></a></div>{result.notice ? <p className="result-notice">{result.notice}</p> : null}<div className="media-list">{result.media.map((item, index) => <MediaCard key={`${result.sourceUrl}:${item.id}`} item={item} index={index} total={result.media.length} />)}</div><p className="expiry-note">Download links expire after a short while. Get the media again if needed.</p></section> : null}
      {tab === "download" && !result ? <section className="how-it-works" aria-label="How it works"><div className="step"><span>01</span><div><h3>Find something good</h3><p>Copy its link from the share menu.</p></div></div><div className="step"><span>02</span><div><h3>Make it a keeper</h3><p>Paste here, then download or share to save.</p></div></div></section> : null}
      <aside className="saving-tip"><span className="tip-icon"><Smartphone size={20} /></span><p><strong>A quick note on saving</strong><span>On iPhone, tap Save video or image, then choose Save Video or Save Image in the share sheet. On Android, downloads go to Downloads; gallery visibility varies.</span></p><button className="icon-button" aria-label="More about saving to your phone" onClick={() => openDialog("help")}><Plus size={20} /></button></aside>
    </main>
    <footer className="app-footer"><span>Keep the good stuff.</span><span>For your own saves. Respect creators.</span><a href="https://www.virtukey.co.za/" target="_blank" rel="noreferrer">A VirtuKey project</a></footer>
    <dialog ref={dialogRef} className="help-dialog" aria-labelledby="dialog-title" onClick={(event) => { if (event.target === dialogRef.current) dialogRef.current.close(); }}><div className="dialog-header"><span className="brand-icon"><ArrowDownToLine size={22} /></span><button className="icon-button" onClick={() => dialogRef.current?.close()} aria-label="Close help"><X size={21} /></button></div>{dialogMode === "install" ? <><h2 id="dialog-title">{installed ? "Pocket is at home." : "A little closer to your feed."}</h2><p className="dialog-lead">Add Pocket to your home screen for next time.</p>{installed ? <p>Pocket is already running as an app on this device.</p> : <><div className="instruction"><span>iPhone / iPad</span><p>Open Pocket in Safari. Tap the browser’s Share button, then choose <strong>Add to Home Screen</strong>.</p></div><div className="instruction"><span>Android</span><p>{installPrompt ? "Tap below to install Pocket on your home screen." : "In Chrome, open the menu and choose Add to Home Screen or Install app."}</p></div><div className="instruction"><span>On a computer</span><p>Use the install icon in your browser’s address bar, if available.</p></div>{installPrompt ? <button className="button primary" disabled={installBusy} onClick={install}><Smartphone size={19} />{installBusy ? "Opening install…" : "Install Pocket"}</button> : null}<p role="status" className="install-note">{installNote}</p></>}</> : <><h2 id="dialog-title">From your feed.<br />To your phone.</h2><p className="dialog-lead">Save from the result card with one button.</p><div className="instruction"><span>iPhone / iPad</span><p>Pocket prepares supported files as soon as they appear. Tap <strong>Save video</strong> or <strong>Save image</strong>, then choose <strong>Save Video</strong> or <strong>Save Image</strong> in the share sheet. Files over 80 MB download directly to Files.</p></div><div className="instruction"><span>Android</span><p><strong>Download</strong> saves to your browser’s Downloads. Your gallery may pick it up automatically. If it doesn’t, open the file in Downloads or Files and move it to Pictures or Movies.</p></div><div className="instruction"><span>A few good-to-knows</span><p>Use public post links. Private posts and some media may not be available. Files over 80 MB download directly. Only save content you have permission to keep.</p></div><button className="button primary" onClick={() => dialogRef.current?.close()}>Got it<Check size={18} /></button></>}</dialog>
  </div>;
}
