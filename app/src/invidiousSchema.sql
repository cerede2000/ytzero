-- Client access, kept to itself.
--
-- Its own file, the way Dailymotion and the community posts have theirs.
-- Nothing here references users, videos or channels: a profile is named by its
-- id and nothing else, so removing the feature is deleting this file, dropping
-- its line from the canonical list, and one migration that drops this table.
--
-- What is stored is never the token. A client authenticates by presenting it,
-- and what is kept is a keyed hash of it — enough to recognise the token on
-- sight, not enough to reconstruct it. Regenerating replaces the row, which is
-- what revocation is: every device holding the old one is turned away at once.

CREATE TABLE IF NOT EXISTS invidious_tokens (
  -- One per profile: minting a second is replacing the first.
  user_id      INTEGER NOT NULL PRIMARY KEY,
  token_hash   TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  -- When a client last presented it, so a token nobody uses can be seen.
  last_used_at TEXT
);

-- The lookup a request makes: from the hash of what was presented, to whose it
-- is. Unique because two profiles sharing a token would make that answer a
-- guess.
CREATE UNIQUE INDEX IF NOT EXISTS idx_invidious_tokens_hash ON invidious_tokens(token_hash);
