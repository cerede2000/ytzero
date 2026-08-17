import { relatedVideosFromWatchPage, type RelatedVideo } from "./relatedVideos";
import { acceptLanguage, type PanelLanguage } from "./relatedVideoText";

/**
 * The panel a browser gets, rather than the one a page hands out.
 *
 * Reading the watch page signed in gives a panel that leans towards the
 * account's feed: the same suggestions whichever video was opened. Reading it
 * anonymously gives the video's own, which is right about the subject and
 * knows nothing about the reader. Neither is what youtube.com shows a
 * signed-in visitor, which is both at once — the video's channel at the top,
 * then their own interests.
 *
 * The difference is that a browser does not stop at the page. It calls
 * YouTube's own `next` endpoint with the session, and that answer is the one
 * worth having. Reproducing the call is mostly a matter of signing it the way
 * a browser does.
 */

/** What a browser sends so YouTube answers as the account rather than as nobody. */
export function sapisidHash(sapisid: string, origin: string, now: number, digest = sha1): string {
  const seconds = Math.floor(now / 1000);
  return `SAPISIDHASH ${seconds}_${digest(`${seconds} ${sapisid} ${origin}`)}`;
}

function sha1(value: string): string {
  return new Bun.CryptoHasher("sha1").update(value).digest("hex");
}

/** The cookie that identifies the account, whichever of its names is present. */
export function sapisidFrom(cookieHeader: string): string | null {
  const names = ["SAPISID", "__Secure-3PAPISID", "__Secure-1PAPISID", "APISID"];
  for (const name of names) {
    const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
    if (match?.[1]) return match[1];
  }
  return null;
}

const ORIGIN = "https://www.youtube.com";
/** Overridable because YouTube retires client versions on its own schedule. */
const CLIENT_VERSION = process.env.YOUTUBE_CLIENT_VERSION ?? "2.20260812.01.00";

const REGION: Record<PanelLanguage, string> = { en: "US", fr: "FR", de: "DE", pl: "PL" };

/**
 * Ask for the panel as the account, the way the page's own scripts do.
 *
 * The answer carries the same `secondaryResults` the watch page does, so it is
 * read by the same parser — what changes is who was asking.
 */
export async function fetchWatchNextPanel(
  videoId: string,
  cookieHeader: string,
  language: PanelLanguage = "en",
  now: () => number = Date.now,
  request: typeof fetch = fetch,
): Promise<RelatedVideo[]> {
  const sapisid = sapisidFrom(cookieHeader);
  if (!sapisid) return [];
  const res = await request(`${ORIGIN}/youtubei/v1/next?prettyPrint=false`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      "Accept-Language": acceptLanguage(language),
      Cookie: cookieHeader,
      Origin: ORIGIN,
      Referer: `${ORIGIN}/watch?v=${videoId}`,
      Authorization: sapisidHash(sapisid, ORIGIN, now()),
      "X-Origin": ORIGIN,
      "X-Youtube-Client-Name": "1",
      "X-Youtube-Client-Version": CLIENT_VERSION,
      "X-Goog-AuthUser": "0",
    },
    body: JSON.stringify({
      context: {
        client: {
          clientName: "WEB",
          clientVersion: CLIENT_VERSION,
          hl: language,
          gl: REGION[language],
        },
      },
      videoId,
    }),
  });
  if (!res.ok) throw new Error(`YouTube next failed (${res.status})`);
  return relatedVideosFromWatchPage(await res.json(), 40, language);
}
