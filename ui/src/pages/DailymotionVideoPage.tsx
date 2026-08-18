import { useEffect, useRef, useState, type RefObject } from "react";
import { useParams } from "react-router-dom";
import { Headphones, Subtitles, Video } from "lucide-react";
import DailymotionCard from "../components/DailymotionCard";
import { useVideoHlsSource } from "../components/useVideoHlsSource";
import { Button, EmptyState } from "../components/ui";
import { dailymotionCount, type DailymotionVideo } from "../dailymotionTypes";
import { mediaPlaybackState } from "../mediaSessionState";
import { useDocumentTitle } from "../useDocumentTitle";
import "./DailymotionPage.css";

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
  const mediaRef = useRef<HTMLVideoElement & HTMLAudioElement>(null);
  const trackRef = useRef<HTMLTrackElement>(null);
  useDocumentTitle(video?.title ?? "Dailymotion");

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

  const [hls, setHls] = useState<import("hls.js").default | null>(null);
  useVideoHlsSource({
    active: true,
    mediaRef: mediaRef as RefObject<HTMLVideoElement | null>,
    onFatalError: () => setStatus("Lecture impossible — Dailymotion a refusé le flux."),
    onInstance: setHls,
    onReady: () => setStatus(""),
    // Their tracks do not start at the same instant; only hls.js lines them up.
    preferHlsJs: true,
    src: `/api/dailymotion/videos/${id}/hls.m3u8`,
    startSeconds: 0,
  });

  // Managed Media Source pauses loading when Safari says it has enough, and
  // only Safari would resume it. A seek says so too.
  useEffect(() => {
    const element = mediaRef.current;
    if (!element || !hls) return;
    const resume = () => hls.resumeBuffering();
    element.addEventListener("seeking", resume);
    return () => element.removeEventListener("seeking", resume);
  }, [hls, mode]);

  useEffect(() => {
    const element = trackRef.current;
    if (!element) return;
    element.track.mode = showSubtitles ? "showing" : "disabled";
  }, [showSubtitles, subtitles, mode]);

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
  }, [video, mode, status]);

  if (notFound) return <EmptyState title="Vidéo introuvable" description="Cette vidéo n'existe plus chez Dailymotion." />;

  const common = {
    ref: mediaRef,
    controls: true,
    autoPlay: true,
    className: "dm-player-media",
    onPlay: () => { if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "playing"; },
    onPause: () => { if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "paused"; },
  } as const;

  return (
    <div className="dm-watch">
      <div className="dm-watch-main">
        {mode === "audio"
          ? <audio key="audio" {...common} />
          : (
            <video key="video" {...common} playsInline crossOrigin="anonymous">
              {subtitles[0] && (
                <track key={subtitles[0].lang} ref={trackRef} kind="subtitles" src={subtitles[0].src}
                  srcLang={subtitles[0].lang.replace(/-auto$/, "")} label={subtitles[0].label} />
              )}
            </video>
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
