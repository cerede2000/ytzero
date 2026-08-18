import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { Headphones, Play, Search, Subtitles, X } from "lucide-react";
import { useVideoHlsSource } from "../components/useVideoHlsSource";
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
 *
 * Captions are declared in the manifest rather than added here as <track>
 * elements: on iOS the page does not play the video — the system player does,
 * and it reads the manifest and nothing else. The list fetched below is only
 * for telling the reader what is on offer.
 */
function DailymotionPlayer({ entry, onClose }: { entry: { video: DailymotionVideo; mode: Mode }; onClose: () => void }) {
  const mediaRef = useRef<HTMLVideoElement & HTMLAudioElement>(null);
  const [status, setStatus] = useState("Résolution du flux…");
  const [subtitles, setSubtitles] = useState<{ lang: string; label: string; src: string }[]>([]);
  const [showSubtitles, setShowSubtitles] = useState(false);
  const trackRef = useRef<HTMLTrackElement>(null);
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

  /*
   * The watch page's own HLS wiring, rather than a second one written here.
   *
   * Mine had no buffer bounds at all — six hundred seconds read ahead, which a
   * laptop shrugs off and a phone does not: seeking far into a video stopped
   * playback outright on the iPhone and nowhere else. This one holds thirty
   * seconds and thirty-two megabytes, keeps a minute behind, restores the
   * position after a recovery, and reloads the master playlist when the CDN
   * answers 410. All of it already written, and all of it needed here for the
   * same reasons it was needed there.
   *
   * `preferHlsJs` is the one thing asked of it that the watch page does not
   * want: Dailymotion's tracks do not start at the same instant, so a faithful
   * native player plays them a tenth of a second apart.
   */
  const [hls, setHls] = useState<import("hls.js").default | null>(null);
  useVideoHlsSource({
    active: true,
    mediaRef: mediaRef as RefObject<HTMLVideoElement | null>,
    onFatalError: () => setStatus("Lecture impossible — Dailymotion a refusé le flux."),
    onInstance: setHls,
    onReady: () => setStatus(""),
    preferHlsJs: true,
    src: source,
    startSeconds: 0,
  });

  /*
   * One renderer, and it is the browser's.
   *
   * Drawing the cues here as well put three copies of the same line on screen:
   * the one burned into Dailymotion's picture, the player's, and mine. The
   * player already draws a sideloaded track perfectly well — what it does not
   * do reliably is choose one, which is what the button below is for.
   *
   * Nothing declares these captions in the manifest any more, so hls.js has no
   * subtitle rendition to take ownership of and this track stays ours to set.
   */
  useEffect(() => {
    const element = trackRef.current;
    if (!element) return;
    element.track.mode = showSubtitles ? "showing" : "disabled";
  }, [showSubtitles, subtitles]);

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
      {/*
        * Keyed, and with everything conditional kept below.
        *
        * The status line used to sit above this: it says "resolving" and then
        * says nothing, so it left the tree at the very moment playback began —
        * and the media element, identified by its position among its siblings,
        * was replaced. hls.js went on feeding the element that had just been
        * detached, which is why subtitles declared in the manifest never
        * appeared while the picture played perfectly well.
        */}
      {entry.mode === "audio"
        ? <audio key="audio" {...common} />
        : (
          <video key="video" {...common} playsInline crossOrigin="anonymous">
            {subtitles[0] && (
              <track key={subtitles[0].lang} ref={trackRef} kind="subtitles"
                src={subtitles[0].src} srcLang={subtitles[0].lang.replace(/-auto$/, "")}
                label={subtitles[0].label} />
            )}
          </video>
        )}
      {status && <p className="dm-player-status">{status}</p>}
      {entry.mode === "video" && (
        subtitles.length === 0
          ? <p className="dm-player-status">Aucun sous-titre pour cette vidéo.</p>
          : (
            <div className="dm-player-subs">
              {/*
                * Our own switch rather than the player's menu.
                *
                * Reported: turning them on did nothing, and it took picking the
                * language again — of which there was one — then off, on, off,
                * before they appeared. That menu sets a mode on a text track
                * and hopes hls.js notices; this sets the rendition on hls.js,
                * which is the thing that decides. One press, one answer.
                */}
              <Button
                size="sm"
                variant={showSubtitles ? "primary" : "ghost"}
                leadingIcon={<Subtitles size={14} />}
                aria-pressed={showSubtitles}
                onClick={() => setShowSubtitles((shown) => !shown)}
              >
                {subtitles[0].label}
              </Button>
            </div>
          )
      )}
    </section>
  );
}
