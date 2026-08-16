import { describe, expect, test } from "bun:test";
import { createCookieAttemptMemory } from "./cookieAttemptOrder";

function memoryAt(clock: { value: number }) {
  return createCookieAttemptMemory({ now: () => clock.value, memoryMs: 1_000 });
}

describe("cookie attempt order", () => {
  test("asks anonymously first while nothing says otherwise", () => {
    const memory = memoryAt({ value: 0 });
    expect(memory.order(1, true)).toEqual([false, true]);
    expect(memory.order(1, false)).toEqual([false]);
  });

  test("puts cookies first once they are what got a profile through", () => {
    const clock = { value: 1_000 };
    const memory = memoryAt(clock);
    memory.record({ userId: 1, useCookies: false, resolved: false, refused: true });
    memory.record({ userId: 1, useCookies: true, resolved: true });
    expect(memory.order(1, true)).toEqual([true, false]);
  });

  test("still tries anonymously behind the cookies", () => {
    // A cookie that expires must cost one resolution, not a dead player.
    const clock = { value: 1_000 };
    const memory = memoryAt(clock);
    memory.record({ userId: 1, useCookies: false, resolved: false, refused: true });
    memory.record({ userId: 1, useCookies: true, resolved: true });
    expect(memory.order(1, true)).toContain(false);
  });

  test("forgets, so a working address is not paying for an old refusal", () => {
    const clock = { value: 1_000 };
    const memory = memoryAt(clock);
    memory.record({ userId: 1, useCookies: false, resolved: false, refused: true });
    memory.record({ userId: 1, useCookies: true, resolved: true });
    clock.value += 1_001;
    expect(memory.order(1, true)).toEqual([false, true]);
  });

  test("goes back to anonymous first as soon as it works again", () => {
    const clock = { value: 1_000 };
    const memory = memoryAt(clock);
    memory.record({ userId: 1, useCookies: false, resolved: false, refused: true });
    memory.record({ userId: 1, useCookies: true, resolved: true });
    expect(memory.order(1, true)).toEqual([true, false]);
    memory.record({ userId: 1, useCookies: false, resolved: true });
    expect(memory.order(1, true)).toEqual([false, true]);
  });

  test("ignores an anonymous failure that was not a refusal", () => {
    // yt-dlp fails for plenty of ordinary reasons. Only being turned away for
    // who we are says anything about which credentials to try first.
    const clock = { value: 1_000 };
    const memory = memoryAt(clock);
    memory.record({ userId: 1, useCookies: false, resolved: false });
    memory.record({ userId: 1, useCookies: true, resolved: true });
    expect(memory.order(1, true)).toEqual([false, true]);
  });

  test("does not reorder when cookies are refused as well", () => {
    // Both are being turned away: the anonymous one is the one that tends to
    // come back first, and it is also the one that offers more formats.
    const clock = { value: 1_000 };
    const memory = memoryAt(clock);
    memory.record({ userId: 1, useCookies: false, resolved: false, refused: true });
    memory.record({ userId: 1, useCookies: true, resolved: false });
    expect(memory.order(1, true)).toEqual([false, true]);
  });

  test("does not spend the first attempt on an address already being refused", () => {
    // The plain lookups have just been told to sign in. An attempt that offers
    // no account is answering that with nothing, and its two to three seconds
    // are paid in front of someone who pressed play.
    const memory = memoryAt({ value: 1_000 });
    expect(memory.order(1, true, true)).toEqual([true, false]);
    expect(memory.order(1, true, false)).toEqual([false, true]);
    // Nothing is dropped: an expired cookie still costs one resolution.
    expect(memory.order(1, true, true)).toContain(false);
    // A profile with no cookies has nothing else to offer either way.
    expect(memory.order(1, false, true)).toEqual([false]);
  });

  test("believes the anonymous attempt over the lookups when it has just worked", () => {
    // yt-dlp gets through where a plain read does not, so a resolution that
    // succeeded a moment ago settles the question better than the refusal.
    const clock = { value: 1_000 };
    const memory = memoryAt(clock);
    memory.record({ userId: 1, useCookies: false, resolved: true });
    expect(memory.order(1, true, true)).toEqual([false, true]);
    clock.value += 1_001;
    expect(memory.order(1, true, true)).toEqual([true, false]);
  });

  test("keeps profiles apart", () => {
    // Cookies belong to a profile: what one profile learns says nothing about
    // another, which may have none configured at all.
    const clock = { value: 1_000 };
    const memory = memoryAt(clock);
    memory.record({ userId: 1, useCookies: false, resolved: false, refused: true });
    memory.record({ userId: 1, useCookies: true, resolved: true });
    expect(memory.order(1, true)).toEqual([true, false]);
    expect(memory.order(2, true)).toEqual([false, true]);
  });
});
