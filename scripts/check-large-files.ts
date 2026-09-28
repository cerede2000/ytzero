import { readFile } from "node:fs/promises";

const lineLimits: Record<string, number> = {
  "app/src/routes.ts": 481,
  "app/src/routes/authRoutes.ts": 492,
  "app/src/routes/backupRoutes.ts": 143,
  "app/src/routes/channelPlaylistRoutes.ts": 227,
  "app/src/routes/channelRoutes.ts": 639,
  "app/src/routes/childRoutes.ts": 259,
  "app/src/routes/downloadRoutes.ts": 532,
  "app/src/routes/feedRoutes.ts": 161,
  "app/src/routes/historyRoutes.ts": 63,
  "app/src/routes/importRoutes.ts": 245,
  "app/src/routes/insightRoutes.ts": 65,
  "app/src/routes/libraryRoutes.ts": 249,
  "app/src/routes/pluginRoutes.ts": 86,
  "app/src/routes/profileRoutes.ts": 444,
  "app/src/routes/settingsRoutes.ts": 295,
  "app/src/routes/socialRoutes.ts": 187,
  "app/src/routes/systemRoutes.ts": 145,
  "app/src/routes/tagRoutes.ts": 148,
  "app/src/routes/userPlaylistRoutes.ts": 263,
  "app/src/routes/videoActionRoutes.ts": 232,
  "app/src/routes/videoRoutes.ts": 615,
  "app/src/videoRoutesSupport.ts": 137,
  "app/src/routeCache.ts": 11,
  "ui/src/App.tsx": 24,
  "ui/src/AppRoutes.tsx": 112,
  "ui/src/app-shell/AppBootstrap.tsx": 17,
  "ui/src/app-shell/AppShell.tsx": 114,
  "ui/src/app-shell/AppSidebar.tsx": 109,
  "ui/src/app-shell/AppTopBar.tsx": 162,
  "ui/src/app-shell/SidebarPlaylists.tsx": 106,
  "ui/src/app-shell/SidebarSubscriptions.tsx": 86,
  "ui/src/app-shell/sidebarVisibility.ts": 30,
  "ui/src/app-shell/useAppPreferences.ts": 107,
  "ui/src/app-shell/useAppToast.ts": 23,
  "ui/src/app-shell/useNavigationActivity.ts": 54,
  "ui/src/app-shell/usePluginRoutes.ts": 43,
  "ui/src/app-shell/useProfileSession.ts": 63,
  "ui/src/pages/SettingsPage.tsx": 1354,
  "ui/src/pages/useSettingsPageController.tsx": 1457,
  "ui/src/components/settings/SettingsDisplayView.tsx": 656,
  "ui/src/pages/WatchPage.tsx": 1105,
  "ui/src/pages/useWatchPageController.tsx": 1856,
  "ui/src/pages/WatchPage.css": 1148,
  "ui/src/components/LocalPlayer.css": 343,
  "ui/src/components/VideoCreators.css": 104,
  "ui/src/components/Popconfirm.css": 24,
  "ui/src/components/settings/SettingsDisplayView.css": 83,
  "ui/src/components/VideoCard.css": 666,
  "ui/src/components/VideoThumbnail.css": 120,
  "ui/src/pages/SearchPage.css": 164,
  "app/src/plugins.ts": 1106,
  "app/src/pluginCatalog.ts": 441,
  "ui/src/api.ts": 632,
  "ui/src/apiTypes.ts": 1246,
  "app/src/refresher.ts": 1514,
  "app/src/refreshScheduler.ts": 106,
  "app/src/downloader.ts": 1267,
  "app/src/downloadConfig.ts": 169,
  "app/src/downloadStreaming.ts": 299,
  "app/src/youtube.ts": 1433,
  "app/src/youtubeSearch.ts": 534,
  "app/src/db.ts": 660,
  "app/src/schema.sql": 800,
  "app/src/portableBackup.ts": 533,
  "app/src/portableArchive.ts": 76,
  "ui/src/pages/SettingsPage.css": 1071,
};

// Locale modules are typed message catalogs: every product string legitimately
// adds a line, so file length is not a useful complexity signal for them.
// TypeScript still enforces that every locale implements the English key set.

const failures: string[] = [];
for (const [path, maximum] of Object.entries(lineLimits)) {
  const source = await readFile(new URL(`../${path}`, import.meta.url), "utf8");
  const lines = source.endsWith("\n") ? source.split("\n").length - 1 : source.split("\n").length;
  if (lines > maximum) failures.push(`${path} grew to ${lines} lines (ratchet: ${maximum})`);
}

if (failures.length) {
  console.error("Large-file ratchet failed:\n" + failures.map((failure) => `- ${failure}`).join("\n"));
  process.exit(1);
}
