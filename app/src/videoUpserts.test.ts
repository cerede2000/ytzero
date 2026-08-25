import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { CHANNEL_SYNC_VIDEO_UPSERT_SQL, DIRECT_VIDEO_INFO_UPSERT_SQL, localisedTitleUpdates, RSS_VIDEO_UPSERT_SQL } from "./videoUpserts";

describe("RSS video upsert", () => {
  test("clears a stale members-only flag when an upload becomes public", () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE videos (
        video_id TEXT PRIMARY KEY,
        channel_id TEXT,
        title TEXT,
        title_original TEXT,
        description TEXT,
        thumbnail TEXT,
        published_at TEXT,
        published_at_approximate INTEGER NOT NULL DEFAULT 0,
        views INTEGER,
        likes INTEGER,
        members_only INTEGER NOT NULL DEFAULT 0,
        is_private INTEGER NOT NULL DEFAULT 0,
        is_unavailable INTEGER NOT NULL DEFAULT 0,
        availability_checked_at TEXT,
        embeddable INTEGER,
        is_short INTEGER
      );
      INSERT INTO videos (video_id, channel_id, title, members_only, is_unavailable)
      VALUES ('unlock-me', 'channel', 'Members preview', 1, 1);
    `);

    db.query(RSS_VIDEO_UPSERT_SQL).run(
      "unlock-me",
      "channel",
      "Public release",
      "Public release",
      "Now available to everyone",
      "thumbnail.jpg",
      "2026-08-07T12:00:00Z",
      100,
      10,
    );

    expect(db.query("SELECT title, members_only, is_unavailable, availability_checked_at IS NOT NULL AS checked FROM videos WHERE video_id = 'unlock-me'").get())
      .toEqual({ title: "Public release", members_only: 0, is_unavailable: 0, checked: 1 });
  });
});

describe("direct video info upsert", () => {
  test("replaces a stale RSS status with the authoritative live status", () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE videos (
        video_id TEXT PRIMARY KEY,
        channel_id TEXT,
        title TEXT,
        title_original TEXT,
        description TEXT,
        thumbnail TEXT,
        published_at TEXT,
        published_at_approximate INTEGER NOT NULL DEFAULT 1,
        live_status TEXT NOT NULL DEFAULT 'none',
        status TEXT NOT NULL DEFAULT 'inbox',
        views INTEGER,
        duration TEXT,
        external INTEGER NOT NULL DEFAULT 0,
        is_private INTEGER NOT NULL DEFAULT 0,
        is_unavailable INTEGER NOT NULL DEFAULT 0,
        availability_checked_at TEXT,
        embeddable INTEGER,
        is_short INTEGER
      );
      INSERT INTO videos
        (video_id, channel_id, title, description, thumbnail, live_status, status, duration, external)
      VALUES
        ('live-radio', 'channel', 'RSS title', '', 'rss.jpg', 'none', 'queued', '10:00', 0);
    `);

    db.query(DIRECT_VIDEO_INFO_UPSERT_SQL).run(
      "live-radio",
      "channel",
      "Live radio",
      "Live radio",
      "Broadcasting now",
      "live.jpg",
      "2026-08-13T20:00:00Z",
      "live",
      123,
      null,
      null,
      null
    );

    expect(db.query(`
      SELECT title, live_status, status, duration, external,
             published_at_approximate, availability_checked_at IS NOT NULL AS checked
      FROM videos WHERE video_id = 'live-radio'
    `).get()).toEqual({
      title: "Live radio",
      live_status: "live",
      status: "queued",
      duration: null,
      external: 0,
      published_at_approximate: 0,
      checked: 1,
    });
  });

  test("records a live status when inserting a directly opened video", () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE videos (
        video_id TEXT PRIMARY KEY,
        channel_id TEXT,
        title TEXT,
        title_original TEXT,
        description TEXT,
        thumbnail TEXT,
        published_at TEXT,
        published_at_approximate INTEGER NOT NULL DEFAULT 0,
        live_status TEXT NOT NULL DEFAULT 'none',
        status TEXT NOT NULL DEFAULT 'inbox',
        views INTEGER,
        duration TEXT,
        external INTEGER NOT NULL DEFAULT 0,
        is_private INTEGER NOT NULL DEFAULT 0,
        is_unavailable INTEGER NOT NULL DEFAULT 0,
        availability_checked_at TEXT,
        embeddable INTEGER,
        is_short INTEGER
      );
    `);

    db.query(DIRECT_VIDEO_INFO_UPSERT_SQL).run(
      "live-radio", "channel", "Live radio", "Live radio", "", "live.jpg", null, "live", 123, null,
      null, null
    );

    expect(db.query("SELECT live_status, external FROM videos WHERE video_id = 'live-radio'").get())
      .toEqual({ live_status: "live", external: 1 });
  });
});

describe("a title this instance is showing in its own language", () => {
  const library = () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE videos (
        video_id TEXT PRIMARY KEY,
        channel_id TEXT,
        title TEXT,
        title_original TEXT,
        description TEXT,
        thumbnail TEXT,
        published_at TEXT,
        published_at_approximate INTEGER NOT NULL DEFAULT 0,
        views INTEGER,
        likes INTEGER,
        members_only INTEGER NOT NULL DEFAULT 0,
        is_private INTEGER NOT NULL DEFAULT 0,
        is_unavailable INTEGER NOT NULL DEFAULT 0,
        availability_checked_at TEXT
      );
      INSERT INTO videos (video_id, channel_id, title, title_original)
      VALUES ('shiitake', 'channel', 'Culture de champignons shiitakés', '椎茸の生産から');
    `);
    return db;
  };
  const feed = (db: Database, uploaderTitle: string) => db.query(RSS_VIDEO_UPSERT_SQL).run(
    "shiitake", "channel", uploaderTitle, uploaderTitle, "", "", "", null, null,
  );
  const titleOf = (db: Database) =>
    (db.query("SELECT title FROM videos WHERE video_id = 'shiitake'").get() as { title: string }).title;

  /*
   * The channel feed never translates. Left to write the title every time it
   * ran, it put the Japanese one back within ten minutes of the video being
   * listed in French — which is what this looked like from the sofa.
   */
  test("survives the feed saying what it said last time", () => {
    const db = library();
    feed(db, "椎茸の生産から");
    expect(titleOf(db)).toBe("Culture de champignons shiitakés");
  });

  test("gives way when the uploader actually renames the video", () => {
    const db = library();
    feed(db, "椎茸の生産から（改訂版）");
    expect(titleOf(db)).toBe("椎茸の生産から（改訂版）");
  });

  // Every row predates the column. Until something reads the watch page for
  // one, the feed is the only title there is, and it says so.
  test("is written for a row nothing has looked at yet", () => {
    const db = library();
    db.exec("UPDATE videos SET title_original = NULL");
    feed(db, "椎茸の生産から");
    expect(titleOf(db)).toBe("椎茸の生産から");
  });
});

