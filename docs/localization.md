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
The English, Polish, and German modules compose several shared feature groups
through `ui/src/i18n/locales/featureMessages.ts`; every other locale includes
the same keys directly. Locale-specific plural forms and time units live in
`ui/src/i18n/localeFormats.ts`.

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
   ui/node_modules/.bin/tsc --noEmit -p ui/tsconfig.json
   ```

The catalogue test verifies that every locale has exactly the English keys,
contains no empty values, preserves interpolation placeholders, and does not
silently fall back to English for most messages.

Interface language is portable profile configuration. Backup and restore
compatibility details are documented in
[`backup-restore-architecture.md`](backup-restore-architecture.md).
