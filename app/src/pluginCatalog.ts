export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  // Headless integrations may enrich existing surfaces without owning a page.
  route?: string;
  icon: string;
  permissions: string[];
  // "user" (default): settings live per profile in plugin_settings.
  // "global": settings are app-wide and stored in the settings table.
  settingsScope?: "user" | "global";
}

import type { BaseLocalizedText } from "./serverMessages";

export type LocalizedText = BaseLocalizedText;

export type PluginSettingType = "slider" | "select" | "toggle" | "text" | "multiselect";

export interface PluginSettingOption {
  value: string;
  label: string;
}

export interface PluginSettingDef {
  key: string;
  label: string;
  description: string;
  type: PluginSettingType;
  min?: number;
  max?: number;
  step?: number;
  options?: PluginSettingOption[];
  defaultValue: number | string;
  scope?: "user" | "global";
  adminOnly?: boolean;
}

export type PluginSettingValue = number | string;

export interface PluginTermState {
  lastTerms: string[];
  blockedTerms: string[];
}

export type PluginSettingSource = Omit<PluginSettingDef, "label" | "description" | "type" | "options"> & {
  label: LocalizedText;
  description: LocalizedText;
  type?: PluginSettingType;
  options?: { value: string; label: LocalizedText }[];
};

export const SOCIAL_SETTINGS: PluginSettingSource[] = [
  {
    key: "comments_enabled",
    type: "toggle",
    scope: "global",
    adminOnly: true,
    label: { en: "Comments", pl: "Komentarze", de: "Kommentare" },
    description: { en: "Profiles can discuss videos shared in Social.", pl: "Profile mogą rozmawiać o filmach udostępnionych w Social.", de: "Profile können in Social geteilte Videos kommentieren." },
    defaultValue: 1,
  },
  {
    key: "reactions_enabled",
    type: "toggle",
    scope: "global",
    adminOnly: true,
    label: { en: "Emoji reactions", pl: "Reakcje emoji", de: "Emoji-Reaktionen" },
    description: { en: "Each profile can select several different reactions on one post.", pl: "Każdy profil może wybrać kilka różnych reakcji na jeden post.", de: "Jedes Profil kann mehrere verschiedene Reaktionen auf einen Beitrag auswählen." },
    defaultValue: 1,
  },
  {
    key: "watch_together_enabled",
    type: "toggle",
    scope: "global",
    adminOnly: true,
    label: { en: "Watch together", pl: "Wspólne oglądanie", de: "Gemeinsam ansehen" },
    description: { en: "Profiles can create synchronized watch rooms with a shared chat.", pl: "Profile mogą tworzyć zsynchronizowane pokoje oglądania ze wspólnym czatem.", de: "Profile können synchronisierte Wiedergaberäume mit gemeinsamem Chat erstellen." },
    defaultValue: 0,
  },
  {
    key: "allow_child_profiles",
    type: "toggle",
    scope: "global",
    adminOnly: true,
    label: { en: "Child profiles", pl: "Profile dziecięce", de: "Kinderprofile" },
    description: { en: "Allow child profiles to open Social, publish, react and comment.", pl: "Pozwól profilom dziecięcym otwierać Social, publikować, reagować i komentować.", de: "Erlaube Kinderprofilen Social zu öffnen, zu posten, zu reagieren und zu kommentieren." },
    defaultValue: 0,
  },
  {
    key: "notify_new_posts",
    type: "toggle",
    scope: "user",
    label: { en: "New posts", pl: "Nowe posty", de: "Neue Beiträge" },
    description: { en: "Notify me when another profile shares a video.", pl: "Powiadamiaj, gdy inny profil udostępni film.", de: "Benachrichtige mich, wenn ein anderes Profil ein Video teilt." },
    defaultValue: 1,
  },
  {
    key: "notify_comments",
    type: "toggle",
    scope: "user",
    label: { en: "Comments on my posts", pl: "Komentarze do moich postów", de: "Kommentare zu meinen Beiträgen" },
    description: { en: "Notify me about new comments on videos I shared.", pl: "Powiadamiaj o nowych komentarzach pod udostępnionymi przeze mnie filmami.", de: "Benachrichtige mich über neue Kommentare zu meinen geteilten Videos." },
    defaultValue: 1,
  },
  {
    key: "notify_reactions",
    type: "toggle",
    scope: "user",
    label: { en: "Reactions and comment likes", pl: "Reakcje i polubienia komentarzy", de: "Reaktionen und Kommentar-Likes" },
    description: { en: "Notify me about the first reaction from a profile and likes on my comments.", pl: "Powiadamiaj o pierwszej reakcji profilu i polubieniach moich komentarzy.", de: "Benachrichtige mich über die erste Reaktion eines Profils und Likes auf meine Kommentare." },
    defaultValue: 0,
  },
  {
    key: "notify_mentions",
    type: "toggle",
    scope: "user",
    label: { en: "@mentions", pl: "Oznaczenia @profil", de: "@Erwähnungen" },
    description: { en: "Notify me when another profile mentions me in a post or comment.", pl: "Powiadamiaj, gdy inny profil oznaczy mnie w poście lub komentarzu.", de: "Benachrichtige mich, wenn ein anderes Profil mich in einem Beitrag oder Kommentar erwähnt." },
    defaultValue: 1,
  },
];

