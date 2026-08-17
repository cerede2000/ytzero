import { describe, expect, test } from "bun:test";
import { hasLiveBadge, hasMembersOnlyBadge, parsePublishedTimeText, parseVideoCreatorsFromInitialData, relativePublishedAt } from "./youtube";

describe("YouTube publication metadata", () => {
  test("parses relative publication labels returned by supported locales", () => {
    expect(parsePublishedTimeText("Streamed 3 weeks ago")).toEqual({ value: 3, unit: "week" });
    expect(parsePublishedTimeText("5 dni temu")).toEqual({ value: 5, unit: "day" });
    expect(parsePublishedTimeText("1 dzień temu")).toEqual({ value: 1, unit: "day" });
    expect(parsePublishedTimeText("vor 2 Monaten")).toEqual({ value: 2, unit: "month" });
    expect(parsePublishedTimeText("vor 1 Monat")).toEqual({ value: 1, unit: "month" });
  });

  test("parses French relative publication labels", () => {
    expect(parsePublishedTimeText("il y a 3 jours")).toEqual({ value: 3, unit: "day" });
    expect(parsePublishedTimeText("il y a 1 jour")).toEqual({ value: 1, unit: "day" });
    expect(parsePublishedTimeText("il y a 2 semaines")).toEqual({ value: 2, unit: "week" });
    expect(parsePublishedTimeText("il y a 1 mois")).toEqual({ value: 1, unit: "month" });
    expect(parsePublishedTimeText("il y a 3 mois")).toEqual({ value: 3, unit: "month" });
    expect(parsePublishedTimeText("il y a 1 an")).toEqual({ value: 1, unit: "year" });
    expect(parsePublishedTimeText("il y a 2 ans")).toEqual({ value: 2, unit: "year" });
    expect(parsePublishedTimeText("il y a 5 heures")).toEqual({ value: 5, unit: "hour" });
  });

  test("turns a relative label into an approximate historical date", () => {
    expect(relativePublishedAt({ value: 3, unit: "week" }, new Date("2026-07-22T12:00:00.000Z")))
      .toBe("2026-07-01T12:00:00.000Z");
    expect(relativePublishedAt({ value: 1, unit: "year" }, new Date("2026-07-22T12:00:00.000Z")))
      .toBe("2025-07-22T12:00:00.000Z");
  });

  test("recognizes current and legacy members-only badges", () => {
    expect(hasMembersOnlyBadge({ badgeViewModel: { badgeStyle: "BADGE_MEMBERS_ONLY" } })).toBe(true);
    expect(hasMembersOnlyBadge({ metadataBadgeRenderer: { style: "BADGE_STYLE_TYPE_MEMBERS_ONLY" } })).toBe(true);
    expect(hasMembersOnlyBadge({ thumbnailBadgeViewModel: { text: "21:00" } })).toBe(false);
  });

  test("recognizes current and legacy live badges", () => {
    expect(hasLiveBadge({ thumbnailBadgeViewModel: { badgeStyle: "THUMBNAIL_OVERLAY_BADGE_STYLE_LIVE" } })).toBe(true);
    expect(hasLiveBadge({ thumbnailBadgeViewModel: { icon: { sources: [{ clientResource: { imageName: "LIVE" } }] } } })).toBe(true);
    expect(hasLiveBadge({ metadataBadgeRenderer: { style: "BADGE_STYLE_TYPE_LIVE_NOW" } })).toBe(true);
    expect(hasLiveBadge({ thumbnailOverlayTimeStatusRenderer: { style: "LIVE" } })).toBe(true);
    expect(hasLiveBadge({ thumbnailBadgeViewModel: { text: "21:00" } })).toBe(false);
  });

  test("parses an arbitrary number of native video collaborators", () => {
    const creator = (channelId: string, title: string) => ({
      listItemViewModel: {
        title: { content: title, commandRuns: [{ onTap: { innertubeCommand: { browseEndpoint: { browseId: channelId } } } }] },
        subtitle: { content: `@${title.toLowerCase()} • 10 subscribers` },
        leadingAccessory: { avatarViewModel: { image: { sources: [{ url: `${channelId}.jpg` }] } } },
      },
    });
    const data = {
      videoAttributionViewModel: {
        attributedTitle: {
          content: "Owner, Guest and Third",
        },
        onTap: { innertubeCommand: { showDialogCommand: { panelLoadingStrategy: { inlineContent: { dialogViewModel: {
          customContent: { listViewModel: { listItems: [
            creator("UCOWNER0000000000000000", "Owner"),
            creator("UCGUEST0000000000000000", "Guest"),
            creator("UCTHIRD0000000000000000", "Third"),
          ] } },
        } } } } } },
      },
    };

    expect(parseVideoCreatorsFromInitialData(data, "UCOWNER0000000000000000")).toEqual([
      { channelId: "UCOWNER0000000000000000", title: "Owner", avatar: "UCOWNER0000000000000000.jpg", handle: "@owner", isOwner: true },
      { channelId: "UCGUEST0000000000000000", title: "Guest", avatar: "UCGUEST0000000000000000.jpg", handle: "@guest", isOwner: false },
      { channelId: "UCTHIRD0000000000000000", title: "Third", avatar: "UCTHIRD0000000000000000.jpg", handle: "@third", isOwner: false },
    ]);
  });

  test("does not mistake ordinary dialogs for collaborator attribution", () => {
    const data = {
      showDialogViewModel: {
        customContent: { listViewModel: { listItems: [{
          listItemViewModel: { title: { content: "Settings" } },
        }] } },
      },
    };

    expect(parseVideoCreatorsFromInitialData(data, "UCOWNER0000000000000000")).toEqual([]);
  });

  test("ignores a channel list that does not contain the video's owner", () => {
    const creator = (channelId: string, title: string) => ({
      listItemViewModel: {
        title: { content: title, commandRuns: [{ onTap: { innertubeCommand: { browseEndpoint: { browseId: channelId } } } }] },
      },
    });
    const data = {
      dialogViewModel: {
        customContent: { listViewModel: { listItems: [
          creator("UCOTHER0000000000000000", "Other"),
          creator("UCANOTHER00000000000000", "Another"),
        ] } },
      },
    };

    expect(parseVideoCreatorsFromInitialData(data, "UCOWNER0000000000000000")).toEqual([]);
  });
});

