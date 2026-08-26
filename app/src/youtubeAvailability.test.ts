import { describe, expect, test } from "bun:test";
import {
  DeletedVideoError,
  classifyIsShort,
  fetchVideoOEmbedAvailability,
  fetchVideoOEmbed,
  isDeletedVideoError,
  isPrivateVideoError,
  PrivateVideoError,
  videoOEmbedAvailabilityFromStatus,
} from "./youtube";

describe("private video errors", () => {
  test("recognizes typed and YouTube player errors", () => {
    expect(isPrivateVideoError(new PrivateVideoError())).toBe(true);
    expect(isPrivateVideoError(new Error("videoDetails missing (LOGIN_REQUIRED: Private video)"))).toBe(true);
  });

  test("does not classify unrelated login errors as private", () => {
    expect(isPrivateVideoError(new Error("LOGIN_REQUIRED: Sign in to confirm you're not a bot"))).toBe(false);
  });
});

describe("deleted video errors", () => {
  test("recognizes typed and YouTube player deletion messages", () => {
    expect(isDeletedVideoError(new DeletedVideoError())).toBe(true);
    expect(isDeletedVideoError(new Error("videoDetails missing (ERROR: Video unavailable)"))).toBe(true);
    expect(isDeletedVideoError(new Error("This video has been removed by the uploader"))).toBe(true);
  });

  test("recognizes localized deletion messages (fr/de/pl)", () => {
    expect(isDeletedVideoError(new Error("Vidéo non disponible"))).toBe(true);
    expect(isDeletedVideoError(new Error("Video nicht verfügbar"))).toBe(true);
    expect(isDeletedVideoError(new Error("Film niedostępny"))).toBe(true);
    expect(isDeletedVideoError(new Error("videoDetails missing (ERROR: Vidéo non disponible)"))).toBe(true);
  });

  test("does not classify transient or authentication failures as deletions", () => {
    expect(isDeletedVideoError(new Error("YouTube fetch failed (503)"))).toBe(false);
    expect(isDeletedVideoError(new Error("Sign in to confirm you're not a bot"))).toBe(false);
  });
});

describe("oEmbed availability", () => {
  test("treats only authoritative statuses as available or unavailable", () => {
    expect(videoOEmbedAvailabilityFromStatus(200)).toBe("available");
    expect(videoOEmbedAvailabilityFromStatus(401)).toBe("unavailable");
    expect(videoOEmbedAvailabilityFromStatus(403)).toBe("unavailable");
    expect(videoOEmbedAvailabilityFromStatus(404)).toBe("unavailable");
    expect(videoOEmbedAvailabilityFromStatus(429)).toBe("unknown");
    expect(videoOEmbedAvailabilityFromStatus(503)).toBe("unknown");
  });

  test("does not classify a deleted video's 200 Shorts route as a Short", async () => {
    const statuses = [200, 404];
    const fetchImpl = (async () => new Response(null, { status: statuses.shift() })) as unknown as typeof fetch;
    expect(await classifyIsShort("deleted", "Ordinary title", fetchImpl)).toBeNull();
    expect(statuses).toEqual([]);
  });
});

describe("the title oEmbed answers with", () => {
  const answering = (body: unknown, status = 200) =>
    (async () => new Response(status === 200 ? JSON.stringify(body) : null, { status })) as unknown as typeof fetch;

  test("is the uploader's own, not a translation", async () => {
    // Asked with Accept-Language: en-US, oEmbed still answers in the language
    // the video was uploaded in. Measured on three French videos whose watch
    // pages, asked the same way, answered in English.
    const answer = await fetchVideoOEmbed("WjXDkL1FERs", answering({
      title: "Donnez-moi 15 minutes. Vous ne verrez plus l'argent pareil.",
    }));
    expect(answer).toEqual({
      availability: "available",
      title: "Donnez-moi 15 minutes. Vous ne verrez plus l'argent pareil.",
    });
  });

  test("is nothing at all when the video is gone", async () => {
    expect(await fetchVideoOEmbed("deleted", answering(null, 404)))
      .toEqual({ availability: "unavailable", title: null });
  });

  test("is nothing rather than an empty string", async () => {
    // A blank title would overwrite a good one with nothing.
    expect((await fetchVideoOEmbed("blank", answering({ title: "   " }))).title).toBe(null);
    expect((await fetchVideoOEmbed("absent", answering({}))).title).toBe(null);
    expect((await fetchVideoOEmbed("wrong", answering({ title: 42 }))).title).toBe(null);
  });

  test("does not cost the verdict when the body cannot be read", async () => {
    const broken = (async () => new Response("not json", { status: 200 })) as unknown as typeof fetch;
    expect(await fetchVideoOEmbed("video", broken)).toEqual({ availability: "available", title: null });
  });

  test("still refuses to answer through a rate limit", async () => {
    expect(fetchVideoOEmbed("video", answering(null, 429))).rejects.toThrow("429");
  });
});

describe("a private video, whatever language the page answered in", () => {
  /*
   * The failure this prevents: unrecognised, a private video is not filed as
   * private — it is returned as a failure to read a video, which is what the
   * refusal quiet counts. Three of those and the instance stops looking up any
   * video at all, so every video a reader opens reports that YouTube did not
   * answer while nothing at all is wrong with the library.
   */
  test("is recognised in the four languages the pages are asked for", () => {
    expect(isPrivateVideoError(new Error("Private video"))).toBe(true);
    expect(isPrivateVideoError(new Error("Vidéo privée"))).toBe(true);
    expect(isPrivateVideoError(new Error("Privates Video"))).toBe(true);
    expect(isPrivateVideoError(new Error("Film prywatny"))).toBe(true);
  });

  // Exactly as it arrives from the watch page, which is where this failed.
  test("is recognised inside the sentence the player response builds", () => {
    expect(isPrivateVideoError(new Error("videoDetails missing (LOGIN_REQUIRED: Vidéo privée)"))).toBe(true);
    expect(isPrivateVideoError(new Error(
      "video info failed: html=videoDetails missing (LOGIN_REQUIRED: Vidéo privée); innertube=HTTP error! status: 400",
    ))).toBe(true);
  });

  test("is not read into a video that is merely gone", () => {
    expect(isPrivateVideoError(new Error("Vidéo non disponible"))).toBe(false);
    expect(isPrivateVideoError(new Error("Sign in to confirm you're not a bot"))).toBe(false);
  });
});
