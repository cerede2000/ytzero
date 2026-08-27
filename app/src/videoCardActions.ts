import {
  DEFAULT_VIDEO_CARD_ACTION_CONFIG,
  parseVideoCardActionConfig,
  type VideoCardActionConfig,
} from "../../shared/videoCardActions";

export {
  DEFAULT_VIDEO_CARD_ACTION_CONFIG,
  LOCKED_VIDEO_CARD_ACTION_IDS,
  parseVideoCardActionConfig,
  VIDEO_CARD_ACTION_IDS,
  type VideoCardActionConfig,
  type VideoCardActionId,
} from "../../shared/videoCardActions";

export const VIDEO_CARD_ACTION_MODES = ["hover", "always", "bar_always", "on_demand", "delay", "off"] as const;
export type VideoCardActionMode = (typeof VIDEO_CARD_ACTION_MODES)[number];
export const VIDEO_CARD_PREVIEW_MODES = ["off", "downloaded", "all"] as const;
export type VideoCardPreviewMode = (typeof VIDEO_CARD_PREVIEW_MODES)[number];

export function isVideoCardPreviewMode(value: unknown): value is VideoCardPreviewMode {
  return typeof value === "string" && (VIDEO_CARD_PREVIEW_MODES as readonly string[]).includes(value);
}

import { DEFAULT_HIDDEN_VIDEO_CARD_ACTION_IDS, LOCKED_VIDEO_CARD_ACTION_IDS, VIDEO_CARD_ACTION_IDS, type VideoCardActionId } from "../../shared/videoCardActions";

export function isVideoCardActionMode(value: unknown): value is VideoCardActionMode {
  return typeof value === "string" && (VIDEO_CARD_ACTION_MODES as readonly string[]).includes(value);
}

export function normalizeVideoCardActionMode(value: unknown): VideoCardActionMode {
  return isVideoCardActionMode(value) ? value : "hover";
}

export function normalizeVideoCardActionConfig(value: unknown): string {
  return JSON.stringify(parseVideoCardActionConfig(value) ?? DEFAULT_VIDEO_CARD_ACTION_CONFIG);
}

export const VIDEO_CARD_SWIPE_DEVICES = ["desktop", "tablet", "mobile"] as const;
export type VideoCardSwipeDevice = (typeof VIDEO_CARD_SWIPE_DEVICES)[number];
export type VideoCardSwipeConfig = { version: 1; devices: VideoCardSwipeDevice[] };
export const DEFAULT_VIDEO_CARD_SWIPE_CONFIG: VideoCardSwipeConfig = { version: 1, devices: [...VIDEO_CARD_SWIPE_DEVICES] };

export function parseVideoCardSwipeConfig(value: unknown): VideoCardSwipeConfig | null {
  if (typeof value === "string") {
    try { return parseVideoCardSwipeConfig(JSON.parse(value)); } catch { return null; }
  }
  if (!value || typeof value !== "object") return null;
  const config = value as { version?: unknown; devices?: unknown };
  if (config.version !== 1 || !Array.isArray(config.devices)) return null;
  const devices = config.devices;
  if (devices.some((device) => typeof device !== "string" || !(VIDEO_CARD_SWIPE_DEVICES as readonly string[]).includes(device))) return null;
  if (new Set(devices).size !== devices.length) return null;
  return { version: 1, devices: VIDEO_CARD_SWIPE_DEVICES.filter((device) => devices.includes(device)) };
}

export function normalizeVideoCardSwipeConfig(value: unknown): string {
  return JSON.stringify(parseVideoCardSwipeConfig(value) ?? DEFAULT_VIDEO_CARD_SWIPE_CONFIG);
}

export function validateVideoCardSettings(body: Record<string, unknown>): string | null {
  if ("video_card_actions" in body && !isVideoCardActionMode(body.video_card_actions)) return "invalid video card action mode";
  if ("video_card_preview" in body && !isVideoCardPreviewMode(body.video_card_preview)) return "invalid video card preview mode";
  if ("video_card_action_buttons" in body && !parseVideoCardActionConfig(body.video_card_action_buttons)) return "invalid video card action buttons";
  if ("video_card_swipe_devices" in body && !parseVideoCardSwipeConfig(body.video_card_swipe_devices)) return "invalid video card swipe devices";
  return null;
}

export function normalizeVideoCardSetting(key: string, value: unknown): string {
  if (key === "video_card_actions") return normalizeVideoCardActionMode(value);
  if (key === "video_card_preview") return isVideoCardPreviewMode(value) ? value : "all";
  if (key === "video_card_action_buttons") return normalizeVideoCardActionConfig(value);
  if (key === "video_card_swipe_devices") return normalizeVideoCardSwipeConfig(value);
  return String(value);
}
