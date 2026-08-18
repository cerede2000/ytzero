import { useCallback, useEffect, useRef, useState } from "react";
import { Headphones, Play, Search, X } from "lucide-react";
import { Button, EmptyState, Input, PageHeader } from "../components/ui";
import { mediaPlaybackState } from "../mediaSessionState";
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
 * Two elements, because the mode is not a matter of size.
 *
 * The first attempt shrank the video element and called that audio. It is not:
 * on a phone, an audio mode is one that survives the browser being put away,
 * and a <video> element does not — which is the whole reason this application
 * grew a separate audio path for YouTube in the first place.
 *
 * So audio mode is an <audio> element, and hls.js feeds it the same muxed
 * playlist: it demuxes and appends the audio alone, which was worth checking
 * rather than assuming — no errors, readyState 4, duration read, playing.
 * Dailymotion publishes no audio-only rendition, so there is nothing to ask
 * their CDN for and nothing for us to transcode.
 *
 * The media session is what the lock screen reads. Without it a phone shows a
 * silent notification with the page's title, and the controls do nothing.
 */
function DailymotionPlayer({ entry, onClose }: { entry: { video: DailymotionVideo; mode: Mode }; onClose: () => void }) {
  const mediaRef = useRef<HTMLVideoElement & HTMLAudioElement>(null);
  const [status, setStatus] = useState("Résolution du flux…");
  const [subtitles, setSubtitles] = useState<{ lang: string; label: string; src: string }[]>([]);
  const source = `/api/dailymotion/videos/${entry.video.videoId}/hls.m3u8`;

  /*
   * Asked for separately, and allowed to fail quietly: a video without captions
   * is the common case, and a page that reports it as an error is wrong.
   */
  useEffect(() => {
    let cancelled = false;
    setSubtitles([]);
    void fetch(`/api/dailymotion/videos/${entry.video.videoId}/subtitles`)
      .then((response) => response.json() as Promise<{ subtitles?: { lang: string; label: string; src: string }[] }>)
      .then((payload) => { if (!cancelled) setSubtitles(payload.subtitles ?? []); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [entry.video.videoId]);

  useEffect(() => {
    const element = mediaRef.current;
    if (!element) return;
    let cancelled = false;
    let hls: import("hls.js").default | null = null;
    setStatus("Résolution du flux…");
    if (element.canPlayType("application/vnd.apple.mpegurl")) {
      element.src = source;
      setStatus("");
    } else {
      void import("hls.js").then(({ default: Hls }) => {
        if (cancelled || !Hls.isSupported()) { setStatus("HLS non supporté par ce navigateur"); return; }
        hls = new Hls({ enableWorker: true });
        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (!data.fatal) return;
          setStatus(data.details === "manifestLoadError"
            ? "Cette vidéo n'est plus disponible chez Dailymotion."
            : `Erreur de lecture : ${data.details}`);
        });
        hls.on(Hls.Events.MANIFEST_PARSED, () => setStatus(""));
        hls.loadSource(source);
        hls.attachMedia(element);
      });
    }
    return () => { cancelled = true; hls?.destroy(); };
  }, [source, entry.mode]);

  /*
   * Turned on once it is there.
   *
   * `default` on a <track> is only read while the document is parsed, and these
   * arrive afterwards — the request for them is made when the player opens. So
   * the element ends up holding a track nobody asked it to show, which reads as
   * "no subtitles" to somebody who turned them on. The native menu still offers
   * to turn it off again.
   */
  useEffect(() => {
    const element = mediaRef.current;
    if (!element || entry.mode !== "video" || subtitles.length === 0) return;
    const tracks = element.textTracks;
    if (tracks.length > 0 && tracks[0].mode === "disabled") tracks[0].mode = "showing";
  }, [subtitles, entry.mode]);

  /*
   * Stated from the element rather than left to its events: a session
   * registered while the element is already playing must say so itself, or the
   * controls appear dead until the next pause.
   */
  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    const element = mediaRef.current;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: entry.video.title,
      artist: entry.video.channelTitle || "Dailymotion",
      artwork: entry.video.thumbnail ? [{ src: entry.video.thumbnail, sizes: "480x360", type: "image/jpeg" }] : [],
    });
    navigator.mediaSession.playbackState = mediaPlaybackState(element);
    navigator.mediaSession.setActionHandler("play", () => { void element?.play(); });
    navigator.mediaSession.setActionHandler("pause", () => element?.pause());
    return () => {
      navigator.mediaSession.setActionHandler("play", null);
      navigator.mediaSession.setActionHandler("pause", null);
    };
  }, [entry.video, entry.mode, status]);

  const common = {
    ref: mediaRef,
    controls: true,
    autoPlay: true,
    className: "dm-player-media",
    onPlay: () => { if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "playing"; },
    onPause: () => { if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "paused"; },
  } as const;

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
      {entry.mode === "audio"
        ? <audio {...common} />
        : (
          <video {...common} playsInline crossOrigin="anonymous">
            {subtitles.map((track, index) => (
              <track
                key={track.lang}
                kind="subtitles"
                src={track.src}
                srcLang={track.lang.replace(/-auto$/, "")}
                label={track.label}
                default={index === 0}
              />
            ))}
          </video>
        )}
      {entry.mode === "video" && subtitles.length === 0 && (
        <p className="dm-player-status">Aucun sous-titre pour cette vidéo.</p>
      )}
    </section>
  );
}
