import { describe, expect, test } from "bun:test";
import { potArgsFor, potProviderArgs } from "./ytdlpPotProvider";

const noFiles = () => false;
const allFiles = () => true;
const pluginDir = "/opt/plugins";

describe("PO token provider arguments", () => {
  test("says nothing when no provider is present", () => {
    expect(potProviderArgs({ home: "/opt/provider", pluginDir, url: "", exists: noFiles })).toEqual([]);
  });

  test("names the script provider once its entry point is on disk", () => {
    const seen: string[] = [];
    const args = potProviderArgs({
      home: "/opt/provider",
      pluginDir,
      url: "",
      exists: (path) => { seen.push(path); return true; },
    });
    expect(seen).toContain("/opt/provider/src/generate_once.ts");
    expect(args).toEqual([
      "--plugin-dirs", pluginDir,
      "--extractor-args", "youtubepot-bgutilscript:server_home=/opt/provider",
    ]);
  });

  test("points at a companion service when one is configured", () => {
    expect(potProviderArgs({ home: "", pluginDir, url: "http://bgutil:4416", exists: noFiles }))
      .toEqual(["--extractor-args", "youtubepot-bgutilhttp:base_url=http://bgutil:4416"]);
  });

  test("offers both when both are available", () => {
    expect(potProviderArgs({ home: "/opt/provider", pluginDir, url: "http://bgutil:4416", exists: allFiles })).toEqual([
      "--plugin-dirs", pluginDir,
      "--extractor-args", "youtubepot-bgutilhttp:base_url=http://bgutil:4416",
      "--extractor-args", "youtubepot-bgutilscript:server_home=/opt/provider",
    ]);
  });

  test("names the real directory, not a link to it", () => {
    // The script runs under a runtime that grants file access per path and
    // compares the path it resolves against the path it was granted: handed a
    // link, it dies reading its own dependencies.
    const args = potProviderArgs({
      home: "/root/provider",
      pluginDir,
      url: "",
      exists: allFiles,
      real: (path) => path.replace("/root", "/opt"),
    });
    expect(args).toContain("youtubepot-bgutilscript:server_home=/opt/provider");
  });

  test("lets an operator turn the bundled script off", () => {
    // The image always carries the script; an operator who prefers the
    // companion service should not have both consulted on every call.
    expect(potProviderArgs({ home: "off", pluginDir, url: "", exists: allFiles })).toEqual([]);
    expect(potProviderArgs({ home: "  ", pluginDir, url: "", exists: allFiles })).toEqual([]);
  });

  test("ignores blank configuration rather than passing an empty URL", () => {
    expect(potProviderArgs({ home: "/opt/provider", pluginDir, url: "   ", exists: noFiles })).toEqual([]);
  });
});

describe("where yt-dlp finds the plugin", () => {
  test("names the directory the plugin is installed in", () => {
    // yt-dlp only searches its default directories on its own, and the image
    // installs the plugin outside them. Named on the anonymous attempts only,
    // an attempt carrying cookies ran with no provider at all — measured:
    // "PO Token Providers: none" with the server home given but not the plugin.
    expect(potProviderArgs({ home: "/opt/provider", pluginDir, url: "http://bgutil:4416", exists: allFiles }))
      .toEqual(expect.arrayContaining(["--plugin-dirs", pluginDir]));
  });

  test("never names a plugin directory that is not on disk", () => {
    // A missing one is not skipped by yt-dlp: it stops with "Invalid plugin
    // directory", before it has fetched anything. That was every first
    // attempt of a server whose image named a directory it never created.
    const args = potProviderArgs({
      home: "/opt/provider",
      pluginDir,
      url: "",
      exists: (path) => path !== pluginDir,
    });
    expect(args).not.toContain("--plugin-dirs");
    expect(args).toEqual(["--extractor-args", "youtubepot-bgutilscript:server_home=/opt/provider"]);
  });

  test("follows the directories the image declares", () => {
    const args = potProviderArgs({
      env: { YTDLP_BGUTIL_PLUGIN_DIR: "/srv/plugins", YTDLP_BGUTIL_SERVER_HOME: "/srv/bgutil/server" },
      url: "",
      exists: allFiles,
      real: (path) => path,
    });
    expect(args).toEqual([
      "--plugin-dirs", "/srv/plugins",
      "--extractor-args", "youtubepot-bgutilscript:server_home=/srv/bgutil/server",
    ]);
  });
});

describe("who needs a token", () => {
  test("every attempt carries one, cookies or not", () => {
    // It once went without when cookies were present: 4.5 s with cookies
    // alone against 6.0 s with a token as well, for the same answer. Then
    // YouTube began challenging the player API of a signed-in caller too — the
    // same jar that loads a watch page perfectly gets "Sign in to confirm
    // you're not a bot" from yt-dlp — and the one thing that might answer was
    // being withheld precisely because an account was present.
    expect(potArgsFor(true)).toEqual(potArgsFor(false));
  });
});
