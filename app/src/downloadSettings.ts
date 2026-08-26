import { SUBTITLE_LANGUAGES } from "./subtitleLanguages";
import type { BaseLocalizedText } from "./serverMessages";
import { localizeServerMessage } from "./serverMessages";

export type DownloadSettingValue = number | string;
export type DownloadSettingType = "slider" | "select" | "toggle" | "text" | "time" | "multiselect";
type LocalizedText = BaseLocalizedText;

export interface DownloadSettingSource {
  key: string;
  label: LocalizedText;
  description: LocalizedText;
  type?: DownloadSettingType;
  min?: number;
  max?: number;
  step?: number;
  options?: { value: string; label: LocalizedText }[];
  defaultValue: DownloadSettingValue;
}

export interface DownloadSettingDefinition {
  key: string;
  label: string;
  description: string;
  type: DownloadSettingType;
  min?: number;
  max?: number;
  step?: number;
  options?: { value: string; label: string }[];
  defaultValue: DownloadSettingValue;
}

export const DL_DEFAULTS = {
  quality: "1080",
  compatible_format: 0,
  watch_source_mode: "youtube",
  default_player: "youtube",
  prefetch_next_playlist_video: 0,
  // HEAVILY EXPERIMENTAL: play a not-yet-downloaded video through a direct,
  // indexed HLS presentation while the normal download continues in the
  // background. Sources without compatible fMP4 indexes use an ffmpeg fallback.
  // Off by default.
  experimental_streaming: 0,
  // Filename template, rendered server-side from the DB (so {channel} honours
  // the custom channel name). "/" creates subdirectories; the extension is
  // appended automatically; a missing {id} is added as " [id]" to keep files
  // unique and trackable.
  // Playlist bulk downloads land in an optional playlist folder. For every
  // other source {playlist} is empty and the renderer removes that segment.
  output_template: "{playlist}/{id}",
  write_thumbnail: 0,
  embed_metadata: 0,
  write_info_json: 0,
  write_nfo: 0,
  write_subs: 0,
  write_auto_subs: 0,
  sub_langs: "en",
  thumb_progress: 1,
  download_scheduled: 1,
  download_feed: 0,
  download_live_archives: 0,
  feed_max_age_hours: 48,
  feed_min_duration_minutes: 0,
  download_shorts: 0,
  download_schedule_enabled: 0,
  download_schedule_days: "0,1,2,3,4,5,6",
  download_schedule_start: "23:00",
  download_schedule_end: "07:00",
  keep_downloads: 0,
  retention_days: 14,
  delete_watched: 1,
  delete_watched_hours: 24,
  keep_liked: 1,
  max_storage_gb: 25,
} as const;

export type DlSettings = { [K in keyof typeof DL_DEFAULTS]: (typeof DL_DEFAULTS)[K] extends number ? number : string };