describe("reading an age off a page fetched in the reader's language", () => {
  test("French, which the pinned English request meant nobody ever wrote", () => {
    // The request used to be pinned to English precisely because these regexes
    // knew three languages out of four. Pinning it is what stored an English
    // title for a French video, in a row the whole household shares.
    expect(parsePublishedTimeText("il y a 11 jours")).toEqual({ value: 11, unit: "day" });
    expect(parsePublishedTimeText("il y a 15 heures")).toEqual({ value: 15, unit: "hour" });
    expect(parsePublishedTimeText("il y a 2 semaines")).toEqual({ value: 2, unit: "week" });
    expect(parsePublishedTimeText("il y a 1 mois")).toEqual({ value: 1, unit: "month" });
    expect(parsePublishedTimeText("il y a 1 an")).toEqual({ value: 1, unit: "year" });
    expect(parsePublishedTimeText("il y a 35 minutes")).toEqual({ value: 35, unit: "minute" });
  });

  test("the singular forms a channel page writes and a panel does not", () => {
    // Measured on youtube.com: a channel page spells the unit out, and the
    // singular is a different word from the plural in three of the four.
    expect(parsePublishedTimeText("vor 1 Monat")).toEqual({ value: 1, unit: "month" });
    expect(parsePublishedTimeText("vor 2 Wochen")).toEqual({ value: 2, unit: "week" });
    expect(parsePublishedTimeText("1 dzień temu")).toEqual({ value: 1, unit: "day" });
    expect(parsePublishedTimeText("2 miesiące temu")).toEqual({ value: 2, unit: "month" });
    expect(parsePublishedTimeText("2 tygodnie temu")).toEqual({ value: 2, unit: "week" });
    expect(parsePublishedTimeText("1 day ago")).toEqual({ value: 1, unit: "day" });
  });

  test("a label that says what it is before saying when", () => {
    expect(parsePublishedTimeText("Streamed 2 weeks ago")).toEqual({ value: 2, unit: "week" });
    expect(parsePublishedTimeText("Diffusé en direct il y a 2 semaines")).toEqual({ value: 2, unit: "week" });
  });

  test("what is not an age still says so", () => {
    expect(parsePublishedTimeText("PP World")).toBe(null);
    expect(parsePublishedTimeText("12 k vues")).toBe(null);
    expect(parsePublishedTimeText(undefined)).toBe(null);
  });
});

