/**
 * What the embedded player is told about captions.
 *
 * Omitting `cc_load_policy` is not the same as asking for captions to be off:
 * with nothing said, the embed restores whatever caption preference the
 * browser holds for YouTube, so a profile that turned captions off still got
 * them on every video. Saying 0 is what turns them off, and it has to be said
 * whenever they are not being asked for — by the profile, by the channel, or
 * by a channel that named a language.
 */
export interface EmbeddedCaptionVars {
  cc_load_policy: 0 | 1;
  cc_lang_pref?: string;
}

export function embeddedCaptionVars(captions: { defaultOn: boolean; language: string }): EmbeddedCaptionVars {
  return captions.defaultOn && captions.language
    ? { cc_load_policy: 1, cc_lang_pref: captions.language }
    : { cc_load_policy: captions.defaultOn ? 1 : 0 };
}
