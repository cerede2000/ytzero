/** What the Dailymotion experiment passes between its own two pages. */
export interface DailymotionVideo {
  videoId: string;
  title: string;
  channelTitle: string;
  thumbnail: string;
  durationSeconds: number | null;
  publishedAt: string | null;
  views: number | null;
}

export interface DailymotionChannel {
  channelId: string;
  name: string;
  avatar: string;
  videos: number | null;
  followers: number | null;
}

export interface DailymotionSearch {
  videos: DailymotionVideo[];
  channels: DailymotionChannel[];
  live: DailymotionVideo[];
}

export function dailymotionClock(seconds: number | null): string {
  if (seconds == null) return "";
  const whole = Math.round(seconds);
  const parts = [Math.floor(whole / 3600), Math.floor(whole / 60) % 60, whole % 60];
  return (parts[0] > 0 ? parts : parts.slice(1))
    .map((part, index) => index === 0 ? String(part) : String(part).padStart(2, "0"))
    .join(":");
}

export function dailymotionCount(value: number | null, one: string, many = `${one}s`): string {
  if (value == null) return "";
  const rounded = value >= 1_000_000 ? `${(value / 1_000_000).toFixed(1)} M`
    : value >= 1_000 ? `${Math.round(value / 1_000)} k`
    : String(value);
  return `${rounded} ${value > 1 ? many : one}`;
}
