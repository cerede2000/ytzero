import { afterEach, expect, test } from "bun:test";
import { profileAudioModeEnabled } from "./audioModePreference";
import { forgetRememberedProfile, rememberProfile } from "./profilePreference";
import { otherPlaybackModeIsAudioOnly, playVideoInOtherPlaybackMode } from "./videoCardPlaybackMode";

const values = new Map<string, string>();
const originalStorage = globalThis.localStorage;
const fakeStorage = {
  getItem: (key: string) => values.get(key) ?? null,
  setItem: (key: string, value: string) => { values.set(key, value); },
  removeItem: (key: string) => { values.delete(key); },
};

function installFakeStorage() {
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: fakeStorage });
}

afterEach(() => {
  values.clear();
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: originalStorage });
});

test("persists the opposite playback mode before opening the card", () => {
  installFakeStorage();
  rememberProfile(7);
  const observed: boolean[] = [];

  expect(otherPlaybackModeIsAudioOnly()).toBe(true);
  playVideoInOtherPlaybackMode("first", () => observed.push(profileAudioModeEnabled(7)));
  expect(otherPlaybackModeIsAudioOnly()).toBe(false);
  playVideoInOtherPlaybackMode("second", () => observed.push(profileAudioModeEnabled(7)));

  expect(observed).toEqual([true, false]);
  forgetRememberedProfile();
});

test("does not create an unscoped playback preference", () => {
  installFakeStorage();
  playVideoInOtherPlaybackMode("video", () => {});
  expect(values.size).toBe(0);
});
