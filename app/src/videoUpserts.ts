/**
 * RSS contains only publicly available uploads. Seeing a previously
 * members-only video there is therefore authoritative evidence that YouTube
 * has unlocked it for everyone.
 */
export const RSS_VIDEO_UPSERT_SQL = `
  INSERT INTO videos (video_id, channel_id, title, title_original, description, thumbnail, published_at, views, likes)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(video_id) DO UPDATE SET
    -- The feed hands back what the uploader wrote, never a translation. So it
    -- speaks for the title only when the uploader has actually changed it: for
    -- a video this instance is listing under a translated title, the feed
    -- saying the same thing it said last week is not news, and writing it back
    -- is how a French title became Japanese again ten minutes later.
    title = CASE
      WHEN videos.title_original IS NULL OR videos.title_original = '' THEN excluded.title
      WHEN videos.title_original != excluded.title_original THEN excluded.title
      ELSE videos.title
    END,
    title_original = COALESCE(excluded.title_original, videos.title_original),
    description = excluded.description,
    thumbnail = CASE WHEN TRIM(excluded.thumbnail) != '' THEN excluded.thumbnail ELSE videos.thumbnail END,
    published_at = CASE WHEN excluded.published_at IS NOT NULL AND excluded.published_at != '' THEN excluded.published_at ELSE videos.published_at END,
    published_at_approximate = CASE WHEN excluded.published_at IS NOT NULL AND excluded.published_at != '' THEN 0 ELSE videos.published_at_approximate END,
    views = COALESCE(excluded.views, videos.views),
    likes = COALESCE(excluded.likes, videos.likes),
    members_only = 0,
    is_private = 0,
    is_unavailable = 0,
    availability_checked_at = datetime('now')
`;

/**
 * A direct watch-page lookup is authoritative for the video's current live
 * state. Unlike RSS, it can distinguish an active/upcoming/ended stream from
 * an ordinary upload, so it must replace a stale status imported earlier from
 * a channel feed while preserving profile-independent library ownership.
 */
export const DIRECT_VIDEO_INFO_UPSERT_SQL = `
  INSERT INTO videos
    (video_id, channel_id, title, title_original, description, thumbnail, published_at, live_status, status, views, duration, external, embeddable, is_short)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'inbox', ?, ?, 1, ?, ?)
  ON CONFLICT(video_id) DO UPDATE SET
    channel_id = excluded.channel_id,
    -- The watch page is the one source that sees both, so it settles both.
    title = CASE WHEN TRIM(excluded.title) != '' THEN excluded.title ELSE videos.title END,
    title_original = CASE WHEN TRIM(COALESCE(excluded.title_original, '')) != '' THEN excluded.title_original ELSE videos.title_original END,
    description = CASE WHEN TRIM(excluded.description) != '' THEN excluded.description ELSE videos.description END,
    thumbnail = CASE WHEN TRIM(excluded.thumbnail) != '' THEN excluded.thumbnail ELSE videos.thumbnail END,
    published_at = CASE WHEN excluded.published_at IS NOT NULL AND excluded.published_at != '' THEN excluded.published_at ELSE videos.published_at END,
    published_at_approximate = CASE WHEN excluded.published_at IS NOT NULL AND excluded.published_at != '' THEN 0 ELSE videos.published_at_approximate END,
    live_status = excluded.live_status,
    -- A settled format replaces an unknown one; an unknown one never replaces
    -- a settled one, because failing to check is not evidence of anything.
    is_short = COALESCE(excluded.is_short, videos.is_short),
    views = COALESCE(excluded.views, videos.views),
    duration = CASE
      WHEN excluded.live_status IN ('live', 'upcoming') THEN NULL
      ELSE COALESCE(excluded.duration, videos.duration)
    END,
    is_private = 0,
    is_unavailable = 0,
    -- An answer that did not carry it leaves what was known standing.
    embeddable = COALESCE(excluded.embeddable, videos.embeddable),
    availability_checked_at = datetime('now')
`;

/**
 * What a channel sync knows, which is both titles at once.
 *
 * The channel page is fetched in the language the library is kept in and
 * answers in it; the feed beside it never translates. So the page settles what
 * is shown and the feed settles what the uploader wrote, and the passes that
 * come later can tell a rename from a translation without asking anybody.
 */
export const CHANNEL_SYNC_VIDEO_UPSERT_SQL = `
    INSERT INTO videos (video_id, channel_id, title, title_original, description, thumbnail, published_at, published_at_approximate, members_only, views, likes, duration)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(video_id) DO UPDATE SET
      -- The channel page is read in the library's language and answers in it,
      -- so its title is the one to show. The feed's is the uploader's own, and
      -- goes where the passes that never translate can compare against it.
      title = excluded.title,
      title_original = COALESCE(excluded.title_original, videos.title_original),
      thumbnail = CASE WHEN TRIM(excluded.thumbnail) != '' THEN excluded.thumbnail ELSE videos.thumbnail END,
      published_at = CASE
        WHEN excluded.published_at IS NULL OR excluded.published_at = '' THEN videos.published_at
        WHEN excluded.published_at_approximate = 0 THEN excluded.published_at
        ELSE COALESCE(videos.published_at, excluded.published_at)
      END,
      published_at_approximate = CASE
        WHEN excluded.published_at IS NULL OR excluded.published_at = '' THEN videos.published_at_approximate
        WHEN excluded.published_at_approximate = 0 THEN 0
        WHEN videos.published_at IS NULL OR videos.published_at = '' THEN 1
        ELSE videos.published_at_approximate
      END,
      members_only = excluded.members_only,
      views = COALESCE(excluded.views, videos.views),
      duration = COALESCE(excluded.duration, videos.duration),
      is_private = 0,
      is_unavailable = 0,
      availability_checked_at = datetime('now')
  `;
