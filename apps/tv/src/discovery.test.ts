import { describe, expect, test } from "bun:test";
import { discoveryCandidates, verifyDiscoveredInstance, type ResolvedInstance } from "./discovery";
import { discoveryMessages } from "./discoveryMessages";

const service: ResolvedInstance = { id: "server._ytzero._tcp.local.", name: "YT Zero", host: "server.local.", port: 3001, addresses: ["192.168.1.9", "192.168.1.9", "fe80::1%en0", "::1"], txt: { version: "1", scheme: "http" } };

describe("TV Bonjour discovery", () => {
  test("resolves DNS-SD names, deduplicates addresses, supports IPv6 and proxy HTTPS", () => {
    expect(discoveryCandidates(service)).toEqual(["http://server.local:3001", "http://192.168.1.9:3001"]);
    expect(discoveryCandidates({ ...service, host: "fd12::1", addresses: [] })).toEqual(["http://[fd12::1]:3001"]);
    expect(discoveryCandidates({ ...service, txt: { version: "1", url: "https://video.example.com:8443" } })).toEqual(["https://video.example.com:8443"]);
  });
  test("rejects unsupported, malformed and credential-bearing advertisements", () => {
    const records: Record<string, string>[] = [{ version: "2" }, { version: "1", scheme: "file" }, { version: "1", url: "https://user:secret@server.local" }, { version: "1", url: "http://server.local/?token=secret" }, { version: "1", url: "http://server.local/api" }];
    for (const txt of records) {
      expect(discoveryCandidates({ ...service, txt })).toEqual([]);
    }
    expect(discoveryCandidates({ ...service, port: 0 })).toEqual([]);
    expect(discoveryCandidates({ ...service, host: "evil.local/path", addresses: [] })).toEqual([]);
  });
  test("shows only healthy YT Zero instances, tries alternate interfaces and never sends authentication", async () => {
    const originalFetch = globalThis.fetch;
    const urls: string[] = [];
    globalThis.fetch = (async (url: string, options: RequestInit) => {
      urls.push(url);
      expect(options.headers).toBeUndefined();
      expect(options.credentials).toBe("omit");
      expect(options.redirect).toBe("error");
      return new Response(JSON.stringify(url.includes("192.168") ? { status: "ok", app: "ytzero" } : { status: "ok", app: "another-app" }));
    }) as unknown as typeof fetch;
    try {
      expect(await verifyDiscoveredInstance(service, new AbortController().signal)).toEqual({ id: service.id, name: "YT Zero", url: "http://192.168.1.9:3001" });
      expect(urls).toHaveLength(2);
      const controller = new AbortController();
      controller.abort();
      expect(await verifyDiscoveredInstance(service, controller.signal)).toBeNull();
    } finally { globalThis.fetch = originalFetch; }
  });
  test("every supported language includes discovery and native permission copy", async () => {
    const { LANGUAGE_CODES } = await import("../../../shared/uiLanguages");
    for (const language of LANGUAGE_CODES) {
      const messages = discoveryMessages[language];
      expect(Object.keys(messages).sort()).toEqual(Object.keys(discoveryMessages.en).sort());
      for (const message of Object.values(messages)) expect(message.trim().length).toBeGreaterThan(0);
      const permission = await Bun.file(new URL(`../locales/${language}.json`, import.meta.url)).json();
      // Expo hands a key written at the root of a locale file to both platforms.
      // This one is an Info.plist key: on Android it becomes a string resource no
      // default locale declares, and `lintVitalRelease` refuses to assemble the
      // package over it. Keeping it under `ios` is what lets the television
      // application be built for Android TV at all.
      expect(Object.keys(permission)).toEqual(["ios"]);
      expect(permission.ios.NSLocalNetworkUsageDescription.length).toBeGreaterThan(20);
    }
  });
});