export const SEARCH_SUGGEST_SETTINGS: PluginSettingSource[] = [
  {
    key: "suggestion_language",
    type: "select",
    label: { en: "Suggestion language", pl: "Język podpowiedzi", de: "Sprache der Vorschläge" },
    description: {
      en: "Completions follow the interface language by default, which only covers a few languages. Pick another one to search in a language the interface does not offer.",
      pl: "Podpowiedzi domyślnie podążają za językiem interfejsu, który obejmuje tylko kilka języków. Wybierz inny, aby szukać w języku niedostępnym w interfejsie.",
      de: "Vervollständigungen folgen standardmäßig der Oberflächensprache, die nur wenige Sprachen abdeckt. Wähle eine andere, um in einer nicht angebotenen Sprache zu suchen.",
    },
    options: [
      { value: "auto", label: { en: "Follow the interface", pl: "Zgodnie z interfejsem", de: "Wie die Oberfläche" } },
      { value: "en", label: { en: "English", pl: "English", de: "English" } },
      { value: "fr", label: { en: "Français", pl: "Français", de: "Français" } },
      { value: "de", label: { en: "Deutsch", pl: "Deutsch", de: "Deutsch" } },
      { value: "es", label: { en: "Español", pl: "Español", de: "Español" } },
      { value: "it", label: { en: "Italiano", pl: "Italiano", de: "Italiano" } },
      { value: "pt", label: { en: "Português", pl: "Português", de: "Português" } },
      { value: "nl", label: { en: "Nederlands", pl: "Nederlands", de: "Nederlands" } },
      { value: "pl", label: { en: "Polski", pl: "Polski", de: "Polski" } },
      { value: "ja", label: { en: "日本語", pl: "日本語", de: "日本語" } },
    ],
    defaultValue: "auto",
  },
  {
    key: "suggestion_limit",
    type: "slider",
    min: 3,
    max: 10,
    step: 1,
    label: { en: "Number of suggestions", pl: "Liczba podpowiedzi", de: "Anzahl der Vorschläge" },
    description: {
      en: "How many completions the search box offers under your own channels.",
      pl: "Ile podpowiedzi pole wyszukiwania pokazuje pod Twoimi kanałami.",
      de: "Wie viele Vervollständigungen das Suchfeld unter deinen Kanälen anbietet.",
    },
    defaultValue: 10,
  },
];