export const DOWNLOADS_SETTINGS: DownloadSettingSource[] = [
  {
    key: "quality",
    type: "select",
    label: { en: "Video quality", pl: "Jakość wideo", de: "Videoqualität", fr: "Qualité vidéo" },
    description: { en: "Maximum resolution to download.", pl: "Maksymalna pobierana rozdzielczość.", de: "Maximale Auflösung beim Herunterladen.", fr: "Résolution maximale téléchargée." },
    options: [
      { value: "best", label: { en: "Best available", pl: "Najlepsza dostępna", de: "Beste verfügbare", fr: "La meilleure disponible" } },
      { value: "1440", label: { en: "1440p", pl: "1440p", de: "1440p" } },
      { value: "1080", label: { en: "1080p", pl: "1080p", de: "1080p" } },
      { value: "720", label: { en: "720p", pl: "720p", de: "720p" } },
      { value: "480", label: { en: "480p", pl: "480p", de: "480p" } },
    ],
    defaultValue: DL_DEFAULTS.quality,
  },
  { key: "compatible_format", type: "toggle", label: { en: "Compatibility with older devices", pl: "Zgodność ze starszymi urządzeniami", de: "Kompatibilität mit älteren Geräten", fr: "Compatibilité avec les appareils anciens" }, description: { en: "Future downloads use MP4 with H.264 video and AAC audio. This works on more older devices, but usually limits quality to 1080p and may use more space. Existing files are not converted.", pl: "Przyszłe pobrania użyją MP4 z obrazem H.264 i dźwiękiem AAC. Działa to na większej liczbie starszych urządzeń, ale zwykle ogranicza jakość do 1080p i może zajmować więcej miejsca. Istniejące pliki nie są konwertowane.", de: "Künftige Downloads verwenden MP4 mit H.264-Video und AAC-Audio. Das funktioniert auf mehr älteren Geräten, begrenzt die Qualität aber meist auf 1080p und kann mehr Speicher belegen. Vorhandene Dateien werden nicht konvertiert.", fr: "Les prochains téléchargements utiliseront du MP4 avec vidéo H.264 et audio AAC. Cela fonctionne sur davantage d'appareils anciens, mais limite généralement la qualité à 1080p et peut occuper plus d'espace. Les fichiers déjà présents ne sont pas convertis." }, defaultValue: DL_DEFAULTS.compatible_format },
  {
    key: "watch_source_mode",
    type: "select",
    label: { en: "Opening a video", pl: "Wejście na film", de: "Video öffnen", fr: "À l'ouverture d'une vidéo" },
    description: { en: "What happens when you open a video that isn't downloaded yet.", pl: "Co ma się dziać, gdy otwierasz film, który nie jest jeszcze pobrany.", de: "Was passiert, wenn du ein noch nicht heruntergeladenes Video öffnest.", fr: "Ce qui se passe quand vous ouvrez une vidéo qui n'est pas encore téléchargée." },
    options: [
      { value: "youtube", label: { en: "Play from YouTube", pl: "Odtwarzaj z YouTube", de: "Von YouTube abspielen", fr: "Lire depuis YouTube" } },
      { value: "ask", label: { en: "Ask every time", pl: "Daj wybór", de: "Jedes Mal fragen", fr: "Demander à chaque fois" } },
      { value: "download", label: { en: "Always wait for the download", pl: "Zawsze czekaj na pobranie", de: "Immer auf den Download warten", fr: "Toujours attendre le téléchargement" } },
    ],
    defaultValue: DL_DEFAULTS.watch_source_mode,
  },
  {
    key: "default_player",
    type: "select",
    label: { en: "Default player", pl: "Domyślny odtwarzacz", de: "Standardplayer", fr: "Lecteur par défaut" },
    description: { en: "YouTube uses the embedded player. Direct stream plays a progressive MP4 without saving it; it is usually limited to 360p or 720p.", pl: "YouTube używa osadzonego odtwarzacza. Bezpośredni stream odtwarza progressive MP4 bez zapisu; zwykle jest ograniczony do 360p lub 720p.", de: "YouTube verwendet den eingebetteten Player. Direktstream spielt eine progressive MP4 ohne Speichern ab und ist meist auf 360p oder 720p begrenzt.", fr: "YouTube utilise le lecteur intégré. Le flux direct lit un MP4 progressif sans l'enregistrer ; il plafonne généralement à 360p ou 720p." },
    options: [
      { value: "youtube", label: { en: "YouTube embed", pl: "YouTube embed", de: "YouTube-Einbettung", fr: "Lecteur intégré YouTube" } },
      { value: "direct", label: { en: "Direct stream", pl: "Bezpośredni stream", de: "Direktstream", fr: "Flux direct" } },
    ],
    defaultValue: DL_DEFAULTS.default_player,
  },
  {
    key: "prefetch_next_playlist_video",
    type: "toggle",
    label: { en: "Pre-download the next playlist video", pl: "Pobieraj następny film z playlisty z wyprzedzeniem", de: "Nächstes Playlist-Video vorab herunterladen", fr: "Pré-télécharger la vidéo suivante de la playlist" },
    description: {
      en: "While a playlist video is playing, queue only the next video for download.",
      pl: "Podczas oglądania filmu z playlisty dodaje do pobierania tylko następny film.",
      de: "Während ein Playlist-Video läuft, wird nur das nächste Video zum Download vorgemerkt.", fr: "Pendant la lecture d'une vidéo d'une playlist, ne met en file que la vidéo suivante." },
    defaultValue: DL_DEFAULTS.prefetch_next_playlist_video,
  },
  {
    key: "output_template",
    type: "text",
    label: { en: "Filename template", pl: "Szablon nazwy pliku", de: "Dateinamen-Vorlage", fr: "Modèle de nom de fichier" },
    description: {
      en: "Tokens: {channel} {title} {id} {date} {year} {month} {day} {channel_id} {playlist}. {playlist} is set only for downloads queued from a playlist. \"/\" creates folders, e.g. {playlist}/{date} - {title} [{id}].",
      pl: "Znaczniki: {channel} {title} {id} {date} {year} {month} {day} {channel_id} {playlist}. {playlist} jest ustawione tylko dla pobrań zakolejkowanych z playlisty. „/” tworzy foldery, np. {playlist}/{date} - {title} [{id}].",
      de: "Platzhalter: {channel} {title} {id} {date} {year} {month} {day} {channel_id} {playlist}. {playlist} wird nur bei Downloads aus einer Playlist gesetzt. „/“ erzeugt Ordner, z. B. {playlist}/{date} - {title} [{id}].",
      fr: "Variables : {channel} {title} {id} {date} {year} {month} {day} {channel_id} {playlist}. {playlist} n'est renseigné que pour les téléchargements lancés depuis une playlist. « / » crée des dossiers, par exemple {playlist}/{date} - {title} [{id}].",
    },
    defaultValue: DL_DEFAULTS.output_template,
  },
  {
    key: "write_thumbnail",
    type: "toggle",
    label: { en: "Save thumbnail", pl: "Zapisuj miniaturkę", de: "Vorschaubild speichern", fr: "Enregistrer la miniature" },
    description: { en: "Stores the video thumbnail next to the file.", pl: "Zapisuje miniaturkę filmu obok pliku.", de: "Speichert das Vorschaubild neben der Datei.", fr: "Enregistre la miniature de la vidéo à côté du fichier." },
    defaultValue: DL_DEFAULTS.write_thumbnail,
  },
  {
    key: "embed_metadata",
    type: "toggle",
    label: { en: "Embed metadata", pl: "Osadzaj metadane", de: "Metadaten einbetten", fr: "Intégrer les métadonnées" },
    description: { en: "Writes title, chapters and description into the video file.", pl: "Wpisuje tytuł, rozdziały i opis do pliku wideo.", de: "Schreibt Titel, Kapitel und Beschreibung in die Videodatei.", fr: "Écrit le titre, les chapitres et la description dans le fichier vidéo." },
    defaultValue: DL_DEFAULTS.embed_metadata,
  },
  {
    key: "write_info_json",
    type: "toggle",
    label: { en: "Save info.json", pl: "Zapisuj info.json", de: "info.json speichern", fr: "Enregistrer info.json" },
    description: { en: "Stores yt-dlp's full metadata file next to the video.", pl: "Zapisuje pełny plik metadanych yt-dlp obok filmu.", de: "Speichert die vollständige yt-dlp-Metadatendatei neben dem Video.", fr: "Enregistre le fichier de métadonnées complet de yt-dlp à côté de la vidéo." },
    defaultValue: DL_DEFAULTS.write_info_json,
  },
  {
    key: "write_nfo",
    type: "toggle",
    label: { en: "Save NFO file", pl: "Zapisuj plik NFO", de: "NFO-Datei speichern", fr: "Enregistrer un fichier NFO" },
    description: { en: "Kodi/Jellyfin-style metadata (title, plot, channel, date).", pl: "Metadane w stylu Kodi/Jellyfin (tytuł, opis, kanał, data).", de: "Metadaten im Kodi/Jellyfin-Stil (Titel, Handlung, Kanal, Datum).", fr: "Métadonnées au format Kodi/Jellyfin (titre, résumé, chaîne, date)." },
    defaultValue: DL_DEFAULTS.write_nfo,
  },
  {
    key: "write_subs",
    type: "toggle",
    label: { en: "Download subtitles", pl: "Pobieraj napisy", de: "Untertitel laden", fr: "Télécharger les sous-titres" },
    description: { en: "Saves the video's subtitles next to the file.", pl: "Zapisuje napisy filmu obok pliku.", de: "Speichert die Untertitel des Videos neben der Datei.", fr: "Enregistre les sous-titres de la vidéo à côté du fichier." },
    defaultValue: DL_DEFAULTS.write_subs,
  },
  {
    key: "write_auto_subs",
    type: "toggle",
    label: { en: "Include auto-generated subtitles", pl: "Także napisy automatyczne", de: "Auch automatische Untertitel", fr: "Inclure les sous-titres générés automatiquement" },
    description: { en: "Also downloads YouTube's auto-generated captions.", pl: "Pobiera też napisy generowane automatycznie przez YouTube.", de: "Lädt auch automatisch generierte YouTube-Untertitel.", fr: "Télécharge aussi les sous-titres générés automatiquement par YouTube." },
    defaultValue: DL_DEFAULTS.write_auto_subs,
  },
  {
    key: "sub_langs",
    type: "multiselect",
    label: { en: "Subtitle languages", pl: "Języki napisów", de: "Untertitelsprachen", fr: "Langues des sous-titres" },
    description: { en: "Languages downloaded with every video (when subtitles are enabled).", pl: "Języki pobierane z każdym filmem (gdy napisy są włączone).", de: "Sprachen, die mit jedem Video geladen werden (wenn Untertitel aktiv sind).", fr: "Langues téléchargées avec chaque vidéo (quand les sous-titres sont activés)." },
    options: SUBTITLE_LANGUAGES.map((lang) => ({ value: lang.code, label: { en: lang.label, pl: lang.label, de: lang.label } })),
    defaultValue: DL_DEFAULTS.sub_langs,
  },
  {
    key: "thumb_progress",
    type: "toggle",
    label: { en: "Progress bar on thumbnails", pl: "Pasek pobierania na miniaturkach", de: "Fortschrittsbalken auf Vorschaubildern", fr: "Barre de progression sur les miniatures" },
    description: { en: "Shows a thin download progress bar on top of video thumbnails.", pl: "Pokazuje cienki pasek postępu pobierania na górze miniaturek.", de: "Zeigt einen dünnen Download-Fortschrittsbalken oben auf Vorschaubildern.", fr: "Affiche une fine barre de progression du téléchargement sur les miniatures." },
    defaultValue: DL_DEFAULTS.thumb_progress,
  },
  {
    key: "download_scheduled",
    type: "toggle",
    label: { en: "Download scheduled videos", pl: "Pobieraj zaplanowane", de: "Geplante Videos laden", fr: "Télécharger les vidéos planifiées" },
    description: { en: "Videos placed on a watch-later bucket are fetched automatically.", pl: "Filmy dodane do „Do obejrzenia” pobierają się automatycznie.", de: "Videos auf einem Später-ansehen-Slot werden automatisch geladen.", fr: "Les vidéos placées dans « à voir plus tard » sont téléchargées automatiquement." },
    defaultValue: DL_DEFAULTS.download_scheduled,
  },
  {
    key: "download_feed",
    type: "toggle",
    label: { en: "Download new uploads", pl: "Pobieraj nowe z subskrypcji", de: "Neue Uploads laden", fr: "Télécharger les nouvelles publications" },
    description: { en: "Fresh videos from followed channels are fetched as they appear.", pl: "Świeże filmy z obserwowanych kanałów pobierają się od razu po publikacji.", de: "Frische Videos abonnierter Kanäle werden direkt nach Erscheinen geladen.", fr: "Les nouvelles vidéos des chaînes suivies sont téléchargées dès leur parution." },
    defaultValue: DL_DEFAULTS.download_feed,
  },
  {
    key: "download_live_archives",
    type: "toggle",
    label: { en: "Download past live streams", pl: "Pobieraj zakończone transmisje", de: "Beendete Livestreams laden", fr: "Télécharger les directs terminés" },
    description: {
      en: "Allows completed live stream archives to be picked up by Watch later and automatic download rules. Active and upcoming streams are still skipped.",
      pl: "Pozwala pobierać archiwa zakończonych transmisji z „Do obejrzenia” i reguł automatycznych. Trwające i nadchodzące transmisje nadal są pomijane.",
      de: "Erlaubt automatische Downloads beendeter Livestream-Archive aus Später ansehen und Download-Regeln. Laufende und bevorstehende Streams werden weiterhin übersprungen.", fr: "Permet aux archives de directs terminés d'être prises en compte par « à voir plus tard » et par les règles de téléchargement automatique. Les directs en cours ou à venir restent ignorés." },
    defaultValue: DL_DEFAULTS.download_live_archives,
  },
  {
    key: "feed_max_age_hours",
    type: "slider",
    label: { en: "New upload window (hours)", pl: "Okno nowości (godziny)", de: "Zeitfenster für Neues (Stunden)", fr: "Fenêtre des nouvelles publications (heures)" },
    description: { en: "Only uploads younger than this are auto-downloaded from the feed.", pl: "Z feedu pobierają się tylko filmy młodsze niż tyle godzin.", de: "Nur Uploads, die jünger sind, werden automatisch geladen.", fr: "Seules les publications plus récentes que cette valeur sont téléchargées automatiquement depuis le fil." },
    min: 6, max: 168, step: 6,
    defaultValue: DL_DEFAULTS.feed_max_age_hours,
  },
  {
    key: "feed_min_duration_minutes",
    type: "slider",
    label: { en: "Minimum length for new uploads (minutes)", pl: "Minimalna długość nowych filmów (minuty)", de: "Mindestlänge neuer Uploads (Minuten)", fr: "Durée minimale des nouvelles publications (minutes)" },
    description: { en: "Skips shorter videos when automatically downloading new uploads. Set to 0 to disable the global threshold; a channel can override it.", pl: "Pomija krótsze filmy przy automatycznym pobieraniu nowych materiałów. Ustaw 0, aby wyłączyć globalny próg; kanał może go nadpisać.", de: "Überspringt kürzere Videos beim automatischen Herunterladen neuer Uploads. Bei 0 ist der globale Schwellenwert aus; Kanäle können ihn überschreiben.", fr: "Ignore les vidéos plus courtes lors du téléchargement automatique des nouvelles publications. Mettez 0 pour désactiver ce seuil global ; une chaîne peut le redéfinir." },
    min: 0, max: 60, step: 1,
    defaultValue: DL_DEFAULTS.feed_min_duration_minutes,
  },
  {
    key: "download_shorts",
    type: "toggle",
    label: { en: "Include Shorts", pl: "Pobieraj Shorts", de: "Shorts einschließen", fr: "Inclure les Shorts" },
    description: { en: "Allow automatic downloads of Shorts, including videos in Watch later. Manual downloads are unaffected.", pl: "Zezwalaj na automatyczne pobieranie Shorts, także filmów z „Do obejrzenia”. Ręczne pobieranie pozostaje bez zmian.", de: "Automatische Downloads von Shorts erlauben, auch aus Später ansehen. Manuelle Downloads bleiben unverändert.", fr: "Autorise le téléchargement automatique des Shorts, y compris ceux placés dans « à voir plus tard ». Les téléchargements manuels ne sont pas concernés." },
    defaultValue: DL_DEFAULTS.download_shorts,
  },
  {
    key: "download_schedule_enabled",
    type: "toggle",
    label: { en: "Download schedule", pl: "Harmonogram pobierania", de: "Download-Zeitplan", fr: "Plage horaire de téléchargement" },
    description: { en: "Only starts queued downloads during the selected window.", pl: "Uruchamia pobieranie z kolejki tylko w wybranym oknie.", de: "Startet Downloads aus der Warteschlange nur im ausgewählten Zeitfenster.", fr: "Ne démarre les téléchargements en file que pendant la plage sélectionnée." },
    defaultValue: DL_DEFAULTS.download_schedule_enabled,
  },
  {
    key: "download_schedule_days",
    type: "multiselect",
    label: { en: "Days", pl: "Dni", de: "Tage", fr: "Jours" },
    description: { en: "Days on which the download window starts.", pl: "Dni, w których rozpoczyna się okno pobierania.", de: "Tage, an denen das Download-Zeitfenster beginnt.", fr: "Jours où la plage de téléchargement commence." },
    options: Array.from({ length: 7 }, (_, day) => ({ value: String(day), label: { en: String(day), pl: String(day), de: String(day) } })),
    defaultValue: DL_DEFAULTS.download_schedule_days,
  },
  {
    key: "download_schedule_start",
    type: "time",
    label: { en: "Start", pl: "Początek", de: "Start", fr: "Début" },
    description: { en: "Local start time.", pl: "Lokalna godzina rozpoczęcia.", de: "Lokale Startzeit.", fr: "Heure de début locale." },
    defaultValue: DL_DEFAULTS.download_schedule_start,
  },
  {
    key: "download_schedule_end",
    type: "time",
    label: { en: "End", pl: "Koniec", de: "Ende", fr: "Fin" },
    description: { en: "Local end time.", pl: "Lokalna godzina zakończenia.", de: "Lokale Endzeit.", fr: "Heure de fin locale." },
    defaultValue: DL_DEFAULTS.download_schedule_end,
  },
  {
    key: "keep_downloads",
    type: "toggle",
    label: { en: "Keep downloads", pl: "Zachowuj pobrane pliki", de: "Downloads behalten", fr: "Conserver les téléchargements" },
    description: { en: "Disables removal based on file age and watched status for this profile. The shared storage cap can still remove unprotected downloads.", pl: "Wyłącza dla tego profilu usuwanie według wieku i po obejrzeniu. Wspólny limit miejsca nadal może usuwać najstarsze niechronione pliki.", de: "Deaktiviert für dieses Profil das Löschen nach Dateialter und nach dem Ansehen. Das gemeinsame Speicherlimit kann weiterhin ungeschützte Downloads entfernen.", fr: "Désactive la suppression selon l'âge du fichier et l'état de lecture pour ce profil. Le plafond de stockage partagé peut encore supprimer les téléchargements non protégés." },
    defaultValue: DL_DEFAULTS.keep_downloads,
  },
  {
    key: "retention_days",
    type: "slider",
    label: { en: "Keep files for (days)", pl: "Przechowuj pliki (dni)", de: "Dateien behalten (Tage)", fr: "Conserver les fichiers (jours)" },
    description: { en: "Downloads are removed this many days after they finished.", pl: "Pobrane pliki są usuwane po tylu dniach od pobrania.", de: "Downloads werden so viele Tage nach Abschluss entfernt.", fr: "Les téléchargements sont supprimés ce nombre de jours après leur fin." },
    min: 1, max: 90, step: 1,
    defaultValue: DL_DEFAULTS.retention_days,
  },
  {
    key: "delete_watched",
    type: "toggle",
    label: { en: "Remove after watching", pl: "Usuwaj obejrzane", de: "Nach dem Ansehen entfernen", fr: "Supprimer après visionnage" },
    description: { en: "Once watched, the file is removed after a grace period.", pl: "Po obejrzeniu plik znika po okresie karencji.", de: "Nach dem Ansehen wird die Datei nach einer Schonfrist entfernt.", fr: "Une fois la vidéo vue, le fichier est supprimé après un délai de grâce." },
    defaultValue: DL_DEFAULTS.delete_watched,
  },
  {
    key: "delete_watched_hours",
    type: "slider",
    label: { en: "Watched grace period (hours)", pl: "Karencja po obejrzeniu (godziny)", de: "Schonfrist nach dem Ansehen (Stunden)", fr: "Délai de grâce après visionnage (heures)" },
    description: { en: "How long a watched file sticks around before removal.", pl: "Ile godzin obejrzany plik czeka, zanim zostanie usunięty.", de: "Wie lange eine angesehene Datei vor der Entfernung erhalten bleibt.", fr: "Combien de temps un fichier déjà vu est conservé avant suppression." },
    min: 1, max: 168, step: 1,
    defaultValue: DL_DEFAULTS.delete_watched_hours,
  },
  {
    key: "keep_liked",
    type: "toggle",
    label: { en: "Protect liked videos", pl: "Chroń polubione", de: "Favorisierte schützen", fr: "Protéger les vidéos aimées" },
    description: { en: "Liked videos are never auto-removed by retention or the storage cap.", pl: "Polubione filmy nigdy nie są usuwane automatycznie — ani przez retencję, ani przez limit dysku.", de: "Favorisierte Videos werden nie automatisch entfernt — weder durch Aufbewahrung noch durch das Speicherlimit.", fr: "Les vidéos aimées ne sont jamais supprimées automatiquement par la rétention ou le plafond de stockage." },
    defaultValue: DL_DEFAULTS.keep_liked,
  },
  {
    key: "max_storage_gb",
    type: "slider",
    label: { en: "Storage cap", pl: "Limit dysku", de: "Speicherlimit", fr: "Plafond de stockage" },
    description: { en: "Above this the oldest unprotected downloads are removed first. Maximum: 128 TB.", pl: "Po przekroczeniu najstarsze niechronione pliki usuwane są w pierwszej kolejności. Maksimum: 128 TB.", de: "Darüber werden die ältesten ungeschützten Downloads zuerst entfernt. Maximum: 128 TB.", fr: "Au-delà, les téléchargements non protégés les plus anciens sont supprimés en premier. Maximum : 128 To." },
    min: 1, max: 131_072, step: 1,
    defaultValue: DL_DEFAULTS.max_storage_gb,
  },
  {
    key: "experimental_streaming",
    type: "toggle",
    label: { en: "Stream while downloading (experimental)", pl: "Streaming w trakcie pobierania (eksperymentalne)", de: "Streamen während des Downloads (experimentell)", fr: "Lire pendant le téléchargement (expérimental)" },
    description: {
      en: "HIGHLY EXPERIMENTAL. Plays a not-yet-downloaded video through direct HLS while the normal download continues in the background. Seeking is immediately available across the whole video. Sources without compatible MP4 indexes fall back to on-demand ffmpeg processing. The completed download becomes available as a local file. H.264 only, so quality is capped at ~1080p.",
      pl: "MOCNO EKSPERYMENTALNE. Odtwarza niepobrany film bezpośrednio przez HLS, podczas gdy zwykłe pobieranie trwa w tle. Możesz od razu przewijać po całym filmie. Materiały bez kompatybilnego indeksu MP4 korzystają awaryjnie z przetwarzania przez ffmpeg na żądanie. Ukończone pobranie staje się dostępne jako plik lokalny. Tylko H.264, więc jakość jest ograniczona do ~1080p.",
      de: "HOCHEXPERIMENTELL. Spielt ein noch nicht heruntergeladenes Video direkt über HLS ab, während der normale Download im Hintergrund weiterläuft. Das gesamte Video ist sofort durchsuchbar. Quellen ohne kompatiblen MP4-Index werden ersatzweise bei Bedarf mit ffmpeg verarbeitet. Der abgeschlossene Download wird als lokale Datei verfügbar. Nur H.264, daher ist die Qualität auf ~1080p begrenzt.", fr: "TRÈS EXPÉRIMENTAL. Lit une vidéo pas encore téléchargée en HLS direct pendant que le téléchargement normal se poursuit en arrière-plan. Le déplacement dans la vidéo est immédiatement possible sur toute sa durée. Les sources sans index MP4 compatible passent par un traitement ffmpeg à la demande. Une fois terminé, le téléchargement devient un fichier local. H.264 uniquement, donc la qualité plafonne autour de 1080p." },
    defaultValue: DL_DEFAULTS.experimental_streaming,
  },
];
// These values affect the one physical download store shared by all profiles.
// They remain instance-wide and may only be changed by an administrator; the
// remaining download preferences are stored per profile.
export const DOWNLOADS_ADMIN_SETTING_KEYS = new Set([
  "output_template",
  "write_thumbnail",
  "embed_metadata",
  "write_info_json",
  "write_nfo",
  "write_subs",
  "max_storage_gb",
]);

export function localizeDownloadSettings(language: string | null | undefined): DownloadSettingDefinition[] {
  return DOWNLOADS_SETTINGS.map((definition) => ({
    ...definition,
    type: definition.type ?? "slider",
    label: localizeServerMessage(definition.label, language),
    description: localizeServerMessage(definition.description, language),
    options: definition.options?.map((option) => ({ value: option.value, label: localizeServerMessage(option.label, language) })),
  }));
}
