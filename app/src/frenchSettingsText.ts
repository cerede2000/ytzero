/**
 * French for the setting labels the API hands out already translated.
 *
 * `DOWNLOADS_SETTINGS` carries its own `{ en, pl, de }` for every label,
 * description and option, and `localizeDownloadSettings` picks one of the
 * three. A language it does not know gets English, which is how the whole
 * downloads configuration stayed in English under a French interface.
 *
 * Adding `fr` to sixty-odd objects would mean editing a file this fork
 * rebases onto upstream constantly, so French sits beside it instead, keyed
 * by the English that is already there. `frenchSettingsText.test.ts` fails if
 * upstream rewords one of these, which is the only way this shape can go
 * quietly wrong.
 */
const FRENCH: Record<string, string> = {
  "Download schedule": "Plage horaire de téléchargement",
  "Days": "Jours",
  "Video quality": "Qualité vidéo",
  "Maximum resolution to download.": "Résolution maximale téléchargée.",
  "Best available": "La meilleure disponible",
  "Compatibility with older devices": "Compatibilité avec les appareils anciens",
  "Future downloads use MP4 with H.264 video and AAC audio. This works on more older devices, but usually limits quality to 1080p and may use more space. Existing files are not converted.": "Les prochains téléchargements utiliseront du MP4 avec vidéo H.264 et audio AAC. Cela fonctionne sur davantage d'appareils anciens, mais limite généralement la qualité à 1080p et peut occuper plus d'espace. Les fichiers déjà présents ne sont pas convertis.",
  "Opening a video": "À l'ouverture d'une vidéo",
  "What happens when you open a video that isn't downloaded yet.": "Ce qui se passe quand vous ouvrez une vidéo qui n'est pas encore téléchargée.",
  "Play from YouTube": "Lire depuis YouTube",
  "Ask every time": "Demander à chaque fois",
  "Always wait for the download": "Toujours attendre le téléchargement",
  "Pre-download the next playlist video": "Pré-télécharger la vidéo suivante de la playlist",
  "While a playlist video is playing, queue only the next video for download.": "Pendant la lecture d'une vidéo d'une playlist, ne met en file que la vidéo suivante.",
  "Filename template": "Modèle de nom de fichier",
  "Tokens: {channel} {title} {id} {date} {year} {month} {day} {channel_id} {playlist}. {playlist} is set only for downloads queued from a playlist. \"/\" creates folders, e.g. {playlist}/{date} - {title} [{id}].": "Variables : {channel} {title} {id} {date} {year} {month} {day} {channel_id} {playlist}. {playlist} n'est renseigné que pour les téléchargements lancés depuis une playlist. « / » crée des dossiers, par exemple {playlist}/{date} - {title} [{id}].",
  "Save thumbnail": "Enregistrer la miniature",
  "Stores the video thumbnail next to the file.": "Enregistre la miniature de la vidéo à côté du fichier.",
  "Embed metadata": "Intégrer les métadonnées",
  "Writes title, chapters and description into the video file.": "Écrit le titre, les chapitres et la description dans le fichier vidéo.",
  "Save info.json": "Enregistrer info.json",
  "Stores yt-dlp's full metadata file next to the video.": "Enregistre le fichier de métadonnées complet de yt-dlp à côté de la vidéo.",
  "Save NFO file": "Enregistrer un fichier NFO",
  "Kodi/Jellyfin-style metadata (title, plot, channel, date).": "Métadonnées au format Kodi/Jellyfin (titre, résumé, chaîne, date).",
  "Download subtitles": "Télécharger les sous-titres",
  "Saves the video's subtitles next to the file.": "Enregistre les sous-titres de la vidéo à côté du fichier.",
  "Include auto-generated subtitles": "Inclure les sous-titres générés automatiquement",
  "Also downloads YouTube's auto-generated captions.": "Télécharge aussi les sous-titres générés automatiquement par YouTube.",
  "Subtitle languages": "Langues des sous-titres",
  "Languages downloaded with every video (when subtitles are enabled).": "Langues téléchargées avec chaque vidéo (quand les sous-titres sont activés).",
  "Progress bar on thumbnails": "Barre de progression sur les miniatures",
  "Shows a thin download progress bar on top of video thumbnails.": "Affiche une fine barre de progression du téléchargement sur les miniatures.",
  "Download scheduled videos": "Télécharger les vidéos planifiées",
  "Videos placed on a watch-later bucket are fetched automatically.": "Les vidéos placées dans « à voir plus tard » sont téléchargées automatiquement.",
  "Download new uploads": "Télécharger les nouvelles publications",
  "Fresh videos from followed channels are fetched as they appear.": "Les nouvelles vidéos des chaînes suivies sont téléchargées dès leur parution.",
  "Download past live streams": "Télécharger les directs terminés",
  "Allows completed live stream archives to be picked up by Watch later and automatic download rules. Active and upcoming streams are still skipped.": "Permet aux archives de directs terminés d'être prises en compte par « à voir plus tard » et par les règles de téléchargement automatique. Les directs en cours ou à venir restent ignorés.",
  "New upload window (hours)": "Fenêtre des nouvelles publications (heures)",
  "Only uploads younger than this are auto-downloaded from the feed.": "Seules les publications plus récentes que cette valeur sont téléchargées automatiquement depuis le fil.",
  "Minimum length for new uploads (minutes)": "Durée minimale des nouvelles publications (minutes)",
  "Skips shorter videos when automatically downloading new uploads. Set to 0 to disable the global threshold; a channel can override it.": "Ignore les vidéos plus courtes lors du téléchargement automatique des nouvelles publications. Mettez 0 pour désactiver ce seuil global ; une chaîne peut le redéfinir.",
  "Include Shorts": "Inclure les Shorts",
  "Allow automatic downloads of Shorts, including videos in Watch later. Manual downloads are unaffected.": "Autorise le téléchargement automatique des Shorts, y compris ceux placés dans « à voir plus tard ». Les téléchargements manuels ne sont pas concernés.",
  "Only starts queued downloads during the selected window.": "Ne démarre les téléchargements en file que pendant la plage sélectionnée.",
  "Days on which the download window starts.": "Jours où la plage de téléchargement commence.",
  "Start": "Début",
  "Local start time.": "Heure de début locale.",
  "End": "Fin",
  "Local end time.": "Heure de fin locale.",
  "Keep files for (days)": "Conserver les fichiers (jours)",
  "Downloads are removed this many days after they finished.": "Les téléchargements sont supprimés ce nombre de jours après leur fin.",
  "Remove after watching": "Supprimer après visionnage",
  "Once watched, the file is removed after a grace period.": "Une fois la vidéo vue, le fichier est supprimé après un délai de grâce.",
  "Watched grace period (hours)": "Délai de grâce après visionnage (heures)",
  "How long a watched file sticks around before removal.": "Combien de temps un fichier déjà vu est conservé avant suppression.",
  "Protect liked videos": "Protéger les vidéos aimées",
  "Liked videos are never auto-removed by retention or the storage cap.": "Les vidéos aimées ne sont jamais supprimées automatiquement par la rétention ou le plafond de stockage.",
  "Storage cap (GB)": "Plafond de stockage (Go)",
  "Above this the oldest unprotected downloads are removed first.": "Au-delà, les téléchargements non protégés les plus anciens sont supprimés en premier.",
  "Stream while downloading (experimental)": "Lire pendant le téléchargement (expérimental)",
  "HIGHLY EXPERIMENTAL. Plays a not-yet-downloaded video through direct HLS while the normal download continues in the background. Seeking is immediately available across the whole video. Sources without compatible MP4 indexes fall back to on-demand ffmpeg processing. The completed download becomes available as a local file. H.264 only, so quality is capped at ~1080p.": "TRÈS EXPÉRIMENTAL. Lit une vidéo pas encore téléchargée en HLS direct pendant que le téléchargement normal se poursuit en arrière-plan. Le déplacement dans la vidéo est immédiatement possible sur toute sa durée. Les sources sans index MP4 compatible passent par un traitement ffmpeg à la demande. Une fois terminé, le téléchargement devient un fichier local. H.264 uniquement, donc la qualité plafonne autour de 1080p.",};

/** The French for a setting string, when there is one. */
export function frenchSettingText(english: string): string {
  return FRENCH[english] ?? english;
}

/** Every English string this overlay claims to translate, for the drift test. */
export function settingOverlayKeys(): string[] {
  return Object.keys(FRENCH);
}
