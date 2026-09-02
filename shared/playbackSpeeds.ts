export const DEFAULT_PLAYBACK_SPEEDS = ["0.25", "0.5", "0.75", "1", "1.25", "1.5", "1.75", "2"] as const;
export const MIN_PLAYBACK_SPEED = 0.25;
export const MAX_PLAYBACK_SPEED = 4;
export const MAX_CUSTOM_PLAYBACK_SPEEDS = 16;

const DEFAULT_SPEED_SET = new Set<string>(DEFAULT_PLAYBACK_SPEEDS);

/** Canonical storage/display form for a supported playback rate. */
export function normalizePlaybackSpeed(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const text = String(value).trim().replace(",", ".");
  if (!text) return null;
  const parsed = Number(text);
  if (!Number.isFinite(parsed) || parsed < MIN_PLAYBACK_SPEED || parsed > MAX_PLAYBACK_SPEED) return null;
  const rounded = Math.round(parsed * 100) / 100;
  if (Math.abs(parsed - rounded) > Number.EPSILON * Math.max(1, Math.abs(parsed))) return null;
  return String(rounded);
}

function normalizeCustomArray(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > MAX_CUSTOM_PLAYBACK_SPEEDS) return null;
  const normalized: string[] = [];
  for (const item of value) {
    const speed = normalizePlaybackSpeed(item);
    if (!speed) return null;
    if (!DEFAULT_SPEED_SET.has(speed) && !normalized.includes(speed)) normalized.push(speed);
  }
  return normalized.sort((left, right) => Number(left) - Number(right));
}

/** Strictly validates and canonicalizes the JSON stored in user settings. */
export function normalizePlaybackSpeedOptionsSetting(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const normalized = normalizeCustomArray(JSON.parse(value));
    return normalized ? JSON.stringify(normalized) : null;
  } catch {
    return null;
  }
}

/** Tolerant reader for client rendering and older/corrupt stored settings. */
export function parseCustomPlaybackSpeeds(value: unknown): string[] {
  if (typeof value !== "string") return [];
  try {
    return normalizeCustomArray(JSON.parse(value)) ?? [];
  } catch {
    return [];
  }
}

export function serializeCustomPlaybackSpeeds(speeds: readonly string[]): string {
  return JSON.stringify(normalizeCustomArray([...speeds]) ?? []);
}

/** Built-in options plus profile-defined values and any persisted current value. */
export function resolvePlaybackSpeeds(setting: unknown, ...currentValues: unknown[]): string[] {
  const speeds = new Set<string>([...DEFAULT_PLAYBACK_SPEEDS, ...parseCustomPlaybackSpeeds(setting)]);
  for (const value of currentValues) {
    const normalized = normalizePlaybackSpeed(value);
    if (normalized) speeds.add(normalized);
  }
  return [...speeds].sort((left, right) => Number(left) - Number(right));
}
