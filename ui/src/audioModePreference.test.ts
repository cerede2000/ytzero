import { afterEach, expect, test } from "bun:test";
import { profileAudioModeEnabled, rememberProfileAudioMode, resolveAudioMode, setProfileAudioMode } from "./audioModePreference";

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

test("keeps audio mode device-local and isolated between profiles", () => {
  installFakeStorage();
  rememberProfileAudioMode(7, true);
  expect(profileAudioModeEnabled(7)).toBe(true);
  expect(profileAudioModeEnabled(8)).toBe(false);

  rememberProfileAudioMode(7, false);
  expect(profileAudioModeEnabled(7)).toBe(false);
});

test("does not create an unscoped preference without a profile", () => {
  installFakeStorage();
  rememberProfileAudioMode(null, true);
  expect(profileAudioModeEnabled(null)).toBe(false);
  expect(values.size).toBe(0);
});

test("states the mode for whoever is signed in here, in both directions", () => {
  installFakeStorage();
  values.set("ytzero.activeProfileId", "4");

  setProfileAudioMode(true);
  expect(profileAudioModeEnabled(4)).toBe(true);
  expect(profileAudioModeEnabled(5)).toBe(false);

  // A page that starts a list in video says so as plainly as one that starts
  // it in audio: the remembered mode is what the watch page will read.
  setProfileAudioMode(false);
  expect(profileAudioModeEnabled(4)).toBe(false);
});

test("a stated mode is honoured by a browser that remembers no profile", () => {
  // Pressing "listen" writes the preference and states the mode to the page
  // being opened. On a browser that was never told which profile it is, the
  // write has nowhere to go — every read comes back false — so the stated mode
  // is the only thing left carrying the choice. Without it the list opens in
  // video and the button reads as broken, on that device alone.
  installFakeStorage();
  rememberProfileAudioMode(null, true);
  expect(profileAudioModeEnabled(null)).toBe(false);
  expect(resolveAudioMode(true, null)).toBe(true);
});

test("a stated mode of video is a statement too, not an absence", () => {
  installFakeStorage();
  rememberProfileAudioMode(4, true);
  expect(resolveAudioMode(false, 4)).toBe(false);
});

test("a page opened without a stated mode reads the preference", () => {
  installFakeStorage();
  rememberProfileAudioMode(4, true);
  expect(resolveAudioMode(undefined, 4)).toBe(true);
  expect(resolveAudioMode(undefined, 5)).toBe(false);
});
