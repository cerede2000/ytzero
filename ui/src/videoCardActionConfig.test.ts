import { describe, expect, test } from "bun:test";
import { DEFAULT_VIDEO_CARD_ACTION_CONFIG, LOCKED_VIDEO_CARD_ACTION_IDS, parseVideoCardActionConfig, PINNED_VIDEO_CARD_ACTION_IDS } from "./videoCardActionConfig";

const hidden = (config: ReturnType<typeof parseVideoCardActionConfig>, id: string) =>
  config.actions.find((action) => action.id === id)?.hidden;

describe("which actions a card carries", () => {
  test("scheduling can be put away like the others", () => {
    // It owns three days and their buttons, and a reader who schedules nothing
    // was left looking at all of it on every card with no way to say no.
    const config = parseVideoCardActionConfig({
      version: 1,
      actions: [{ id: "schedule", hidden: true }, { id: "sessionQueue", hidden: false }],
    });
    expect(hidden(config, "schedule")).toBe(true);
  });

  test("stays first even when it is put away, so the row comes back where it was", () => {
    const config = parseVideoCardActionConfig({
      version: 1,
      actions: [{ id: "sessionQueue", hidden: false }, { id: "schedule", hidden: true }],
    });
    expect(config.actions[0].id).toBe("schedule");
  });

  test("keeps undo and delete on the card whatever is asked", () => {
    // These two are how a card takes back what it just did; hiding them would
    // strand a rejected video with no way back.
    const config = parseVideoCardActionConfig({
      version: 1,
      actions: [{ id: "restore", hidden: true }, { id: "remove", hidden: true }],
    });
    expect(hidden(config, "restore")).toBe(false);
    expect(hidden(config, "remove")).toBe(false);
  });

  test("the two sets say different things", () => {
    expect([...LOCKED_VIDEO_CARD_ACTION_IDS].sort()).toEqual(["remove", "restore"]);
    expect([...PINNED_VIDEO_CARD_ACTION_IDS]).toEqual(["schedule"]);
    expect(hidden(DEFAULT_VIDEO_CARD_ACTION_CONFIG, "schedule")).toBe(false);
  });
});
