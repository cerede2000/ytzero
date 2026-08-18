import { useEffect, useRef, useState, type MutableRefObject, type RefObject } from "react";
import { useParams } from "react-router-dom";
import { Headphones, Subtitles, Video } from "lucide-react";
import DailymotionCard from "../components/DailymotionCard";
import { useVideoHlsSource } from "../components/useVideoHlsSource";
import { Button, EmptyState } from "../components/ui";
import { dailymotionCount, type DailymotionVideo } from "../dailymotionTypes";
import { mediaPlaybackState } from "../mediaSessionState";
import { useDocumentTitle } from "../useDocumentTitle";
import "./DailymotionPage.css";
import { api } from "../api";
import { flushProgressWrite, queueProgressWrite } from "../progressWriteQueue";

interface SubtitleTrack { lang: string; label: string; src: string }
type Mode = "video" | "audio";

/**
 * One video, and their suggestions beside it.
 *
 * The player left the search page for this: a result is a link now, and the
 * page it opens is the one that plays. What sits to the right is Dailymotion's
 * own related list — the column their site shows — asked for from the same
 * endpoint they use, with no ranking of ours in front of it.
 */
export default function DailymotionVideoPage() {
  const { id = "" } = useParams();
  const [video, setVideo] = useState<DailymotionVideo & { description: string } | null>(null);
  const [related, setRelated] = useState<DailymotionVideo[]>([]);
  const [subtitles, setSubtitles] = useState<SubtitleTrack[]>([]);
  const [showSubtitles, setShowSubtitles] = useState(false);
  const [mode, setMode] = useState<Mode>("video");
  const [status, setStatus] = useState("Résolution du flux…");
  const [notFound, setNotFound] = useState(false);
  /** Where the reader was when they switched mode, so the switch is not a restart. */
  const positionRef = useRef(0);
  /*
   * And where they were when they left, which is a different question.
   *
   * The player is held back until this has been asked for: it takes its
   * starting point when it is built, so a position arriving afterwards would
   * be a jump the reader watches happen — or, if the metadata had already
   * landed, nothing at all.
   */
  const [resumeKnown, setResumeKnown] = useState(false);
  useDocumentTitle(video?.title ?? "Dailymotion");

  useEffect(() => {
    let cancelled = false;
    positionRef.current = 0;
    setResumeKnown(false);
    if (!id) return;
    api.dailymotionProgress([id])
      .then((answer) => {
        if (cancelled) return;
        const held = answer.progress[id];
        // A video watched to the end resumes at the beginning: offering to
        // continue from the credits is offering nothing.
        positionRef.current = held && !held.watched ? held.positionSeconds : 0;
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setResumeKnown(true); });
    return () => { cancelled = true; };
  }, [id]);

  useEffect(() => {
    let cancelled = false;
    setVideo(null);
    setRelated([]);
    setNotFound(false);
    void fetch(`/api/dailymotion/videos/${id}`)
      .then(async (response) => {
        if (response.status === 404) { if (!cancelled) setNotFound(true); return; }
        const payload = await response.json() as { video: DailymotionVideo & { description: string }; related: DailymotionVideo[] };
        if (cancelled) return;
        setVideo(payload.video);
        setRelated(payload.related ?? []);
      })
      .catch(() => { if (!cancelled) setNotFound(true); });
    void fetch(`/api/dailymotion/videos/${id}/subtitles`)
      .then((response) => response.json() as Promise<{ subtitles?: SubtitleTrack[] }>)
      .then((payload) => { if (!cancelled) setSubtitles(payload.subtitles ?? []); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [id]);

  if (notFound) return <EmptyState title="Vidéo introuvable" description="Cette vidéo n'existe plus chez Dailymotion." />;

  return (
    <div className="dm-watch">
      <div className="dm-watch-main">
        {/*
          * Keyed by mode, which is what makes the switch work.
          *
          * The HLS wiring attaches to whatever element it was handed and its
          * effect does not re-run when a <video> becomes an <audio> — nothing
          * it depends on changed. Pressing the button swapped the element and
          * left the stream feeding the one that had just left the page. A key
          * says plainly that this is a different player.
          */}
        {resumeKnown && (
          <DailymotionMedia
            key={mode}
            mode={mode}
            videoId={id}
            video={video}
            showSubtitles={showSubtitles}
            positionRef={positionRef}
            onStatus={setStatus}
          />
        )}
        {status && <p className="dm-player-status">{status}</p>}

        <div className="dm-player-actions">
          <Button size="sm" variant={mode === "audio" ? "primary" : "ghost"}
            leadingIcon={mode === "audio" ? <Video size={14} /> : <Headphones size={14} />}
            onClick={() => setMode((current) => current === "audio" ? "video" : "audio")}>
            {mode === "audio" ? "Revenir à la vidéo" : "Audio seul"}
          </Button>
          {mode === "video" && subtitles[0] && (
            <Button size="sm" variant={showSubtitles ? "primary" : "ghost"} leadingIcon={<Subtitles size={14} />}
              aria-pressed={showSubtitles} onClick={() => setShowSubtitles((shown) => !shown)}>
              {subtitles[0].label}
            </Button>
          )}
        </div>

        {video && (
          <div className="dm-watch-meta">
            <h1>{video.title}</h1>
            <p className="dm-watch-by">
              {video.channelTitle}
              {video.views != null && <> · {dailymotionCount(video.views, "vue")}</>}
            </p>
            {video.description && <p className="dm-watch-desc">{video.description}</p>}
          </div>
        )}
      </div>

      <aside className="dm-watch-side">
        <h2 className="dm-section-title">Suggestions</h2>
        {related.map((suggestion) => <DailymotionCard key={suggestion.videoId} video={suggestion} compact />)}
      </aside>
    </div>
  );
}

/**
 * The element that plays, and everything wired to it.
 *
 * Its own component so that a change of mode is a change of player: the parent
 * keys it, this mounts fresh, and the HLS wiring attaches to the element that
 * is actually on the page. Audio mode is an <audio> element rather than a
 * shrunken video, because on a phone an audio mode is one that survives the
 * browser being put away.
 */
function DailymotionMedia({ mode, videoId, video, showSubtitles, positionRef, onStatus }: {
  mode: Mode;
  videoId: string;
  video: (DailymotionVideo & { description: string }) | null;
  showSubtitles: boolean;
  positionRef: MutableRefObject<number>;
  onStatus: (status: string) => void;
}) {
  const mediaRef = useRef<HTMLVideoElement & HTMLAudioElement>(null);
  const [hls, setHls] = useState<import("hls.js").default | null>(null);

  useVideoHlsSource({
    active: true,
    mediaRef: mediaRef as RefObject<HTMLVideoElement | null>,
    onFatalError: () => onStatus("Lecture impossible — Dailymotion a refusé le flux."),
    onInstance: setHls,
    onReady: () => onStatus(""),
    // Their tracks do not start at the same instant; only hls.js lines them up.
    preferHlsJs: true,
    src: `/api/dailymotion/videos/${videoId}/hls.m3u8`,
    startSeconds: positionRef.current,
  });

  /*
   * Managed Media Source pauses loading when Safari says it has enough, and
   * only Safari would resume it — so a seek says so too. Without this, seeking
   * far into a video fetches nothing at all and the picture simply stops.
   */
  useEffect(() => {
    const element = mediaRef.current;
    if (!element || !hls) return;
    const resume = () => hls.resumeBuffering();
    element.addEventListener("seeking", resume);
    return () => element.removeEventListener("seeking", resume);
  }, [hls]);

  /**
   * Remembered continuously, and put back once — so switching mode resumes
   * rather than restarts.
   *
   * `startPosition` is handed to hls.js as well, and on the first switch it was
   * not honoured: the sound began at zero. Setting it on the element when the
   * metadata lands is the answer that does not depend on which layer was
   * listening. Only at mount, and only forwards, so it cannot fight a reader
   * who has since seeked backwards.
   */
  useEffect(() => {
    const element = mediaRef.current;
    if (!element) return;
    const resumeFrom = positionRef.current;
    const remember = () => {
      positionRef.current = element.currentTime;
      /*
       * Through the same throttled queue the watch page uses — newest sample
       * kept, one request in flight, flushed on the way out — but written to
       * Dailymotion's own table. Its ids mean nothing to the library's.
       */
      if (element.currentTime > 0) {
        queueProgressWrite(
          videoId,
          element.currentTime,
          Number.isFinite(element.duration) ? element.duration : 0,
          (id, position, duration) => api.saveDailymotionProgress(id, position, duration || null),
        );
      }
    };
    const restore = () => {
      if (resumeFrom > 1 && element.currentTime < resumeFrom - 1) element.currentTime = resumeFrom;
    };
    const flush = () => flushProgressWrite(videoId);
    element.addEventListener("loadedmetadata", restore);
    element.addEventListener("timeupdate", remember);
    element.addEventListener("pause", flush);
    // Leaving the page is the sample that matters most, and the one a normal
    // request does not survive.
    const leaving = () => flushProgressWrite(videoId, true);
    window.addEventListener("pagehide", leaving);
    if (element.readyState >= 1) restore();
    return () => {
      element.removeEventListener("loadedmetadata", restore);
      element.removeEventListener("timeupdate", remember);
      element.removeEventListener("pause", flush);
      window.removeEventListener("pagehide", leaving);
      flush();
    };
  }, [positionRef, videoId]);

  /*
   * The captions belong to hls.js.
   *
   * A <track> sideloaded next to the player does not survive it: on attach and
   * on every manifest load hls.js empties every text track on the element,
   * cues and all, and the browser never re-reads a file it has already marked
   * loaded — so the captions showed or not depending on which of the two
   * finished first, and were gone for good once cleared. Declared in the
   * manifest they are hls.js's own, re-parsed whenever it clears them, and
   * rendered into the element, which is what puts them in the iOS full-screen
   * player as well. `subtitleTrack` is the switch; -1 is off.
   */
  useEffect(() => {
    if (!hls) return;
    let live = true;
    let stopListening = () => {};
    void import("hls.js").then(({ default: Hls }) => {
      if (!live) return;
      const apply = () => {
        hls.subtitleDisplay = showSubtitles;
        hls.subtitleTrack = showSubtitles && hls.subtitleTracks.length > 0 ? 0 : -1;
      };
      apply();
      hls.on(Hls.Events.SUBTITLE_TRACKS_UPDATED, apply);
      stopListening = () => hls.off(Hls.Events.SUBTITLE_TRACKS_UPDATED, apply);
    });
    return () => {
      live = false;
      stopListening();
    };
  }, [hls, showSubtitles]);

  useEffect(() => {
    if (!("mediaSession" in navigator) || !video) return;
    const element = mediaRef.current;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: video.title,
      artist: video.channelTitle || "Dailymotion",
      artwork: video.thumbnail ? [{ src: video.thumbnail, sizes: "480x360", type: "image/jpeg" }] : [],
    });
    navigator.mediaSession.playbackState = mediaPlaybackState(element);
    navigator.mediaSession.setActionHandler("play", () => { void element?.play(); });
    navigator.mediaSession.setActionHandler("pause", () => element?.pause());
    return () => {
      navigator.mediaSession.setActionHandler("play", null);
      navigator.mediaSession.setActionHandler("pause", null);
    };
  }, [video]);

  const common = {
    ref: mediaRef,
    controls: true,
    autoPlay: true,
    className: "dm-player-media",
    onPlay: () => { if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "playing"; },
    onPause: () => { if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "paused"; },
  } as const;

  if (mode === "audio") return <audio {...common} />;
  return <video {...common} playsInline crossOrigin="anonymous" />;
}
