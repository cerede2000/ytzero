import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

/*
 * The image declares where the PO-token plugin and its script live, and the
 * server hands those paths to yt-dlp. Nothing at runtime notices a declaration
 * the build never honoured until yt-dlp is run: a plugin directory that does
 * not exist stops it with "Invalid plugin directory" before it fetches
 * anything, so every first attempt fails and only the retry plays.
 *
 * That is what an image did for three weeks after two installs of the same
 * provider were merged and the declared one lost its `mkdir` — in both
 * Dockerfiles. Read here, in the files that make the promise, rather than
 * discovered on a server.
 */
for (const name of ["Dockerfile", "Dockerfile.railway"]) {
  const dockerfile = readFileSync(new URL(`../../${name}`, import.meta.url), "utf8");

  const declared = (variable: string): string => {
    const match = new RegExp(`\\b${variable}=(\\S+)`).exec(dockerfile);
    if (!match) throw new Error(`${variable} is not declared in ${name}`);
    return match[1];
  };

  describe(`${name}: the PO-token provider`, () => {
    test("puts the plugin in the directory it declares", () => {
      const pluginDir = declared("YTDLP_BGUTIL_PLUGIN_DIR");
      expect(dockerfile).toContain(`-o ${pluginDir}/bgutil-ytdlp-pot-provider.zip`);
    });

    test("installs the script where it declares its home", () => {
      const serverHome = declared("YTDLP_BGUTIL_SERVER_HOME");
      expect(dockerfile).toContain(`cd ${serverHome} && deno install`);
    });

    test("keeps one install, not a second one somewhere else", () => {
      // Two copies of the same provider is how the declared one went missing
      // without anybody noticing: the other kept tokens flowing on half the calls.
      expect(dockerfile).not.toContain("/etc/yt-dlp/plugins");
      expect(dockerfile).not.toMatch(/\bPOT_PROVIDER_HOME=/);
    });
  });
}