export const TUBE_ARCHIVIST_SETTINGS: PluginSettingSource[] = [
  {
    key: "sync_interval_minutes",
    type: "select",
    scope: "global",
    adminOnly: true,
    label: { en: "Library refresh", pl: "Odświeżanie biblioteki", de: "Bibliothek aktualisieren" },
    description: { en: "How often YTZero imports changes from TubeArchivist.", pl: "Jak często YTZero importuje zmiany z TubeArchivist.", de: "Wie oft YTZero Änderungen aus TubeArchivist importiert." },
    options: [
      { value: "15", label: { en: "Every 15 minutes", pl: "Co 15 minut", de: "Alle 15 Minuten" } },
      { value: "60", label: { en: "Every hour", pl: "Co godzinę", de: "Stündlich" } },
      { value: "360", label: { en: "Every 6 hours", pl: "Co 6 godzin", de: "Alle 6 Stunden" } },
      { value: "1440", label: { en: "Daily", pl: "Codziennie", de: "Täglich" } },
    ],
    defaultValue: "60",
  },
  {
    key: "sync_watched",
    type: "toggle",
    scope: "global",
    adminOnly: true,
    label: { en: "Sync watched status", pl: "Synchronizuj obejrzane", de: "Gesehen-Status synchronisieren" },
    description: { en: "Mark a TubeArchivist video watched after it is completed in YTZero.", pl: "Oznacz film w TubeArchivist jako obejrzany po ukończeniu go w YTZero.", de: "Markiert ein TubeArchivist-Video nach dem Abschluss in YTZero als gesehen." },
    defaultValue: 1,
  },
];

export const DISCOVERY_SETTINGS: PluginSettingSource[] = [
  { key: "total_limit", label: { en: "Number of suggestions", pl: "Liczba propozycji", de: "Anzahl der Vorschläge" }, description: { en: "How many videos Recommendations should prepare at once.", pl: "Ile filmów Rekomendacje mają przygotować naraz.", de: "Wie viele Videos Empfehlungen auf einmal vorbereiten soll." }, min: 8, max: 80, step: 1, defaultValue: 32 },
  { key: "per_channel_limit", label: { en: "Videos from one channel", pl: "Filmy z jednego kanału", de: "Videos von einem Kanal" }, description: { en: "Prevents one channel from taking over the whole list.", pl: "Pilnuje, żeby jeden kanał nie zajął całej listy.", de: "Verhindert, dass ein Kanal die ganze Liste dominiert." }, min: 1, max: 20, step: 1, defaultValue: 5 },
  { key: "shared_tag_points", label: { en: "Shared tags", pl: "Wspólne tagi", de: "Gemeinsame Tags" }, description: { en: "Fallback tag affinity used after Pulse has matched tags and channels for the current hour.", pl: "Ogólne dopasowanie tagów używane po godzinowym dopasowaniu Pulse dla tagów i kanałów.", de: "Allgemeine Tag-Affinität nach dem stündlichen Pulse-Abgleich für Tags und Kanäle." }, min: 0, max: 80, step: 1, defaultValue: 25 },
  { key: "tag_history_points", label: { en: "Watched tags", pl: "Oglądane tagi", de: "Angesehene Tags" }, description: { en: "Adds weight for tags that appear often in your watch history.", pl: "Dodaje wagę tagom, które często pojawiają się w Twojej historii.", de: "Gewichtet Tags höher, die oft in deinem Verlauf vorkommen." }, min: 0, max: 20, step: 1, defaultValue: 3 },
  { key: "tag_history_cap", label: { en: "Watched tag limit", pl: "Limit oglądanych tagów", de: "Limit für angesehene Tags" }, description: { en: "Caps how much watched tags can influence one video.", pl: "Ogranicza, jak mocno oglądane tagi mogą podbić jeden film.", de: "Begrenzt, wie stark angesehene Tags ein Video anheben können." }, min: 0, max: 120, step: 1, defaultValue: 36 },
  { key: "watched_channel_points", label: { en: "Known channels", pl: "Znane kanały", de: "Bekannte Kanäle" }, description: { en: "General channel affinity used after current-hour Pulse matches.", pl: "Ogólne dopasowanie kanałów używane po godzinowych dopasowaniach Pulse.", de: "Allgemeine Kanal-Affinität nach den Pulse-Treffern der aktuellen Stunde." }, min: 0, max: 30, step: 1, defaultValue: 8 },
  { key: "watched_channel_cap", label: { en: "Known channel limit", pl: "Limit znanych kanałów", de: "Limit für bekannte Kanäle" }, description: { en: "Caps how much channel history can influence one video.", pl: "Ogranicza wpływ historii kanału na jeden film.", de: "Begrenzt den Einfluss der Kanalhistorie auf ein Video." }, min: 0, max: 120, step: 1, defaultValue: 40 },
  { key: "playlist_points", label: { en: "Your playlists", pl: "Twoje playlisty", de: "Deine Playlists" }, description: { en: "Raises videos that are already saved in your playlists.", pl: "Podbija filmy zapisane już na Twoich playlistach.", de: "Hebt Videos an, die bereits in deinen Playlists liegen." }, min: 0, max: 80, step: 1, defaultValue: 20 },
  { key: "liked_points", label: { en: "Liked videos", pl: "Polubione filmy", de: "Favorisierte Videos" }, description: { en: "Raises videos you marked as liked.", pl: "Podbija filmy oznaczone jako polubione.", de: "Hebt Videos an, die du favorisiert hast." }, min: 0, max: 100, step: 1, defaultValue: 35 },
  { key: "already_watched_points", label: { en: "Opened before", pl: "Wcześniej otwarte", de: "Zuvor geöffnet" }, description: { en: "Gives a small boost to videos you opened but did not complete.", pl: "Lekko podbija filmy otwarte wcześniej, ale niedokończone.", de: "Gewichtet zuvor geöffnete, aber nicht beendete Videos leicht höher." }, min: 0, max: 50, step: 1, defaultValue: 10 },
  { key: "started_points", label: { en: "Started videos", pl: "Rozpoczęte filmy", de: "Begonnene Videos" }, description: { en: "Raises videos where you watched part of the material.", pl: "Podbija filmy, które były już częściowo oglądane.", de: "Hebt Videos an, von denen du bereits einen Teil gesehen hast." }, min: 0, max: 80, step: 1, defaultValue: 15 },
  { key: "recency_points", label: { en: "Freshness", pl: "Świeżość", de: "Aktualität" }, description: { en: "Raises newer videos so the list does not feel stale.", pl: "Podbija nowsze filmy, żeby lista nie była zbyt stara.", de: "Hebt neuere Videos an, damit die Liste aktuell bleibt." }, min: 0, max: 60, step: 1, defaultValue: 18 },
  { key: "random_pick_count", label: { en: "Variety near the top", pl: "Różnorodność na początku", de: "Abwechslung am Anfang" }, description: { en: "Mixes in a few strong suggestions so the list changes between reloads.", pl: "Miesza kilka mocnych propozycji, żeby lista zmieniała się po przeładowaniu.", de: "Mischt starke Vorschläge ein, damit die Liste beim Neuladen variiert." }, min: 0, max: 10, step: 1, defaultValue: 3 },
  { key: "high_pick_count", label: { en: "Top matches after variety", pl: "Najlepsze po miksie", de: "Beste Treffer nach dem Mix" }, description: { en: "How many strongest matches should follow the first mixed items.", pl: "Ile najmocniejszych dopasowań ma iść po pierwszych wymieszanych pozycjach.", de: "Wie viele stärkste Treffer nach den gemischten Einträgen folgen." }, min: 0, max: 20, step: 1, defaultValue: 6 },
];


