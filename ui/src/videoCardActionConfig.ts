import { useSyncExternalStore } from "react";
import {
  DEFAULT_VIDEO_CARD_ACTION_CONFIG,
  parseVideoCardActionConfig as parseSharedVideoCardActionConfig,
  type VideoCardActionConfig,
} from "../../shared/videoCardActions";
import { emit, subscribe } from "./events";

export {
  DEFAULT_VIDEO_CARD_ACTION_CONFIG,
  LOCKED_VIDEO_CARD_ACTION_IDS,
  PINNED_VIDEO_CARD_ACTION_IDS,
  VIDEO_CARD_ACTION_IDS,
  type VideoCardActionConfig,
  type VideoCardActionId,
} from "../../shared/videoCardActions";

const defaultConfig = () => structuredClone(DEFAULT_VIDEO_CARD_ACTION_CONFIG);

export function parseVideoCardActionConfig(value: unknown): VideoCardActionConfig {
  return parseSharedVideoCardActionConfig(value) ?? defaultConfig();
}

export function serializeVideoCardActionConfig(value: unknown): string { return JSON.stringify(parseVideoCardActionConfig(value)); }
const CHANGE_EVENT = "card-actions";
export function applyVideoCardActionConfig(value: unknown) {
  const serialized = serializeVideoCardActionConfig(value);
  if (document.documentElement.dataset.videoCardActionButtons === serialized) return;
  document.documentElement.dataset.videoCardActionButtons = serialized;
  emit(CHANGE_EVENT);
}
function readValue(): string { return document.documentElement.dataset.videoCardActionButtons ?? serializeVideoCardActionConfig(null); }
export function useAppliedVideoCardActionConfig(): VideoCardActionConfig {
  const value = useSyncExternalStore(
    (notify) => subscribe(CHANGE_EVENT, notify),
    readValue,
    () => serializeVideoCardActionConfig(null),
  );
  return parseVideoCardActionConfig(value);
}
