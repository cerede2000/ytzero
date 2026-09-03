import { database } from "./database";
import { syncUserPlaylistOfflinePolicy } from "./downloader";

export interface UserPlaylistRule {
  id: number;
  playlist_id: number;
  pattern: string;
  match_type: "contains" | "regex";
  field: "title" | "description" | "both";
  user_id?: number;
}

interface VideoForRules {
  video_id: string;
  title: string;
  description: string;
}

function ruleMatches(rule: UserPlaylistRule, title: string, description: string): boolean {
  const haystacks: string[] = [];
  if (rule.field === "title" || rule.field === "both") haystacks.push(title);
  if (rule.field === "description" || rule.field === "both") haystacks.push(description);
  if (rule.match_type === "regex") {
    try {
      const re = new RegExp(rule.pattern, "i");
      return haystacks.some((h) => re.test(h));
    } catch {
      return false;
    }
  }
  const needle = rule.pattern.toLowerCase();
  return haystacks.some((h) => h.toLowerCase().includes(needle));
}

const insertPlaylistVideo = database.prepare(`
  INSERT OR IGNORE INTO user_playlist_videos (playlist_id, video_id, position)
  SELECT ?, ?, COALESCE(MAX(position), -1) + 1 FROM user_playlist_videos WHERE playlist_id = ?
`);

export async function applyPlaylistRulesToVideo(videoId: string, syncOffline = true): Promise<number> {
  const video = await database.prepare("SELECT video_id, title, description FROM videos WHERE video_id = ?").get(videoId) as VideoForRules | null;
  if (!video) return 0;
  const rules = await database.prepare("SELECT * FROM user_playlist_rules").all() as UserPlaylistRule[];
  let count = 0;
  const touchedPlaylists = new Set<number>();
  for (const rule of rules) {
    if (ruleMatches(rule, video.title, video.description)) {
      await insertPlaylistVideo.run(rule.playlist_id, video.video_id, rule.playlist_id);
      touchedPlaylists.add(rule.playlist_id);
      count++;
    }
  }
  for (const playlistId of syncOffline ? touchedPlaylists : []) {
    const playlist = await database.prepare("SELECT user_id FROM user_playlists WHERE id=?").get(playlistId) as { user_id: number } | null;
    if (playlist) await syncUserPlaylistOfflinePolicy(playlist.user_id, playlistId);
  }
  return count;
}

export async function applyPlaylistRulesToVideos(videoIds: string[]): Promise<void> {
  for (const videoId of videoIds) await applyPlaylistRulesToVideo(videoId, false);
  const playlists = await database.prepare("SELECT id, user_id FROM user_playlists WHERE offline_policy!='none'").all() as Array<{ id: number; user_id: number }>;
  for (const playlist of playlists) await syncUserPlaylistOfflinePolicy(playlist.user_id, playlist.id);
}

export async function applyPlaylistRuleToAllVideos(ruleId: number): Promise<number> {
  const rule = await database.prepare("SELECT rule.*, playlist.user_id FROM user_playlist_rules rule JOIN user_playlists playlist ON playlist.id=rule.playlist_id WHERE rule.id = ?").get(ruleId) as UserPlaylistRule | null;
  if (!rule) return 0;
  const videos = await database.prepare("SELECT video_id, title, description FROM videos").all() as VideoForRules[];
  let count = 0;
  for (const video of videos) {
    if (ruleMatches(rule, video.title, video.description)) {
      await insertPlaylistVideo.run(rule.playlist_id, video.video_id, rule.playlist_id);
      count++;
    }
  }
  if (rule.user_id != null) await syncUserPlaylistOfflinePolicy(rule.user_id, rule.playlist_id);
  return count;
}

export async function applyPlaylistRulesForPlaylist(playlistId: number): Promise<number> {
  const rules = await database.prepare("SELECT * FROM user_playlist_rules WHERE playlist_id = ?").all(playlistId) as UserPlaylistRule[];
  const videos = await database.prepare("SELECT video_id, title, description FROM videos").all() as VideoForRules[];
  let count = 0;
  for (const video of videos) {
    if (rules.some((rule) => ruleMatches(rule, video.title, video.description))) {
      await insertPlaylistVideo.run(playlistId, video.video_id, playlistId);
      count++;
    }
  }
  const playlist = await database.prepare("SELECT user_id FROM user_playlists WHERE id=?").get(playlistId) as { user_id: number } | null;
  if (playlist) await syncUserPlaylistOfflinePolicy(playlist.user_id, playlistId);
  return count;
}
