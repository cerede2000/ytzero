import { describe, expect, test } from "bun:test";
import { potProviderArgs } from "./ytdlpPotProvider";

const noFiles = () => false;
const allFiles = () => true;

describe("PO token provider arguments", () => {
  test("says nothing when no provider is present", () => {
    expect(potProviderArgs({ home: "/opt/provider", url: "", exists: noFiles })).toEqual([]);
  });

  test("names the script provider once its entry point is on disk", () => {
    const seen: string[] = [];
    const args = potProviderArgs({
      home: "/opt/provider",
      url: "",
      exists: (path) => { seen.push(path); return true; },
    });
    expect(seen).toEqual(["/opt/provider/src/generate_once.ts"]);
    expect(args).toEqual(["--extractor-args", "youtubepot-bgutilscript:server_home=/opt/provider"]);
  });

  test("points at a companion service when one is configured", () => {
    expect(potProviderArgs({ home: "", url: "http://bgutil:4416", exists: noFiles }))
      .toEqual(["--extractor-args", "youtubepot-bgutilhttp:base_url=http://bgutil:4416"]);
  });

  test("offers both when both are available", () => {
    expect(potProviderArgs({ home: "/opt/provider", url: "http://bgutil:4416", exists: allFiles })).toEqual([
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
      url: "",
      exists: allFiles,
      real: (path) => path.replace("/root", "/opt"),
    });
    expect(args).toEqual(["--extractor-args", "youtubepot-bgutilscript:server_home=/opt/provider"]);
  });

  test("lets an operator turn the bundled script off", () => {
    // The image always carries the script; an operator who prefers the
    // companion service should not have both consulted on every call.
    expect(potProviderArgs({ home: "off", url: "", exists: allFiles })).toEqual([]);
    expect(potProviderArgs({ home: "  ", url: "", exists: allFiles })).toEqual([]);
  });

  test("ignores blank configuration rather than passing an empty URL", () => {
    expect(potProviderArgs({ home: "/opt/provider", url: "   ", exists: noFiles })).toEqual([]);
  });
});
