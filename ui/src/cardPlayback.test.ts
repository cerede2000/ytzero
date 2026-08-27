import { describe, expect, test } from "bun:test";
import { playInOtherMode } from "./cardPlayback";

const video = { video_id: "abc" } as never;

describe("the play action on a card", () => {
  test("puts on the headphones when the profile is watching", () => {
    const remembered: boolean[] = [];
    const played: unknown[] = [];
    expect(playInOtherMode(video, false, (audio) => remembered.push(audio), (v) => played.push(v))).toBe(true);
    expect(remembered).toEqual([true]);
    expect(played).toEqual([video]);
  });

  test("takes them off when the profile is listening", () => {
    const remembered: boolean[] = [];
    expect(playInOtherMode(video, true, (audio) => remembered.push(audio), () => {})).toBe(false);
    expect(remembered).toEqual([false]);
  });

  test("writes the choice before it navigates", () => {
    // The watch page reads the remembered mode as it opens. Written after the
    // navigation, the choice would arrive too late and the video would start
    // in the mode the reader was trying to leave.
    const order: string[] = [];
    playInOtherMode(video, false, () => order.push("remembered"), () => order.push("played"));
    expect(order).toEqual(["remembered", "played"]);
  });
});
