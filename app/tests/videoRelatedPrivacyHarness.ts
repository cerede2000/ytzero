const { api } = await import("../src/routes");
const { db } = await import("../src/db");

const primaryId = 1;
const secondary = db.prepare(
  "INSERT INTO users(name, avatar_color, sort_order, portable_uuid) VALUES(?, ?, ?, ?) RETURNING id",
).get("Secondary", "#123456", 1, crypto.randomUUID()) as { id: number };

const addChannel = db.prepare(
  "INSERT INTO channels(channel_id, title, url, thumbnail, external) VALUES(?, ?, ?, ?, ?)",
);
addChannel.run("UC-related-primary", "Primary", "", "primary.jpg", 0);
addChannel.run("UC-related-owned", "Owned", "", "owned.jpg", 0);
addChannel.run("UC-related-temporary", "Temporary", "", "temporary.jpg", 1);
addChannel.run("UC-related-secondary", "Secondary", "", "secondary.jpg", 0);

const follow = db.prepare("INSERT INTO user_channels(user_id, channel_id, followed) VALUES(?, ?, 1)");
follow.run(primaryId, "UC-related-primary");
follow.run(primaryId, "UC-related-owned");
follow.run(secondary.id, "UC-related-secondary");

const addVideo = db.prepare(`
  INSERT INTO videos(video_id, channel_id, title, thumbnail, published_at, is_short, external)
  VALUES (?, ?, ?, ?, ?, 0, ?)
`);
const publishedAt = new Date(Date.now() - 60_000).toISOString();
addVideo.run("related-current", "UC-related-primary", "Current", "current.jpg", publishedAt, 0);
addVideo.run("related-followed", "UC-related-owned", "Followed", "followed.jpg", publishedAt, 0);
addVideo.run("related-incognito-cache", "UC-related-temporary", "Incognito cache", "incognito.jpg", publishedAt, 1);
addVideo.run("related-primary-history", "UC-related-temporary", "Primary history", "primary-history.jpg", publishedAt, 1);
addVideo.run("related-other-profile", "UC-related-secondary", "Other profile", "other-profile.jpg", publishedAt, 0);

db.prepare("INSERT INTO history(video_id, user_id) VALUES(?, ?)").run("related-primary-history", primaryId);
db.prepare("INSERT INTO history(video_id, user_id) VALUES(?, ?)").run("related-other-profile", secondary.id);

const response = await api.request("http://localhost/videos/related-current", {
  headers: { Cookie: `ytzero_profile=${primaryId}` },
});
const body = await response.json() as any;

console.log("RESULT " + JSON.stringify({
  status: response.status,
  ids: body.related.map((video: any) => video.video_id),
  temporaryStillCached: Boolean(db.prepare("SELECT 1 FROM videos WHERE video_id = ?").get("related-incognito-cache")),
}));

db.close();
