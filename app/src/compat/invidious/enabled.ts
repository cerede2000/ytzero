/**
 * Whether this server speaks the Invidious dialect at all.
 *
 * Off unless asked for: it is a second front door on a server that is often
 * exposed, and a door nobody opened should not exist. Kept in its own file so
 * that the settings screen can ask the question without importing the routes.
 */
export function invidiousCompatEnabled(): boolean {
  return (process.env.YTZERO_INVIDIOUS_COMPAT ?? "").trim() === "1";
}