export const RELATED_SETTINGS: PluginSettingSource[] = [
  {
    key: "related_source",
    type: "select",
    label: { en: "Suggestions about", pl: "Propozycje dotyczą", de: "Vorschläge zu" },
    description: {
      en: "The video: asked as nobody, YouTube answers about the subject — a documentary on IMAX is answered with two more on IMAX. You and the video: the panel youtube.com itself shows you, the video's own channel first and then your interests, which is what a browser gets by asking YouTube's own endpoint rather than reading the page. Your account alone: your habits, and much the same list whichever video you opened. An account is only ever asked with its own profile's cookies, never another's.",
      pl: "Film: zapytane anonimowo, YouTube odpowiada o temacie — dokument o IMAX-ie dostaje dwa kolejne o IMAX-ie. Ty i film: panel, który pokazuje sam youtube.com — najpierw kanał filmu, potem Twoje zainteresowania. Samo konto: Twoje nawyki, ale często ta sama lista niezależnie od filmu. Konto jest pytane wyłącznie ciasteczkami własnego profilu.",
      de: "Das Video: anonym gefragt, antwortet YouTube über das Thema — eine IMAX-Doku bekommt zwei weitere über IMAX. Du und das Video: das Panel, das youtube.com selbst zeigt — erst der Kanal des Videos, dann deine Interessen. Nur dein Konto: deine Gewohnheiten, aber oft dieselbe Liste, welches Video du auch öffnest. Ein Konto wird nur mit den Cookies des eigenen Profils gefragt.",
    },
    options: [
      { value: "video", label: { en: "The video", pl: "Filmu", de: "Das Video" } },
      { value: "personal", label: { en: "You and the video", pl: "Ciebie i filmu", de: "Dich und das Video" } },
      { value: "account", label: { en: "Your account alone", pl: "Samego konta", de: "Nur dein Konto" } },
    ],
    defaultValue: "video",
  },
  {
    key: "related_count",
    min: 0, max: 25, step: 1,
    label: { en: "Suggestions from YouTube", pl: "Propozycje z YouTube", de: "Vorschläge von YouTube" },
    description: {
      en: "How many of YouTube's own suggestions to show. They replace the library's list rather than lead it. 0 keeps the panel local.",
      pl: "Ile propozycji YouTube pokazać. Zastępują listę z biblioteki, zamiast ją poprzedzać. 0 zostawia panel lokalny.",
      de: "Wie viele YouTube-Vorschläge angezeigt werden. Sie ersetzen die Liste aus der Bibliothek, statt ihr voranzugehen. 0 lässt das Panel lokal.",
    },
    defaultValue: 15,
  },
  {
    key: "related_hide_known",
    type: "toggle",
    label: { en: "Only suggest videos you do not have", pl: "Proponuj tylko filmy, których nie masz", de: "Nur Videos vorschlagen, die du nicht hast" },
    description: {
      en: "Off by default: a suggestion is no worse for already being in the library, and opening it costs nothing when the video is already here. Turn it on to use the panel purely for discovery — the next suggestion takes the freed place.",
      pl: "Domyślnie wyłączone: propozycja nie jest gorsza przez to, że już ją masz, a jej otwarcie nic nie kosztuje, gdy film już tu jest. Włącz, aby panel służył tylko odkrywaniu — zwolnione miejsce zajmuje kolejna propozycja.",
      de: "Standardmäßig aus: Ein Vorschlag wird nicht schlechter, weil du ihn schon hast, und ihn zu öffnen kostet nichts, wenn das Video bereits da ist. Einschalten, um das Panel rein zum Entdecken zu nutzen — den frei gewordenen Platz nimmt der nächste Vorschlag ein.",
    },
    defaultValue: 0,
  },
];

