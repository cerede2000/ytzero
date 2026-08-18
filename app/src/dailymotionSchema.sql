-- Dailymotion, kept to itself.
--
-- Its own file, the way the community posts and TubeArchivist features have
-- theirs. Nothing here references videos or channels: the two id spaces are
-- deliberately not shared, and a Dailymotion id in a YouTube column would be a
-- question about whichever video happens to spell the same. So removing the
-- feature is deleting this file, dropping its line from the canonical list,
-- and one migration that drops these two tables.
--
-- What is stored is the reader's relationship to a video, never the video. A
-- title, a duration, a thumbnail all belong to Dailymotion and are asked for
-- when they are needed; a position belongs to whoever watched.

CREATE TABLE IF NOT EXISTS dailymotion_follows (
  user_id      INTEGER NOT NULL,
  channel_id   TEXT NOT NULL,
  screenname   TEXT NOT NULL DEFAULT '',
  avatar       TEXT NOT NULL DEFAULT '',
  added_at     TEXT NOT NULL DEFAULT (datetime('now')),
  -- Everything published after this instant is new to this reader, and that is
  -- the whole memory: asked for what came after it, the API answers with the
  -- new list itself. No video of theirs is ever written down to know it has
  -- been seen.
  seen_through INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, channel_id)
);

CREATE INDEX IF NOT EXISTS idx_dailymotion_follows_user
  ON dailymotion_follows(user_id, added_at DESC);

CREATE TABLE IF NOT EXISTS dailymotion_progress (
  user_id          INTEGER NOT NULL,
  video_id         TEXT NOT NULL,
  position_seconds REAL NOT NULL DEFAULT 0,
  duration_seconds REAL,
  watched          INTEGER NOT NULL DEFAULT 0,
  updated_at       TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, video_id)
);

CREATE INDEX IF NOT EXISTS idx_dailymotion_progress_user
  ON dailymotion_progress(user_id, updated_at DESC);
