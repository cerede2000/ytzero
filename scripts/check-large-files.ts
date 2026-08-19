import { readFile } from "node:fs/promises";

const lineLimits: Record<string, number> = {
  "app/src/routes.ts": 464,
  "app/src/routes/authRoutes.ts": 492,
  "app/src/routes/backupRoutes.ts": 143,
  "app/src/routes/channelPlaylistRoutes.ts": 177,
  "app/src/routes/channelRoutes.ts": 639,
  "app/src/routes/childRoutes.ts": 157,
  "app/src/routes/downloadRoutes.ts": 495,
  "app/src/routes/feedRoutes.ts": 157,
  "app/src/routes/historyRoutes.ts": 63,
  "app/src/routes/importRoutes.ts": 245,
  "app/src/routes/insightRoutes.ts": 65,
  "app/src/routes/libraryRoutes.ts": 132,
  "app/src/routes/pluginRoutes.ts": 86,
  "app/src/routes/profileRoutes.ts": 434,
  "app/src/routes/settingsRoutes.ts": 280,
  "app/src/routes/socialRoutes.ts": 187,
  "app/src/routes/systemRoutes.ts": 145,
  "app/src/routes/tagRoutes.ts": 148,
  "app/src/routes/userPlaylistRoutes.ts": 242,
  "app/src/routes/videoActionRoutes.ts": 204,
  "app/src/routes/videoRoutes.ts": 519,
  "app/src/routes/userPlaylistRoutes.ts": 199,
  "app/src/routes/videoActionRoutes.ts": 190,
  "app/src/routes/videoRoutes.ts": 514,
>>>>>>> 166d6fb (Move the line ratchet up to where this branch actually sits)
  "app/src/routes/videoRoutes.ts": 513,
>>>>>>> 2126885 (Move the line ratchet up to where this branch actually sits)
>>>>>>> c9c55d4 (Take the video out of the answer we already paid for, as well as the audio)
  "app/src/routes/videoRoutes.ts": 513,
>>>>>>> f4374ef (Stop charging a video for a lookup nobody made)
  "app/src/videoRoutesSupport.ts": 133,
  "app/src/routeCache.ts": 11,
  "ui/src/App.tsx": 24,
>>>>>>> 5738e99 (Give the channel link somewhere to go)
  "ui/src/AppRoutes.tsx": 98,
  "ui/src/AppRoutes.tsx": 98,
>>>>>>> 831aa36 (Split searching from watching, and put their suggestions beside the picture)
>>>>>>> 5738e99 (Give the channel link somewhere to go)
  "ui/src/app-shell/AppBootstrap.tsx": 17,
  "ui/src/app-shell/AppShell.tsx": 126,
  "ui/src/app-shell/AppSidebar.tsx": 97,
  "ui/src/app-shell/AppTopBar.tsx": 162,
  "ui/src/app-shell/SidebarPlaylists.tsx": 106,
  "ui/src/app-shell/SidebarSubscriptions.tsx": 86,
  "ui/src/app-shell/sidebarVisibility.ts": 30,
  "ui/src/app-shell/useAppPreferences.ts": 107,
=======
  "ui/src/AppRoutes.tsx": 99,
>>>>>>> 19d0a58 (Split searching from watching, and put their suggestions beside the picture)
=======
  "ui/src/AppRoutes.tsx": 101,
>>>>>>> 887d8ef (Give the channel link somewhere to go)
=======
  "ui/src/App.tsx": 12,
  "ui/src/AppRoutes.tsx": 103,
>>>>>>> 1f4aba1 (Settle onto upstream's release)
  "ui/src/app-shell/AppBootstrap.tsx": 17,
  "ui/src/app-shell/AppShell.tsx": 104,
  "ui/src/app-shell/AppSidebar.tsx": 109,
  "ui/src/app-shell/AppTopBar.tsx": 146,
  "ui/src/app-shell/SidebarPlaylists.tsx": 113,
  "ui/src/app-shell/SidebarSubscriptions.tsx": 86,
  "ui/src/app-shell/sidebarVisibility.ts": 30,
  "ui/src/app-shell/useAppPreferences.ts": 103,
>>>>>>> 874b040 (Settle onto upstream's release)
  "ui/src/app-shell/useAppToast.ts": 23,
  "ui/src/app-shell/useNavigationActivity.ts": 53,
  "ui/src/app-shell/usePluginRoutes.ts": 43,
  "ui/src/app-shell/useProfileSession.ts": 63,
  "ui/src/pages/SettingsPage.tsx": 1340,
  "ui/src/pages/useSettingsPageController.tsx": 1387,
  "ui/src/components/settings/SettingsDisplayView.tsx": 608,
  "ui/src/pages/WatchPage.tsx": 1040,
  "ui/src/pages/useWatchPageController.tsx": 1558,
  "ui/src/pages/WatchPage.css": 996,
  "ui/src/components/LocalPlayer.css": 323,
  "ui/src/components/LocalPlayer.css": 319,
>>>>>>> 166d6fb (Move the line ratchet up to where this branch actually sits)
  "ui/src/components/VideoCreators.css": 104,
  "ui/src/components/Popconfirm.css": 24,
  "ui/src/components/settings/SettingsDisplayView.css": 83,
  "ui/src/components/VideoCard.css": 666,
  "ui/src/components/VideoThumbnail.css": 120,
  "ui/src/pages/SearchPage.css": 164,
  "app/src/plugins.ts": 1083,
  "app/src/pluginCatalog.ts": 404,
  "ui/src/api.ts": 536,
  "ui/src/apiTypes.ts": 1114,
  "app/src/refresher.ts": 1420,
  "app/src/refreshScheduler.ts": 106,
  "app/src/downloader.ts": 1167,
  "app/src/downloadConfig.ts": 169,
  "app/src/downloadStreaming.ts": 299,
  "app/src/youtube.ts": 1249,
  "app/src/youtubeSearch.ts": 225,
  "app/src/db.ts": 634,
  "app/src/schema.sql": 674,
  "app/src/portableBackup.ts": 496,
>>>>>>> 232d183 (Move the line ratchet up to where this branch actually sits)
  "app/src/portableArchive.ts": 76,
  "ui/src/pages/SettingsPage.css": 1015,
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
