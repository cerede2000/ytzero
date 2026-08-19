import { afterEach, describe, expect, test } from "bun:test";
import { basicCredentials, compatAuthMode, unauthorized } from "./clientAuth";

const original = process.env.YTZERO_INVIDIOUS_COMPAT_AUTH;
afterEach(() => {
  if (original === undefined) delete process.env.YTZERO_INVIDIOUS_COMPAT_AUTH;
  else process.env.YTZERO_INVIDIOUS_COMPAT_AUTH = original;
});

describe("the credentials a client sends on every request", () => {
  test("are the two halves of the header", () => {
    const header = `Basic ${Buffer.from("Benjy:ytz_abc").toString("base64")}`;
    expect(basicCredentials(header)).toEqual({ name: "Benjy", secret: "ytz_abc" });
  });

  // RFC 7617: the name cannot contain a colon, so the first one ends it and
  // everything after is the password, colons and all.
  test("keep a password that contains the separator whole", () => {
    const header = `Basic ${Buffer.from("Benjy:a:b:c").toString("base64")}`;
    expect(basicCredentials(header)?.secret).toBe("a:b:c");
  });

  test("are nothing when there is nothing to read", () => {
    expect(basicCredentials(undefined)).toBeNull();
    expect(basicCredentials("")).toBeNull();
    // A session, not credentials: the other scheme entirely.
    expect(basicCredentials("Bearer ytz_abc")).toBeNull();
    // No separator at all, and an empty name, are both unusable.
    expect(basicCredentials(`Basic ${Buffer.from("nocolon").toString("base64")}`)).toBeNull();
    expect(basicCredentials(`Basic ${Buffer.from(":secret").toString("base64")}`)).toBeNull();
  });
});

describe("whether this instance asks clients to say who they are", () => {
  test("is off unless it was asked for, so an instance that worked keeps working", () => {
    delete process.env.YTZERO_INVIDIOUS_COMPAT_AUTH;
    expect(compatAuthMode()).toBe("open");
    process.env.YTZERO_INVIDIOUS_COMPAT_AUTH = "yes please";
    expect(compatAuthMode()).toBe("open");
  });

  test("is on for the one value that means it", () => {
    process.env.YTZERO_INVIDIOUS_COMPAT_AUTH = "basic";
    expect(compatAuthMode()).toBe("basic");
  });
});

describe("the refusal", () => {
  /*
   * Yattee concludes "this instance needs credentials" from the status and
   * offers the two fields; a browser and everything else read the header.
   */
  test("tells a client what it is being asked for", () => {
    const response = unauthorized();
    expect(response.status).toBe(401);
    expect(response.headers.get("WWW-Authenticate")).toStartWith("Basic realm=");
  });
});
