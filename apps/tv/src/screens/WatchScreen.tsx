import { TvControlSurface } from "../components/TvSurface";
import { TvPageBackButton } from "../components/TvPageBackButton";
import { formatVideoDuration } from "../duration";
import { TvTextDetails } from "../components/TvTextDetails";
import { TvListButton } from "../components/TvListButton";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FlatList, Image, StyleSheet, Text, TVFocusGuideView, View, type FocusDestination, type ListRenderItemInfo } from "react-native";
import type { YtZeroApi } from "../api";
import { TvBackdrop } from "../components/TvBackdrop";
import { TvNativePlayer } from "../components/TvNativePlayer";
import { TvPressable } from "../components/TvPressable";
import { useSessionQueue } from "../SessionQueue";
import { usePlaybackSequence } from "../usePlaybackSequence";
import { shouldAdvanceQueue, SESSION_QUEUE_LIMIT, type OpenVideo, type PlaybackQueueContext } from "../playbackQueue";
import { playbackTime, resumePosition, type PlaybackResult } from "../playback";
import { TvButton } from "../components/TvButton";
import { TvLoadingMark } from "../components/TvLoadingMark";
import { TvVideoShelf } from "../components/TvVideoShelf";
import type { VideoActionOptions } from "../components/TvVideoActionMenu";
import { canQueueTvVideo } from "../videoCardActions";
import { localeTags, type Translate } from "../i18n";
import { tvVerticalListPerformance } from "../listPerformance";
import { colors, typography, screenPadding } from "../theme";
import type { Language, TvProfileSettings, Video, VideoComment } from "../types";
import { imageSourceWithHeaders } from "../imageSource";
import { useViewport } from "../viewport";

type Props = {
  api: YtZeroApi;
  incognito: boolean;
  isChild: boolean;
  language: Language;
  t: Translate;
  video: Video;
  onBack: () => void;
  onPrimaryFocusTarget: (target: View | null) => void;
  profileFocusTarget?: FocusDestination;
  onOpenChannel?: (channelId: string) => void;
  onOpenVideo: OpenVideo;
  queueContext: PlaybackQueueContext | null;
  autoplay: boolean;
  initialPosition?: number;
  onShowQueue: (returnTarget: View | null) => void;
  onVideoChange: (video: Video) => void;
  onVideoLongPress: (video: Video, onChange: (updated: Video) => void, options?: VideoActionOptions) => void;
};

type CommentsMode = "disabled" | "scroll" | "auto";

const noComments: VideoComment[] = [];
const commentKey = (comment: VideoComment) => comment.id;

function commentsMode(value: TvProfileSettings["watch_show_comments"]): CommentsMode {
  if (value === "auto") return "auto";
  if (value === "1" || value === "scroll") return "scroll";
  return "disabled";
}

function validDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? null : date;
}

