import { VERSION } from "../../version";

/**
 * The answer that makes an existing client believe this is an Invidious server.
 *
 * Yattee probes a new address in order — Yattee Server's `/info`, PeerTube's
 * `/api/v1/config`, then this — and concludes "Invidious" on one field:
 * `software.name`. Everything else here is shape it does not read but other
 * clients do, and a server that answers a stats endpoint with half a document
 * is a server they will each break on differently.
 *
 * The counts are deliberately zero rather than real. This endpoint is the only
 * one reachable before a client has proven anything about itself, and how many
 * people use a private instance is nobody's business.
 */
export function invidiousStats(now: number = Date.now()) {
  return {
    version: "2.0",
    software: { name: "invidious", version: VERSION, branch: "ytzero" },
    openRegistrations: false,
    usage: { users: { total: 0, activeHalfyear: 0, activeMonth: 0 } },
    metadata: { updatedAt: Math.floor(now / 1000), lastChannelRefreshedAt: 0 },
  };
}