describe("a channel sync, which sees both titles at once", () => {
  const library = (seed?: string) => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE videos (
        video_id TEXT PRIMARY KEY,
        channel_id TEXT,
        title TEXT,
        title_original TEXT,
        description TEXT,
        thumbnail TEXT,
        published_at TEXT,
        published_at_approximate INTEGER NOT NULL DEFAULT 0,
        members_only INTEGER NOT NULL DEFAULT 0,
        views INTEGER,
        likes INTEGER,
        duration TEXT,
        is_private INTEGER NOT NULL DEFAULT 0,
        is_unavailable INTEGER NOT NULL DEFAULT 0,
        availability_checked_at TEXT
      );
    `);
    if (seed) db.exec(seed);
    return db;
  };
  const sync = (db: Database, shown: string, uploader: string | null) =>
    db.query(CHANNEL_SYNC_VIDEO_UPSERT_SQL).run(
      "shiitake", "channel", shown, uploader, "", "", "", 1, 0, null, null, null,
    );
  const row = (db: Database) =>
    db.query("SELECT title, title_original FROM videos WHERE video_id = 'shiitake'").get();

  /*
   * The page is read in the library's language and answers in it — this is the
   * title YouTube itself shows a French reader. The feed's Japanese one is
   * kept beside it rather than shown, and rather than thrown away.
   */
  test("shows the page's title and remembers the feed's", () => {
    const db = library();
    sync(db, "Culture de champignons shiitakés", "椎茸の生産から");
    expect(row(db)).toEqual({ title: "Culture de champignons shiitakés", title_original: "椎茸の生産から" });
  });

  test("keeps what the uploader wrote when this pass was not told it", () => {
    const db = library("INSERT INTO videos (video_id, channel_id, title, title_original) VALUES ('shiitake', 'channel', 'x', '椎茸の生産から')");
    sync(db, "Culture de champignons shiitakés", null);
    expect(row(db)).toEqual({ title: "Culture de champignons shiitakés", title_original: "椎茸の生産から" });
  });
});

describe("the titles a channel page can correct", () => {
  const page = [
    { videoId: "shiitake", title: "Culture de champignons shiitakés" },
    { videoId: "onduleur", title: "Fabrication d'énormes onduleurs" },
  ];

  /*
   * The case that started this: a video published six hours ago, listed under
   * the Japanese title the feed handed back, on a library kept in French —
   * while the channel page had the French one all along.
   */
  test("are the ones the page spells differently", () => {
    expect(localisedTitleUpdates(page, [
      { video_id: "shiitake", title: "椎茸の生産から" },
      { video_id: "onduleur", title: "Fabrication d'énormes onduleurs" },
    ])).toEqual([{ videoId: "shiitake", title: "Culture de champignons shiitakés" }]);
  });

  test("are none when the row already says what the page says", () => {
    expect(localisedTitleUpdates(page, [
      { video_id: "shiitake", title: "Culture de champignons shiitakés" },
      { video_id: "onduleur", title: "Fabrication d'énormes onduleurs" },
    ])).toEqual([]);
  });

  // The page lists the most recent thirty; saying nothing about the rest is
  // not an opinion about them.
  test("never mention a video the page did not list", () => {
    expect(localisedTitleUpdates(page, [{ video_id: "ancienne", title: "古い動画" }])).toEqual([]);
  });

  test("ignore an entry the page left without a title", () => {
    expect(localisedTitleUpdates([{ videoId: "shiitake", title: "" }], [{ video_id: "shiitake", title: "椎茸の生産から" }]))
      .toEqual([]);
  });
});