export function WatchScreen({ api, incognito, isChild, language, t, video: initialVideo, onBack, onOpenChannel, onOpenVideo, onVideoChange, onVideoLongPress, queueContext, autoplay, initialPosition, onShowQueue, onPrimaryFocusTarget, profileFocusTarget }: Props) {
  const [preview, setPreview] = useState(initialVideo);
  const { width, height } = useViewport();
  const [video, setVideo] = useState(preview);
  const [related, setRelated] = useState<Video[]>([]);
  // `undefined` means that profile settings are still loading. Keep the
  // resolved value for the whole AVKit session instead of fetching it again
  // for every Short selected inside the native player.
  const [settings, setSettings] = useState<TvProfileSettings | null | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [playingFrom, setPlayingFrom] = useState<number | null>(autoplay ? initialPosition ?? resumePosition(preview.watch_position, preview.watch_duration, preview.watched) : null);
  const returnToBrowse = useRef(autoplay);
  const queue = useSessionQueue();
  const queued = queue.items.some((item) => item.video_id === video.video_id);
  const sequence = usePlaybackSequence(api, video, queueContext, settings);
  const [saveFailed, setSaveFailed] = useState(false);
  const alive = useRef(true);
  const requestVersion = useRef(0);
  const loadedDetailsId = useRef<string | null>(null);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);
  useEffect(() => {
    let current = true;
    setSettings(undefined);
    void api.settings()
      .then((result) => { if (current) setSettings(result.settings); })
      .catch(() => { if (current) setSettings(null); });
    return () => { current = false; };
  }, [api]);
  const [portraitFailed, setPortraitFailed] = useState(false);
  const [comments, setComments] = useState<VideoComment[] | null>(null);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [commentsError, setCommentsError] = useState(false);
  const [backTarget, setBackTarget] = useState<View | null>(null);
  const [channelTarget, setChannelTarget] = useState<View | null>(null);
  const [firstActionTarget, setFirstActionTarget] = useState<View | null>(null);
  const [relatedTarget, setRelatedTarget] = useState<View | null>(null);
  const [nextTarget, setNextTarget] = useState<View | null>(null);
  const [queueButtonTarget, setQueueButtonTarget] = useState<View | null>(null);
  const queueTarget = sequence.next ? nextTarget : queueButtonTarget;
  const [descriptionTarget, setDescriptionTarget] = useState<View | null>(null);
  const [commentsTarget, setCommentsTarget] = useState<View | null>(null);

  useEffect(() => {
    if (playingFrom !== null) return;
    const frame = requestAnimationFrame(() => firstActionTarget?.requestTVFocus());
    return () => cancelAnimationFrame(frame);
  }, [firstActionTarget, playingFrom]);

  useEffect(() => {
    onPrimaryFocusTarget(firstActionTarget);
    return () => onPrimaryFocusTarget(null);
  }, [firstActionTarget, onPrimaryFocusTarget]);

  const loadComments = useCallback(async () => {
    const version = requestVersion.current;
    const current = () => alive.current && requestVersion.current === version;
    setCommentsLoading(true);
    setCommentsError(false);
    try {
      const result = await api.videoComments(preview.video_id);
      if (!current()) return;
      setComments(result.comments.slice(0, 18));
    } catch {
      if (current()) setCommentsError(true);
    } finally {
      if (current()) setCommentsLoading(false);
    }
  }, [api, preview.video_id]);

  const load = useCallback(async () => {
    const version = ++requestVersion.current;
    const current = () => alive.current && requestVersion.current === version;
    setLoading(true);
    setLoadError(false);
    setSaveFailed(false);
    try {
      const page = await api.video(preview.video_id);
      if (!current()) return;
      loadedDetailsId.current = preview.video_id;
      setVideo(page.video);
      setRelated(page.related);
    } catch {
      if (current()) setLoadError(true);
    } finally {
      if (current()) setLoading(false);
    }
  }, [api, preview.video_id]);

  const detailsVisible = playingFrom === null && !returnToBrowse.current;
  useEffect(() => {
    if (!detailsVisible || loadedDetailsId.current === preview.video_id) return;
    setVideo((current) => current.video_id === preview.video_id ? current : preview);
    setRelated([]);
    setComments(null);
    setCommentsLoading(false);
    setCommentsError(false);
    setPortraitFailed(false);
    void load();
    return () => { requestVersion.current++; };
  }, [detailsVisible, load, preview, preview.video_id]);

  useEffect(() => {
    if (!detailsVisible || settings === undefined || loading || loadError || loadedDetailsId.current !== preview.video_id) return;
    if (commentsMode(settings?.watch_show_comments) === "auto" && comments === null && !commentsLoading && !commentsError) void loadComments();
  }, [comments, commentsError, commentsLoading, detailsVisible, loadComments, loadError, loading, preview.video_id, settings]);

  const closePlayer = (result: PlaybackResult, next?: Video, playedVideo = video) => {
    if (!alive.current) return;
    if (result.showDetails) returnToBrowse.current = false;
    setPlayingFrom(null);
    setSaveFailed(result.saveFailed);
    if ((!incognito || isChild) && result.duration > 0) {
      const updated = { ...playedVideo, watch_position: result.position, watch_duration: result.duration, watched: result.completed && !result.saveFailed ? 1 : playedVideo.watched };
      setVideo(updated);
      if (!result.saveFailed) onVideoChange(updated);
    }
    if (next) { onOpenVideo(next, queueContext ?? video.playback_context ?? sequence.context ?? undefined, true); return; }
    if (returnToBrowse.current) { onBack(); return; }
    requestAnimationFrame(() => firstActionTarget?.requestTVFocus());
  };

  const openActions = useCallback(() => onVideoLongPress(video, (updated) => {
    setVideo(updated);
    onVideoChange(updated);
  }), [onVideoChange, onVideoLongPress, video]);

  const startAt = (video.video_id === initialVideo.video_id ? initialPosition : undefined) ?? resumePosition(video.watch_position, video.watch_duration, video.watched);
  const heroHeight = Math.max(500, Math.round(height * 0.69));
  const locale = localeTags[language];
  const dateFormatter = useMemo(() => new Intl.DateTimeFormat(locale, { dateStyle: "medium" }), [locale]);
  const viewsFormatter = useMemo(
    () => new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 }),
    [locale],
  );
  const publishedAt = validDate(video.published_at);
  const published = publishedAt ? dateFormatter.format(publishedAt) : "";
  const views = typeof video.views === "number" ? `${viewsFormatter.format(video.views)} ${t("views")}` : "";
  const duration = formatVideoDuration(video.duration);
  const metadata = [published, views, duration].filter(Boolean);
  const progress = video.watch_position && video.watch_duration
    ? Math.max(0, Math.min(100, video.watch_position / video.watch_duration * 100))
    : 0;
  const mode = commentsMode(settings?.watch_show_comments);
  const showRelated = settings?.watch_show_related !== "0";
  const short = video.is_short === 1;
  const cardWidth = useMemo(() => Math.max(300, Math.min(390, (width - screenPadding * 2 - 78) / 4)), [width]);
  const visibleComments = mode === "disabled" ? noComments : comments ?? noComments;
  const renderComment = useCallback(({ item }: ListRenderItemInfo<VideoComment>) => (
    <CommentCard api={api} comment={item} t={t} />
  ), [api, t]);
  const applyRelatedVideoChange = useCallback((updated: Video) => {
    setRelated((current) => current
      .map((item) => item.video_id === updated.video_id ? updated : item)
      .filter((item) => item.video_id !== updated.video_id || updated.status !== "archived"));
  }, []);
  const relatedThumbnailSource = useCallback((thumbnail: string) => api.thumbnailSource(thumbnail), [api]);
  const openRelatedVideo = useCallback((relatedVideo: Video) => {
    onOpenVideo(relatedVideo, queueContext ?? undefined);
  }, [onOpenVideo, queueContext]);
  const openRelatedVideoActions = useCallback((relatedVideo: Video) => {
    onVideoLongPress(relatedVideo, applyRelatedVideoChange);
  }, [applyRelatedVideoChange, onVideoLongPress]);

  return (
    <View style={[styles.screen, { width, height }]}>
    {playingFrom === null && !returnToBrowse.current ? <TvPageBackButton ref={setBackTarget} t={t}
      nextFocusRight={profileFocusTarget} nextFocusDown={channelTarget ?? firstActionTarget ?? undefined}
      onPress={onBack} /> : null}
    {playingFrom === null && !returnToBrowse.current ? <FlatList
      style={[styles.screen, { width, height, flexBasis: height, flexGrow: 0, flexShrink: 0 }]}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
      data={visibleComments}
      keyExtractor={commentKey}
      renderItem={renderComment}
      {...tvVerticalListPerformance}
      ListHeaderComponent={(
        <>
      <TvBackdrop source={api.backdropSource(video.thumbnail)} fallbackSource={api.thumbnailSource(video.thumbnail)} style={{ left: -screenPadding, right: -screenPadding, top: -132, height: heroHeight + 240 }} />
      {loading ? <TvLoadingMark accessibilityLabel={t("loadingVideo")} size={28} /> : null}

      {loadError ? (
        <View style={styles.errorPanel}>
          <Text style={styles.errorText}>{t("videoLoadError")}</Text>
          <TvButton label={t("tryAgain")} onPress={() => void load()} />
        </View>
      ) : null}

      <View style={[styles.hero, { minHeight: heroHeight }, short && styles.shortHero]}>
        {short ? <View style={[styles.imageFrame, { width: Math.min(330, height * 0.3) }, styles.shortImageFrame]}>
          {video.thumbnail ? (
            <Image
              source={imageSourceWithHeaders(short && !portraitFailed ? api.shortThumbnailSource(video.video_id) : api.thumbnailSource(video.thumbnail))}
              resizeMode="cover"
              style={styles.image}
              onError={short && !portraitFailed ? () => setPortraitFailed(true) : undefined}
            />
          ) : (
            <View style={styles.imagePlaceholder}><Text style={styles.imagePlaceholderText}>YT Zero</Text></View>
          )}
          <View style={styles.posterShade} />
          {duration ? <View style={styles.duration}><Text style={styles.durationText}>{duration}</Text></View> : null}
          {progress > 0 ? <View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${progress}%` }]} /></View> : null}
        </View> : null}

        <View style={styles.copy}>
          <View style={styles.badges}>
            {video.live_status === "live" ? <MetaBadge label={t("liveBadge")} strong /> : null}
            {video.members_only === 1 ? <MetaBadge label={t("membersOnly")} /> : null}
            {video.is_private === 1 ? <MetaBadge label={t("privateVideo")} /> : null}
            {video.tags?.filter((tag) => tag.filter_only !== 1).slice(0, 3).map((tag) => <MetaBadge key={tag.id} label={tag.name} />)}
          </View>
          <Text accessibilityRole="header" numberOfLines={3} style={styles.title}>{video.title}</Text>
          {metadata.length > 0 ? <Text style={styles.meta}>{metadata.join("  •  ")}</Text> : null}

          {video.channel_id && onOpenChannel ? (
            <ChannelButton
              onTargetReady={setChannelTarget}
              api={api}
              video={video}
              nextFocusUp={backTarget ?? undefined}
              nextFocusDown={descriptionTarget ?? firstActionTarget ?? undefined}

              onPress={() => onOpenChannel(video.channel_id!)}
            />
          ) : (
            <Text style={styles.channelName}>{video.channel_title}</Text>
          )}

          {video.description ? <TvTextDetails ref={setDescriptionTarget} text={video.description} title={t("descriptionTitle")} t={t}
            nextFocusUp={channelTarget ?? backTarget ?? undefined} nextFocusDown={firstActionTarget ?? undefined} /> : null}
          <View style={styles.actions}>
            <TvButton ref={setFirstActionTarget} deferPress preferredFocus icon="play"
              label={startAt > 0 ? `${t("resumePlayback")} · ${playbackTime(startAt)}` : t("playVideo")}
              variant="primary" nextFocusUp={descriptionTarget ?? channelTarget ?? backTarget ?? undefined}
              nextFocusDown={queueTarget ?? relatedTarget ?? commentsTarget ?? undefined}
              onPress={() => setPlayingFrom(startAt)}
            />
            {startAt > 0 ? <TvButton deferPress label={t("playFromStart")}
              nextFocusUp={descriptionTarget ?? channelTarget ?? backTarget ?? undefined}
              nextFocusDown={queueTarget ?? relatedTarget ?? commentsTarget ?? undefined}
              onPress={() => setPlayingFrom(0)} /> : null}
            {queued || canQueueTvVideo(video) ? <TvButton icon="queue" label={t(queued ? "removeFromQueue" : queue.items.length >= SESSION_QUEUE_LIMIT ? "queueFull" : "addToQueue")}
              disabled={!queued && queue.items.length >= SESSION_QUEUE_LIMIT}
              nextFocusUp={descriptionTarget ?? channelTarget ?? backTarget ?? undefined} nextFocusDown={queueTarget ?? relatedTarget ?? undefined}
              onPress={() => queued ? queue.remove(video.video_id) : queue.add(video)} /> : null}
            <TvButton deferPress label={t("more")} icon="more"
              nextFocusUp={descriptionTarget ?? channelTarget ?? backTarget ?? undefined}
              nextFocusDown={queueTarget ?? relatedTarget ?? commentsTarget ?? undefined}
              onPress={openActions} />
          </View>
          {saveFailed ? <Text style={styles.actionError}>{t("playbackSaveError")}</Text> : null}
        </View>
      </View>

      {sequence.next || queue.items.length ? <TVFocusGuideView autoFocus style={styles.queueSection}>
        <Text accessibilityRole="header" style={styles.sectionTitle}>{t(sequence.next ? "upNext" : "playQueue")}</Text>
        <View style={styles.queueHeading}>
          {sequence.next ? <View style={{ flex: 1 }}><TvListButton ref={setNextTarget} deferPress label={sequence.next.title} detail={sequence.next.channel_title}
            nextFocusUp={firstActionTarget ?? undefined} nextFocusDown={relatedTarget ?? commentsTarget ?? undefined}
            onPress={() => onOpenVideo(sequence.next!, queueContext ?? video.playback_context ?? sequence.context ?? undefined, true)} /></View> : null}
          <TvButton ref={setQueueButtonTarget} deferPress label={`${t("playQueue")} · ${queue.items.length}`} icon="queue"
            nextFocusUp={firstActionTarget ?? undefined} nextFocusDown={relatedTarget ?? commentsTarget ?? undefined} onPress={() => onShowQueue(queueButtonTarget)} />
        </View>
      </TVFocusGuideView> : null}
      {sequence.failed ? <Text style={styles.actionError}>{t("queueLoadError")}</Text> : null}

      {showRelated ? (
        <>
          <TvVideoShelf
            title={t("relatedVideos")}
            videos={related}
            cardWidth={cardWidth}
            firstItemRef={setRelatedTarget}
            language={language}
            nextFocusUp={queueTarget ?? firstActionTarget ?? undefined}
            nextFocusDown={commentsTarget ?? undefined}
            thumbnailSource={relatedThumbnailSource}
            onOpen={openRelatedVideo}
            onLongPress={openRelatedVideoActions}
            viewsLabel={t("views")}
          />
        </>
      ) : null}

      {mode !== "disabled" ? (
        <TVFocusGuideView autoFocus style={styles.commentsSection}>
          <Text accessibilityRole="header" style={styles.sectionTitle}>{t("commentsTitle")}</Text>
          <View style={styles.commentsToolbar}>
            <TvButton
              ref={setCommentsTarget}
              label={commentsLoading ? t("loadingComments") : commentsError ? t("tryAgain") : comments === null ? t("loadComments") : t("refresh")}
              style={styles.inlineButton}
              nextFocusUp={relatedTarget ?? queueTarget ?? firstActionTarget ?? channelTarget ?? backTarget ?? undefined}
              onFocus={() => {
                if (mode === "scroll" && comments === null && !commentsLoading && !commentsError) void loadComments();
              }}
              onPress={() => { if (!commentsLoading) void loadComments(); }}
            />
            {commentsLoading ? <TvLoadingMark accessibilityLabel={t("loadingComments")} size={27} /> : null}
          </View>
          {commentsError ? <Text style={styles.commentsStatus}>{t("commentsLoadError")}</Text> : null}
          {comments?.length === 0 ? <Text style={styles.commentsStatus}>{t("commentsEmpty")}</Text> : null}
        </TVFocusGuideView>
      ) : null}
        </>
      )}
    /> : null}
    {playingFrom !== null ? <TvNativePlayer api={api} video={video} startPosition={playingFrom} incognito={incognito} isChild={isChild} t={t} onClose={closePlayer} queueVideos={sequence.queueVideos} nextVideo={sequence.next} previousVideo={sequence.previous} queueContext={queueContext ?? video.playback_context ?? sequence.context}
      queueLoading={sequence.loading}
      onAdvance={(next) => { requestVersion.current++; setVideo(next); setPreview(next); }}
      onProgress={(played, result) => {
        if (result.saveFailed) setSaveFailed(true);
        if ((!incognito || isChild) && result.duration > 0 && !result.saveFailed) onVideoChange(played);
      }}
      advanceOnEnd={shouldAdvanceQueue(sequence.context, settings?.feed_autoplay_enabled, settings?.feed_autoplay_behavior)} /> : null}
    </View>
  );
}

function MetaBadge({ label, strong = false }: { label: string; strong?: boolean }) {
  return <View style={[styles.badge, strong && styles.badgeStrong]}><Text style={[styles.badgeText, strong && styles.badgeStrongText]}>{label}</Text></View>;
}

function ChannelButton({ api, video, nextFocusUp, nextFocusDown, onTargetReady, onPress }: { api: YtZeroApi; video: Video; nextFocusUp?: FocusDestination; nextFocusDown?: FocusDestination; onTargetReady: (target: View | null) => void; onPress: () => void }) {
  const avatar = video.channel_thumbnail ? api.thumbnailSource(video.channel_thumbnail) : null;
  return (
    <TvPressable
      ref={onTargetReady}
      deferPress
      accessibilityRole="button"
      accessibilityLabel={video.channel_title}
      nextFocusUp={nextFocusUp}
      nextFocusDown={nextFocusDown}
      onPress={onPress}
      style={({ focused, pressed }) => [styles.channelButton, focused && styles.channelButtonFocused, pressed && styles.channelButtonPressed]}
    >
      {({ focused }) => <>
        <TvControlSurface radius={39} focused={focused} filled={false} />
        {avatar?.uri ? <Image source={imageSourceWithHeaders(avatar)} style={styles.channelAvatar} /> : <View style={[styles.channelAvatar, styles.channelAvatarPlaceholder]} />}
        <View style={styles.channelCopy}>
          <Text numberOfLines={1} style={[styles.channelTitle, focused && styles.channelTextFocused]}>{video.channel_title}</Text>
          {video.channel_subscriber_count ? <Text style={[styles.channelSubscribers, focused && styles.channelSubTextFocused]}>{video.channel_subscriber_count}</Text> : null}
        </View>
      </>}
    </TvPressable>
  );
}

function CommentCard({ api, comment, t }: { api: YtZeroApi; comment: VideoComment; t: Translate }) {
  const avatar = comment.authorThumbnail ? api.thumbnailSource(comment.authorThumbnail) : null;
  const flags = [comment.isPinned ? t("pinnedComment") : "", comment.authorIsUploader ? t("creatorComment") : "", comment.timeText ?? ""].filter(Boolean);
  return (
    <View style={styles.commentCard}>
      {avatar?.uri ? <Image source={imageSourceWithHeaders(avatar)} style={styles.commentAvatar} /> : <View style={[styles.commentAvatar, styles.channelAvatarPlaceholder]} />}
      <View style={styles.commentCopy}>
        <View style={styles.commentHeader}>
          <Text style={styles.commentAuthor}>{comment.author}</Text>
          {flags.length > 0 ? <Text style={styles.commentMeta}>{flags.join("  •  ")}</Text> : null}
          {comment.likeCount > 0 ? <Text style={styles.commentMeta}>♥ {comment.likeCount}</Text> : null}
        </View>
        <TvTextDetails text={comment.text} title={comment.author} t={t} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { paddingHorizontal: screenPadding, paddingTop: 132, paddingBottom: 110 },
  errorPanel: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 24, paddingVertical: 18, paddingHorizontal: 22, marginBottom: 24, borderRadius: 22, backgroundColor: "rgba(255,159,154,0.12)" },
  errorText: { flex: 1, color: colors.danger, fontSize: typography.caption.fontSize, lineHeight: typography.caption.lineHeight, fontWeight: "700" },
  hero: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", gap: 64, paddingBottom: 32 },
  shortHero: { flexDirection: "row-reverse", alignItems: "center" },
  imageFrame: { width: "57%", aspectRatio: 16 / 9, borderRadius: 30, overflow: "hidden", backgroundColor: colors.surface, shadowColor: colors.black, shadowOpacity: 0.62, shadowRadius: 34, shadowOffset: { width: 0, height: 18 } },
  shortImageFrame: { aspectRatio: 9 / 16, marginRight: 120 },
  image: { width: "100%", height: "100%", backgroundColor: colors.surface },
  imagePlaceholder: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface },
  imagePlaceholderText: { color: colors.textMuted, fontSize: 34, fontWeight: "800" },
  posterShade: { position: "absolute", left: 0, right: 0, bottom: 0, height: "30%", backgroundColor: "rgba(0,0,0,0.12)" },
  duration: { position: "absolute", right: 16, bottom: 18, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: "rgba(0,0,0,0.78)" },
  durationText: { color: colors.white, fontSize: typography.caption.fontSize, fontWeight: "800" },
  progressTrack: { position: "absolute", left: 0, right: 0, bottom: 0, height: 8, backgroundColor: "rgba(255,255,255,0.24)" },
  progressFill: { height: "100%", backgroundColor: colors.accentStrong },
  copy: { flex: 1, minWidth: 0, maxWidth: 980, paddingTop: 80 },
  badges: { flexDirection: "row", flexWrap: "wrap", gap: 9, minHeight: 28 },
  badge: { paddingHorizontal: 11, paddingVertical: 5, borderRadius: 12, backgroundColor: colors.surfaceRaised },
  badgeStrong: { backgroundColor: colors.danger },
  badgeText: { color: colors.textMuted, fontSize: typography.caption.fontSize, lineHeight: typography.caption.lineHeight, fontWeight: "700" },
  badgeStrongText: { color: colors.black, fontWeight: "900" },
  title: { color: colors.text, fontSize: 58, lineHeight: 66, fontWeight: "700", letterSpacing: -1.8, marginTop: 13 },
  meta: { color: colors.textMuted, fontSize: typography.caption.fontSize, lineHeight: typography.caption.lineHeight, marginTop: 14 },
  channelName: { color: colors.text, fontSize: typography.caption.fontSize, fontWeight: "700", marginTop: 24 },
  channelButton: { alignSelf: "flex-start", flexDirection: "row", alignItems: "center", minWidth: 440, maxWidth: "100%", minHeight: 78, paddingVertical: 8, paddingHorizontal: 10, marginTop: 24, borderRadius: 39, backgroundColor: "transparent" },
  channelButtonFocused: { shadowColor: colors.black, shadowOpacity: 0.68, shadowRadius: 20, shadowOffset: { width: 0, height: 11 } },
  channelButtonPressed: { opacity: 0.85 },
  channelAvatar: { width: 62, height: 62, borderRadius: 31, backgroundColor: colors.surfaceRaised },
  channelAvatarPlaceholder: { backgroundColor: colors.surfaceRaised },
  channelCopy: { flex: 1, minWidth: 0, paddingHorizontal: 14 },
  channelTitle: { color: colors.text, fontSize: typography.caption.fontSize, lineHeight: typography.caption.lineHeight, fontWeight: "700" },
  channelSubscribers: { color: colors.textMuted, fontSize: typography.caption.fontSize, marginTop: 3 },
  channelTextFocused: { color: colors.text },
  channelSubTextFocused: { color: colors.text },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 13, marginTop: 28 },
  actionError: { color: colors.danger, fontSize: typography.caption.fontSize, lineHeight: typography.caption.lineHeight, fontWeight: "700", marginTop: 16 },
  queueSection: { marginBottom: 48, maxWidth: 1360 },
  queueHeading: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 18, gap: 24 },
  sectionTitle: { color: colors.text, fontSize: 27, lineHeight: 34, fontWeight: "700", marginBottom: 18 },
  commentsSection: { maxWidth: 1420, marginTop: 42 },
  inlineButton: { alignSelf: "flex-start" },
  commentsToolbar: { flexDirection: "row", alignItems: "center", gap: 22, marginBottom: 18 },
  commentsStatus: { color: colors.textMuted, fontSize: typography.caption.fontSize, lineHeight: typography.caption.lineHeight },
  commentCard: { maxWidth: 1420, flexDirection: "row", gap: 18, padding: 22, marginBottom: 14, borderRadius: 24, backgroundColor: colors.surface },
  commentAvatar: { width: 54, height: 54, borderRadius: 27, backgroundColor: colors.surfaceRaised },
  commentCopy: { flex: 1, minWidth: 0 },
  commentHeader: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 12, marginBottom: 9 },
  commentAuthor: { color: colors.text, fontSize: typography.caption.fontSize, lineHeight: typography.caption.lineHeight, fontWeight: "700" },
  commentMeta: { color: colors.textMuted, fontSize: typography.caption.fontSize, lineHeight: typography.caption.lineHeight },
});
