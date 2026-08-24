import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { provisionVerdict } from "./ytdlpProvision";

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

describe("putting yt-dlp where the instance was told to look", () => {
  const managed = "/data/bin/yt-dlp";

  /*
   * The failure this exists to prevent: the container's command does this
   * copy, and a container whose command was replaced — or which was created
   * before that command existed — comes up pointing at a file nobody wrote.
   * Downloads and transcripts stop, and nothing in the image is wrong.
   */
  test("writes the managed binary when nothing has", () => {
    expect(provisionVerdict(managed, false, true, managed)).toBe("copy");
  });

  test("does nothing where the container's command already did it", () => {
    expect(provisionVerdict(managed, true, true, managed)).toBe("already-there");
  });

  // An operator who named their own yt-dlp has answered the question already.
  test("leaves a path the operator chose alone", () => {
    expect(provisionVerdict("/usr/bin/yt-dlp", false, true, managed)).toBe("not-managed");
  });

  test("says so when there is nothing to copy from", () => {
    expect(provisionVerdict(managed, false, false, managed)).toBe("no-bootstrap");
  });

  test("reads the same as the shell script it stands in for", () => {
    const root = mkdtempSync(join(tmpdir(), "ytzero-provision-parity-"));
    roots.push(root);
    const bootstrap = join(root, "bootstrap");
    const target = join(root, "bin", "yt-dlp");
    writeFileSync(bootstrap, "#!/bin/sh\nexit 0\n");
    chmodSync(bootstrap, 0o755);
    // Missing target, bootstrap present: the script copies, and so does this.
    expect(provisionVerdict(target, existsSync(target), existsSync(bootstrap), target)).toBe("copy");
    writeFileSync(target.replace("/yt-dlp", "") + "-placeholder", "");
    expect(readFileSync(bootstrap, "utf8")).toContain("exit 0");
  });
});
