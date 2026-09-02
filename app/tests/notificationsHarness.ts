const { notifyChannelVideos, notifyDownloadFailed } = await import("../src/notifications");
const { db } = await import("../src/db");

db.prepare("INSERT INTO channels(channel_id, title, url) VALUES(?, ?, ?)")
  .run("UCnotify", "Notification channel", "https://youtube.com/channel/UCnotify");
db.prepare("INSERT INTO videos(video_id, channel_id, title, thumbnail) VALUES(?, ?, ?, ?)")
  .run("notifyvideo1", "UCnotify", "Failed video", "https://example.com/thumb.jpg");
db.prepare("INSERT INTO downloads(video_id, status, error, attempts, created_at) VALUES(?, 'error', ?, 1, ?)")
  .run("notifyvideo1", "network failure", "2026-07-28 20:00:00");
db.prepare("INSERT INTO download_owners(user_id, video_id, source) VALUES(1, ?, 'manual')").run("notifyvideo1");
db.prepare("INSERT INTO users(name, avatar_color, sort_order, portable_uuid, is_child) VALUES(?, ?, ?, ?, 1)")
  .run("Child", "#123456", 1, crypto.randomUUID());

const firstCreated = await notifyDownloadFailed("notifyvideo1", "network failure");
const duplicateCreated = await notifyDownloadFailed("notifyvideo1", "network failure");
const firstRows = db.prepare("SELECT user_id, kind, target, payload FROM notifications ORDER BY id").all();

db.prepare("UPDATE downloads SET created_at = ? WHERE video_id = ?")
  .run("2026-07-28 21:00:00", "notifyvideo1");
const nextCycleCreated = await notifyDownloadFailed("notifyvideo1", "another failure");
const finalCount = (db.prepare("SELECT count(*) AS count FROM notifications").get() as { count: number }).count;

db.prepare("INSERT INTO user_channels(user_id,channel_id,followed) VALUES(1,'UCnotify',1)").run();
const channelDefaultCreated = await notifyChannelVideos("UCnotify", ["notifyvideo1"]);
db.prepare("INSERT INTO notification_preferences(user_id,kind,source_id,enabled) VALUES(1,'channel_video','UCnotify',1)").run();
const channelOverrideCreated = await notifyChannelVideos("UCnotify", ["notifyvideo1"]);
db.prepare("UPDATE downloads SET created_at='2026-07-28 22:00:00' WHERE video_id='notifyvideo1'").run();
db.prepare("INSERT INTO notification_preferences(user_id,kind,source_id,enabled) VALUES(1,'*','',0)").run();
const masterDisabledCreated = await notifyDownloadFailed("notifyvideo1", "disabled");

console.log("RESULT " + JSON.stringify({ firstCreated, duplicateCreated, firstRows, nextCycleCreated, finalCount, channelDefaultCreated, channelOverrideCreated, masterDisabledCreated }));
db.close();
