import { useCallback, useEffect, useRef, useState } from "react";
import { Headphones, Play, Search, X } from "lucide-react";
import { Button, EmptyState, Input, PageHeader } from "../components/ui";
import { useDocumentTitle } from "../useDocumentTitle";
import "./DailymotionPage.css";

interface DailymotionVideo {
  videoId: string;
  title: string;
  channelTitle: string;
  thumbnail: string;
  durationSeconds: number | null;
  publishedAt: string | null;
  views: number | null;
}

type Mode = "video" | "audio";

function clock(seconds: number | null): string {
  if (seconds == null) return "";
  const whole = Math.round(seconds);
  const parts = [Math.floor(whole / 3600), Math.floor(whole / 60) % 60, whole % 60];
  return (parts[0] > 0 ? parts : parts.slice(1))
    .map((part, index) => index === 0 ? String(part) : String(part).padStart(2, "0"))
    .join(":");
}

/**
 * Dailymotion, on its own page.
 *
 * An experiment rather than a feature: it searches, plays, and can drop the
 * picture, and it does all of that without touching a single YouTube path. No
 * row is written, no feed is involved, and the identifiers never meet. What it
 * is really testing is whether the shape this application is built on — resolve
 * with yt-dlp, serve the stream ourselves, let the reader choose picture or
 * sound — holds for a second source.
 *
 * Thumbnails are plain <img> rather than the shared component: the image proxy
 * only trusts Google's hosts, and widening that list is a change to code this
 * experiment is meant to leave alone.
 */
export default function DailymotionPage() {
  useDocumentTitle("Dailymotion");
  const [query, setQuery] = useState("");
  const [videos, setVideos] = useState<DailymotionVideo[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState("");
  const [playing, setPlaying] = useState<{ video: DailymotionVideo; mode: Mode } | null>(null);

  const search = useCallback(async (term: string) => {
    if (!term.trim()) return;
    setSearching(true);
    setError("");
    try {
      const response = await fetch(`/api/dailymotion/search?q=${encodeURIComponent(term.trim())}`);
      const payload = await response.json() as { videos?: DailymotionVideo[]; error?: string };
      if (!response.ok) throw new Error(payload.error ?? `HTTP ${response.status}`);
      setVideos(payload.videos ?? []);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setVideos([]);
    } finally {
      setSearching(false);
    }
  }, []);

  return (
    <>
      <PageHeader title="Dailymotion" />
      <form className="dm-search" onSubmit={(event) => { event.preventDefault(); void search(query); }}>
        <Input
          value={query}
          placeholder="Rechercher sur Dailymotion…"
          onChange={(event) => setQuery(event.target.value)}
        />
        <Button type="submit" variant="primary" leadingIcon={<Search size={16} />} disabled={searching || !query.trim()}>
          {searching ? "Recherche…" : "Rechercher"}
        </Button>
      </form>

      {playing && <DailymotionPlayer entry={playing} onClose={() => setPlaying(null)} />}

      {error && <p className="dm-error">{error}</p>}

      {videos !== null && videos.length === 0 && !searching && !error && (
        <EmptyState title="Aucun résultat" description="Essayez d'autres mots." />
      )}

      <div className="dm-grid">
        {(videos ?? []).map((video) => (
          <article key={video.videoId} className="dm-card">
            <button type="button" className="dm-thumb" onClick={() => setPlaying({ video, mode: "video" })}>
              {video.thumbnail && <img src={video.thumbnail} alt="" loading="lazy" />}
              {video.durationSeconds != null && <span className="dm-duration">{clock(video.durationSeconds)}</span>}
            </button>
            <h3 className="dm-title">{video.title}</h3>
            <p className="dm-channel">{video.channelTitle}</p>
            <div className="dm-actions">
              <Button size="sm" leadingIcon={<Play size={14} />} onClick={() => setPlaying({ video, mode: "video" })}>Lire</Button>
              <Button size="sm" variant="ghost" leadingIcon={<Headphones size={14} />} onClick={() => setPlaying({ video, mode: "audio" })}>Audio</Button>
            </div>
          </article>
        ))}
      </div>
    </>
  );
}

/**
 * One element for both modes.
 *
 * Audio mode is the same stream with the picture put away, which is what it is
 * on the watch page too — Dailymotion offers no audio-only rendition, so there
 * is nothing else to ask for. Hiding it rather than swapping element keeps a
 * single playback and lets the mode change without stopping the sound.
 */
function DailymotionPlayer({ entry, onClose }: { entry: { video: DailymotionVideo; mode: Mode }; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState("Résolution du flux…");
  const source = `/api/dailymotion/videos/${entry.video.videoId}/hls.m3u8`;

  useEffect(() => {
    const element = videoRef.current;
    if (!element) return;
    let cancelled = false;
    let hls: import("hls.js").default | null = null;
    // Safari plays HLS itself; everywhere else hls.js does, and it is already
    // in this bundle for the audio mode.
    if (element.canPlayType("application/vnd.apple.mpegurl")) {
      element.src = source;
      setStatus("");
    } else {
      void import("hls.js").then(({ default: Hls }) => {
        if (cancelled || !Hls.isSupported()) { setStatus("HLS non supporté par ce navigateur"); return; }
        hls = new Hls({ enableWorker: true });
        hls.on(Hls.Events.ERROR, (_event, data) => { if (data.fatal) setStatus(`Erreur de lecture : ${data.details}`); });
        hls.on(Hls.Events.MANIFEST_PARSED, () => setStatus(""));
        hls.loadSource(source);
        hls.attachMedia(element);
      });
    }
    return () => { cancelled = true; hls?.destroy(); };
  }, [source]);

  return (
    <section className={`dm-player${entry.mode === "audio" ? " dm-player--audio" : ""}`}>
      <header className="dm-player-head">
        <div>
          <h2>{entry.video.title}</h2>
          <p>{entry.video.channelTitle} · {entry.mode === "audio" ? "audio seul" : "vidéo"}</p>
        </div>
        <Button variant="ghost" size="sm" iconOnly aria-label="Fermer" onClick={onClose}><X size={16} /></Button>
      </header>
      {status && <p className="dm-player-status">{status}</p>}
      <video ref={videoRef} controls autoPlay playsInline className="dm-player-media" />
    </section>
  );
}
