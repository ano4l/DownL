"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowDown, Check, LoaderCircle, Share2, X } from "lucide-react";
import type { MediaItem } from "@/lib/types";

const MAX_MEMORY = 80 * 1024 * 1024;

export function MediaCard({ item, index, total }: { item: MediaItem; index: number; total: number }) {
  const [variantId, setVariantId] = useState(item.variants[0]?.id);
  const variant = item.variants.find((candidate) => candidate.id === variantId) ?? item.variants[0];
  const [file, setFile] = useState<File | null>(null);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [message, setMessage] = useState("");
  const [canShare, setCanShare] = useState(false);
  const active = useRef<AbortController | null>(null);
  const generation = useRef(0);

  useEffect(() => {
    generation.current += 1;
    active.current?.abort();
    active.current = null;
    setFile(null); setBlobUrl(null); setPreparing(false); setProgress(null); setMessage(""); setSharing(false); setCanShare(false);
    return () => { generation.current += 1; active.current?.abort(); };
  }, [variantId]);

  useEffect(() => () => { if (blobUrl) URL.revokeObjectURL(blobUrl); }, [blobUrl]);

  if (!variant) return null;

  async function prepare() {
    if (preparing || !variant) return;
    if (variant.size && variant.size > MAX_MEMORY) { setMessage("This file is large. Use Download to save it directly to Files or Downloads."); return; }
    const controller = new AbortController();
    active.current = controller;
    const request = ++generation.current;
    setPreparing(true); setProgress(null); setMessage("");
    try {
      const response = await fetch(variant.downloadUrl, { signal: controller.signal });
      if (!response.ok) throw new Error(response.status === 410 ? "This link expired. Get the media again for a fresh download." : "Couldn’t prepare this file. Try the Download button.");
      const length = Number(response.headers.get("content-length")) || Number(response.headers.get("x-file-size")) || 0;
      if (length > MAX_MEMORY) { await response.body?.cancel(); throw new Error("This file is large. Use Download to save it directly to Files or Downloads."); }
      if (!response.body) throw new Error("Your browser couldn’t prepare this file. Use Download instead.");
      const reader = response.body.getReader();
      const chunks: ArrayBuffer[] = [];
      let size = 0;
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > MAX_MEMORY) { await reader.cancel(); throw new Error("This file is large. Use Download to save it directly to Files or Downloads."); }
          chunks.push(value.slice().buffer as ArrayBuffer);
          if (generation.current === request) setProgress(length ? Math.min(100, Math.round(size / length * 100)) : null);
        }
      } finally { reader.releaseLock(); }
      if (controller.signal.aborted || generation.current !== request) return;
      const prepared = new File(chunks, variant.filename, { type: variant.mimeType });
      const supported = typeof navigator.share === "function" && typeof navigator.canShare === "function" && navigator.canShare({ files: [prepared] });
      setFile(prepared); setBlobUrl(URL.createObjectURL(prepared)); setCanShare(supported);
      setMessage(supported ? "Ready. Open the share sheet to choose where to save." : "Ready to download. Your browser doesn’t support sharing this file.");
    } catch (error) {
      if (generation.current === request && !controller.signal.aborted) setMessage(error instanceof Error ? error.message : "Couldn’t prepare this file. Try Download.");
    } finally { if (generation.current === request) { active.current = null; setPreparing(false); } }
  }

  function share() {
    if (!file || !canShare || sharing) return;
    // Invoke share directly in this second tap; preparation never consumes its activation.
    const request = generation.current;
    try {
      const result = navigator.share({ files: [file] });
      setSharing(true);
      result.then(() => { if (generation.current === request) setMessage("File shared. Where it was saved depends on the option you chose."); }).catch((error: unknown) => {
        if (generation.current === request) setMessage(error instanceof DOMException && error.name === "AbortError" ? "Sharing cancelled. Your file is still ready." : "Couldn’t open sharing. Use Download instead.");
      }).finally(() => { if (generation.current === request) setSharing(false); });
    } catch { setMessage("Couldn’t open sharing. Use Download instead."); }
  }

  function cancel() { generation.current += 1; active.current?.abort(); active.current = null; setPreparing(false); setProgress(null); setMessage("Preparation cancelled. You can still download directly."); }

  return <article className="media-card">
    <div className="media-preview">{item.type === "video" ? <video key={variant.id} controls playsInline preload="metadata" poster={item.thumbnail} src={variant.url} /> : <img src={variant.url} alt={`Image ${index + 1} from this post`} loading="lazy" />}</div>
    <div className="media-controls">
      <div className="media-topline"><span className="eyebrow">{item.type === "video" ? "Video" : "Image"}{total > 1 ? ` ${index + 1} of ${total}` : ""}</span>{variant.size ? <span className="muted">{(variant.size / 1024 / 1024).toFixed(1)} MB</span> : null}</div>
      {item.variants.length > 1 ? <label className="quality-label">Quality<select aria-label={`Quality for ${item.type} ${index + 1}`} value={variant.id} onChange={(event) => setVariantId(event.target.value)} disabled={sharing}>{item.variants.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label> : <p className="quality-note">{variant.label} · {item.type === "video" ? "MP4" : variant.mimeType.split("/")[1].toUpperCase()}</p>}
      <a className="button primary download-button" href={variant.downloadUrl} download={variant.filename}><ArrowDown size={19} /> Download {item.type === "video" ? "video" : "image"}</a>
      {preparing ? <button className="button secondary" onClick={cancel}><X size={18} /> Cancel preparation{progress !== null ? ` · ${progress}%` : ""}</button> : file && blobUrl ? canShare ? <button className="button secondary" disabled={sharing} onClick={share}>{sharing ? <LoaderCircle className="spin" size={18} /> : <Share2 size={18} />} {sharing ? "Opening share sheet…" : "Save to gallery / Share file"}</button> : <a className="button secondary" href={blobUrl} download={file.name}><Check size={18} /> Download prepared file</a> : <button className="button secondary" onClick={prepare}><Share2 size={18} /> Prepare to save to gallery</button>}
      {preparing ? <div className="prepare-progress" role="progressbar" aria-label="Preparing file" aria-valuenow={progress ?? undefined} aria-valuemin={0} aria-valuemax={100}><span className={progress === null ? "indeterminate" : ""} style={{ width: progress === null ? "35%" : `${progress}%` }} /></div> : null}
      <p className="media-message" role="status">{message || "Download directly, or prepare the file to open your phone’s share sheet."}</p>
    </div>
  </article>;
}