export const PLUGINS: PluginManifest[] = [
  {
    id: "discovery",
    name: "Recommendations",
    version: "0.1.0",
    description: "Ranks eligible videos already stored in your local library.",
    route: "/recommendations",
    icon: "Sparkles",
    permissions: ["read:library", "read:history"],
  },
  {
    id: "social",
    name: "Social",
    version: "0.1.0",
    description: "A local social space where profiles share videos, react and comment together.",
    route: "/social",
    icon: "UsersRound",
    permissions: ["read:profiles", "read:library", "write:social"],
    settingsScope: "user",
  },
  {
    id: "search-suggest",
    name: "Search suggestions",
    version: "0.1.0",
    description: "Completes what you type in the search box using YouTube's suggestion service.",
    icon: "Search",
    permissions: ["send:search-query"],
  },
  {
    id: "tubearchivist",
    name: "TubeArchivist",
    version: "0.1.0",
    description: "Uses a TubeArchivist library as a local source in the existing feed.",
    icon: "Archive",
    permissions: ["read:tubearchivist", "write:watched", "read:library"],
    settingsScope: "global",
  },
  {
    id: "related",
    name: "Related videos",
    version: "0.1.0",
    description: "Shows the suggestions YouTube lists beside a video, read from the page its import already downloaded.",
    icon: "Shuffle",
    permissions: ["read:library"],
  },
];

