# Interface localization

YT Zero provides complete interface message catalogues for nine languages.
The language is a per-profile setting, so profiles sharing one installation can
use different languages.

| Code | Language | Name shown in YT Zero | Intl locale |
| --- | --- | --- | --- |
| `en` | English | English | `en-US` |
| `pl` | Polish | polski | `pl-PL` |
| `de` | German | Deutsch | `de-DE` |
| `fr` | French | Français | `fr-FR` |
| `es` | Spanish | Español | `es-ES` |
| `pt-BR` | Brazilian Portuguese | Português (Brasil) | `pt-BR` |
| `ru` | Russian | Русский | `ru-RU` |
| `ja` | Japanese | 日本語 | `ja-JP` |
| `hu` | Hungarian | Magyar | `hu-HU` |

The canonical language list lives in `shared/uiLanguages.ts`. It supplies the
browser and server with the same language codes, BCP 47 locale tags, native
picker names, and base language codes. Non-English locale modules are loaded on
demand. An unknown stored language code is normalized to English.

## Translation catalogue

English in `ui/src/i18n/locales/en.ts` defines the message-key contract. Each
supported language has a matching, complete module in `ui/src/i18n/locales/`.
Feature groups shared by several locale modules are composed through
`ui/src/i18n/locales/featureMessages.ts`. Messages used by downloads,
automation, database, plugins, and backup/restore are collected in
`ui/src/i18n/locales/surfaceMessages.ts`; screens still consume them only
through `useI18n().t(...)`. Locale-specific plural forms and time units live in
`ui/src/i18n/localeFormats.ts`.

The server owns the labels and descriptions returned with download settings
and plugin manifests. Their source definitions contain English, Polish, and
German, while `app/src/serverMessages.ts` supplies every remaining supported
language. Always resolve these values with `localizeServerMessage()`; do not
select translations positionally or fall back in an API route.

Translations must keep every interpolation placeholder from the English
message, including placeholders such as `{count}`, `{name}`, and `{time}`.
Product names and technical terms may intentionally remain unchanged.

## Adding or updating a language

1. Add the code, BCP 47 locale, native name, and base language to
   `shared/uiLanguages.ts`.
2. Add a lazy loader in `ui/src/i18n/index.tsx` and a complete locale module in
   `ui/src/i18n/locales/`.
3. Add locale-specific pluralization to `ui/src/i18n/localeFormats.ts`.
4. Update the supported-language expectation and run the focused localization
   checks:

   ```sh
   bun test ui/src/i18nCatalog.test.ts ui/src/i18nFormatting.test.ts
   bun test app/src/serverMessages.test.ts
   ui/node_modules/.bin/tsc --noEmit -p ui/tsconfig.json
   ```

The catalogue test verifies that every locale has exactly the English keys,
contains no empty values, preserves interpolation placeholders, and does not
silently fall back to English for most messages.
The server catalogue test covers every nested download-setting and plugin
message and verifies interpolation placeholders for every additional language.

Interface language is portable profile configuration. Backup and restore
compatibility details are documented in
[`backup-restore-architecture.md`](backup-restore-architecture.md).