export const PLUGIN_TEXT: Record<string, { name: LocalizedText; description: LocalizedText; permissions: Record<string, LocalizedText> }> = {
  discovery: {
    name: { en: "Recommendations", pl: "Rekomendacje", de: "Empfehlungen" },
    description: {
      en: "Ranks eligible videos already stored in your local library.",
      pl: "Porządkuje pasujące filmy, które są już zapisane w lokalnej bibliotece.",
      de: "Sortiert passende Videos, die bereits in deiner lokalen Bibliothek gespeichert sind.",
    },
    permissions: {
      "read:library": { en: "reads your local library", pl: "czyta lokalną bibliotekę", de: "liest deine lokale Bibliothek" },
      "read:history": { en: "uses your watch history", pl: "używa historii oglądania", de: "nutzt deinen Verlauf" },
    },
  },
  social: {
    name: { en: "Social", pl: "Social", de: "Social" },
    description: {
      en: "A local space where profiles share videos, use emoji reactions, mention each other and comment together.",
      pl: "Lokalne miejsce, w którym profile udostępniają filmy, reagują emoji, oznaczają się i wspólnie komentują.",
      de: "Ein lokaler Bereich, in dem Profile Videos teilen, mit Emojis reagieren, sich erwähnen und gemeinsam kommentieren.",
    },
    permissions: {
      "read:profiles": { en: "shows participating profile names and avatars", pl: "pokazuje nazwy i avatary uczestniczących profili", de: "zeigt Namen und Avatare teilnehmender Profile" },
      "read:library": { en: "reads videos from the local library", pl: "czyta filmy z lokalnej biblioteki", de: "liest Videos aus der lokalen Bibliothek" },
      "write:social": { en: "stores posts, reactions, mentions and comments locally", pl: "zapisuje lokalnie posty, reakcje, oznaczenia i komentarze", de: "speichert Beiträge, Reaktionen, Erwähnungen und Kommentare lokal" },
    },
  },
  related: {
    name: { en: "Related videos", pl: "Powiązane filmy", de: "Ähnliche Videos" },
    description: {
      en: "Shows the suggestions YouTube lists beside a video, read from the page its import already downloaded.",
      pl: "Pokazuje propozycje, które YouTube wyświetla obok filmu — odczytane ze strony pobranej już przy imporcie.",
      de: "Zeigt die Vorschläge, die YouTube neben einem Video listet — gelesen aus der Seite, die der Import ohnehin geladen hat.",
    },
    permissions: {
      "read:library": {
        en: "reads the videos and channels already in your library",
        pl: "odczytuje filmy i kanały, które już masz w bibliotece",
        de: "liest die Videos und Kanäle, die bereits in deiner Bibliothek sind",
      },
    },
  },
  "search-suggest": {
    name: { en: "Search suggestions", pl: "Podpowiedzi wyszukiwania", de: "Suchvorschläge" },
    description: {
      en: "Completes what you type in the search box using YouTube's suggestion service.",
      pl: "Uzupełnia tekst wpisywany w polu wyszukiwania, korzystając z usługi podpowiedzi YouTube.",
      de: "Vervollständigt die Eingabe im Suchfeld über den Vorschlagsdienst von YouTube.",
    },
    permissions: {
      "send:search-query": {
        en: "sends what you type to YouTube to fetch completions",
        pl: "wysyła wpisywany tekst do YouTube, aby pobrać podpowiedzi",
        de: "sendet deine Eingabe an YouTube, um Vervollständigungen zu holen",
      },
    },
  },
  tubearchivist: {
    name: { en: "TubeArchivist", pl: "TubeArchivist", de: "TubeArchivist" },
    description: {
      en: "Adds archived videos directly to the main feed and plays their local media.",
      pl: "Dodaje zarchiwizowane filmy bezpośrednio do głównego feedu i odtwarza lokalne pliki.",
      de: "Fügt archivierte Videos direkt zum Hauptfeed hinzu und spielt lokale Medien ab.",
    },
    permissions: {
      "read:tubearchivist": { en: "reads your TubeArchivist catalog and comments", pl: "czyta katalog i komentarze TubeArchivist", de: "liest den TubeArchivist-Katalog und Kommentare" },
      "write:watched": { en: "marks completed videos watched in TubeArchivist", pl: "oznacza ukończone filmy jako obejrzane w TubeArchivist", de: "markiert abgeschlossene Videos in TubeArchivist als gesehen" },
      "read:library": { en: "adds archived videos to the local feed", pl: "dodaje zarchiwizowane filmy do lokalnego feedu", de: "fügt archivierte Videos zum lokalen Feed hinzu" },
    },
  },
};
