# YT Zero — system projektowy aplikacji

> Status: normatywny opis interfejsu produktowego `ui/`, przygotowany na podstawie stanu repozytorium z 2 września 2026.
>
> Ten dokument nie opisuje strony marketingowej z `pages/`. Ma ona osobny język wizualny, osobne fonty i własne tokeny.

## Szybki kontrakt

| Obszar | Reguła, od której zaczynamy |
| --- | --- |
| zakres | interfejs produktowy `ui/`; nie strona marketingowa `pages/` |
| powierzchnie | `--bg` → `--surface` → `--surface-2` → `--surface-3` |
| obramowania | brak na kartach, sekcjach, przyciskach, popoverach i dialogach; border tylko wtedy, gdy opisuje pole, podział, wybór, dane lub drop target |
| odstępy | skala `0 / 4 / 8 / 12 / 16 / 20 / 24px`; wartości optyczne należą wyłącznie do receptury komponentu |
| geometria | standardowa kontrolka `36px`, kompaktowa `30px`; input radius `8px`, popover/miniatura `12px`, dialog `14px`, Settings `16px` |
| akcja główna | `Button primary`: jasne tło `--text`, ciemny tekst `--bg`; niebieski akcent oznacza fokus, wybór i postęp |
| Settings | tylko `SettingsSection` + `SettingRow` + `Field` + współdzielone kontrolki |
| media | karta bez ramki i tła; miniatura `16:9`, radius `12px`; grid `22px 12px` |
| responsywność | globalny shell zmienia się przy `760px`; pozostałe progi należą do komponentu lub layoutu, preferowane są container queries |
| dostępność | jawny `:focus-visible`, lokalizowane etykiety, obsługa klawiatury i urządzeń bez hovera, `prefers-reduced-motion` |
| tekst | każdy user-facing string trafia do wszystkich 9 katalogów i18n |

Skróty do najczęściej używanych części: [kolory](#31-paleta-podstawowa), [obramowania](#33-border-gdzie-go-nie-ma-i-gdzie-jest-dozwolony), [odstępy](#34-odstępy), [layout](#4-layout-aplikacji), [komponenty](#5-komponenty-podstawowe), [Settings](#61-settings), [dostępność](#8-dostępność-i-rodzaje-inputu), [dług](#12-znane-odstępstwa-i-dług-systemu) i [checklista](#13-checklist-przed-zakończeniem-zmiany-ui).

Jak czytać status zasad:

- Rozdziały 2–11 są **kanonem dla nowego kodu**, chyba że akapit wprost mówi o „obecnym stanie”, „legacy” albo „wyjątku”.
- **Dozwolony wyjątek** ma nazwany zakres i funkcję, np. linie siatki wykresu lub rama dropzone. Nie rozszerza ogólnej reguły na inne komponenty.
- Rozdział 12 opisuje **dług**. To zapis zastanego stanu, którego nie należy kopiować.
- Konkretna implementacja współdzielonego komponentu pozostaje źródłem jego runtime API i stanów. Gdy jest sprzeczna z regułą systemową, nie dodawaj lokalnego override'u: popraw komponent i ten dokument razem.

## 1. Cel i źródła prawdy

YT Zero ma być spokojnym, ciemnym interfejsem do świadomego oglądania. Jest zwarty, ale nie ciasny; pierwszeństwo mają treść i miniatury, a nie dekoracyjne ramki, gradienty ani rozbudowany chrome.

Dla nowych zmian obowiązuje następująca kolejność:

1. Najpierw użyj publicznych komponentów z `ui/src/components/ui/index.ts`.
2. Jeżeli wzorzec jest domenowy, sprawdź istniejące komponenty w `ui/src/components/` i `ui/src/components/settings/`.
3. Wartości fundamentów bierz z `ui/src/styles/tokens.css`.
4. Ten dokument określa reguły kompozycji i wizualny kontrakt dla nowego kodu.
5. `ui/DESIGN_SYSTEM.md` pozostaje mapą migracji i katalogiem API. Nie jest pełną specyfikacją wizualną.
6. `docs/styles-refactor-plan.md` jest dokumentem historycznym. Nie należy kopiować z niego starego markupu ani klas legacy.

Jeżeli implementacja współdzielonego komponentu i ten dokument się rozchodzą, zmiana powinna aktualizować oba w tym samym zestawie zmian. Przypadkowej klasy strony nie należy traktować jako nowego standardu.

| Sytuacja | Decyzja |
| --- | --- |
| istniejący współdzielony komponent obsługuje potrzebę | użyj jego publicznego API i nie odtwarzaj geometrii lokalnym CSS |
| komponent ma potrzebny wzorzec, ale brakuje wariantu | dodaj nazwany, typowany wariant do komponentu; dopiero potem użyj go w domenie |
| ten sam brakujący wzorzec wystąpi w co najmniej dwóch domenach | najpierw dodaj lub rozszerz prymityw w `components/ui` i wspólny token, jeśli rola jest globalna |
| potrzeba jest wyłącznie domenowa | trzymaj markup, treść i CSS przy komponencie domenowym; używaj fundamentów oraz wspólnych prymitywów |
| lokalny CSS przeczy dokumentowi lub wspólnemu komponentowi | traktuj go jako wyjątek migracyjny, nie precedens; nie kopiuj bez jawnego udokumentowania |

## 2. Charakter interfejsu

### 2.1. Zasady nadrzędne

- **Dark-only.** Aplikacja nie ma obecnie jasnego motywu ani automatycznego przełączania przez `prefers-color-scheme`.
- **Borderless by default.** Karty, sekcje, przyciski, popovery, dialogi i alerty są rozdzielane tonem tła, odstępem i czasem cieniem. Border służy polom, separatorom, tabelom, drag-and-drop i stanom, w których granica ma znaczenie.
- **Media first.** Zwykła karta filmu nie dostaje osobnej ramki ani tła. Kształt niesie miniatura 16:9, a metadane leżą bezpośrednio na tle strony.
- **Jeden mocny akcent.** Niebieski `--accent` oznacza fokus, wybór, postęp i aktywną akcję. Nie służy do dekorowania całych ekranów.
- **Spokojna gęstość.** Bazowy tekst ma 14 px, kontrolki 30 lub 36 px, a odstępy najczęściej 8–16 px. Duże nagłówki są wyjątkami domenowymi, nie domyślnym stylem stron.
- **Kolor zamiast obrysu.** Hover zwykle przechodzi o jeden poziom powierzchni wyżej; selected może użyć tła `--surface-3`, inwersji `--text`/`--bg` albo delikatnego `color-mix()` z akcentem.
- **Ruch ma wyjaśniać zmianę.** Standardowa mikroanimacja trwa 120–180 ms. Dłuższe animacje są dopuszczalne tylko dla wejścia/wyjścia treści albo gestu.
- **Współdzielone zachowanie jest częścią designu.** Fokus, disabled, loading, hover, responsywność i semantyka nie powinny być odtwarzane lokalnie.

### 2.2. Twarde zakazy dla nowego kodu

- Nie dodawaj obrysu do zwykłej karty, sekcji ustawień, przycisku, popovera, dialogu lub alertu.
- Nie twórz surowego `<button>`, `<input>`, `<textarea>`, switcha, taba ani selecta, jeżeli istnieje wspólny komponent.
- Nie dodawaj nowych użyć legacy `.btn`, `.icon-btn`, `.switch`, `.settings-section`, `.settings-tab`, `.dropdown-menu` ani starej `.chip`.
- Nie używaj `--live` jako ogólnego koloru błędu. Live i danger to dwie różne role.
- Nie używaj `--text-3` dla ważnej treści, etykiet pól ani komunikatów wymagających odczytania.
- Nie dodawaj losowego `z-index`, breakpointu, cienia lub czasu animacji bez sprawdzenia istniejącego właściciela.
- Nie umieszczaj CSS komponentu lub strony w `ui/src/styles.css`.
- Nie pokazuj kluczowej akcji wyłącznie na hover; musi być dostępna klawiaturą i na urządzeniu bez hovera.
- Nie hardkoduj user-facing copy w JSX. Każdy tekst ma wejść do katalogu i18n.

## 3. Fundamenty

### 3.1. Paleta podstawowa

Jedynym globalnym źródłem kolorów aplikacji jest `ui/src/styles/tokens.css`.

| Token | Wartość | Rola | Typowe użycie |
| --- | --- | --- | --- |
| `--bg` | `#0f0f0f` | tło bazowe | `body`, główna treść, wnętrze inputów |
| `--surface` | `#1f1f1f` | powierzchnia poziomu 1 | sekcje ustawień, spokojne karty, skeleton content |
| `--surface-2` | `#272727` | powierzchnia poziomu 2 | popovery, dialogi, chipy, zagnieżdżone kontrolki |
| `--surface-3` | `#3f3f3f` | stan interaktywny/strukturalny | hover, selected, border pól, separatory, tracki |
| `--text` | `#f1f1f1` | tekst główny | tytuły, etykiety, treść pierwszoplanowa |
| `--text-2` | `#aaaaaa` | tekst wtórny | opisy, metadata, nieaktywne ikony |
| `--text-3` | `#717171` | tekst mocno wyciszony | placeholder, nieistotna metadata, eyebrow |
| `--accent` | `#3ea6ff` | interakcja/wybór | focus, active, progress, link akcji |
| `--live` | `#f2293a` | czerwony produktowy/live | live badge, watched/playback progress i domyślna ikona aplikacji |
| `--chip` | `#272727` | chip normalny | alias wizualny `--surface-2` |
| `--chip-hover` | `#3f3f3f` | chip hover | alias wizualny `--surface-3` |

Drabina powierzchni ma zachować kolejność:

```text
strona          sekcja/karta      kontrolka/popover      hover/separator
--bg      →     --surface    →    --surface-2      →     --surface-3
#0f0f0f         #1f1f1f           #272727                 #3f3f3f
```

Nie pomijaj poziomów bez powodu. Popover osadzony nad stroną używa `--surface-2`; element hover wewnątrz niego używa `--surface-3`. Sekcja ustawień na `--surface` nie potrzebuje bordera.

`--text-3` ma kontrast około 3.93:1 na `--bg`, 3.38:1 na `--surface` i 3.06:1 na `--surface-2`. Dlatego wolno go stosować tylko do treści pomocniczej lub nieistotnej, nigdy jako jedynego nośnika ważnej informacji.

### 3.2. Kolory semantyczne

Kolory statusów nie są jeszcze globalnymi tokenami; poniższe wartości są kontraktem istniejących komponentów, a nie zachętą do kolejnych lokalnych hexów.

| Rola | Kolor bazowy | Sposób użycia |
| --- | --- | --- |
| info | `var(--accent)` | `Alert`, status informacyjny, wybrana akcja |
| warning | `#f2a33a` | ostrzeżenie, tło zwykle baza zmieszana w 11–20% |
| danger | `#f25b67` | błąd i destrukcja; teksty pochodne `#ff6b76`–`#ff939b` należą do komponentów |
| success | `#52b979` | powodzenie; teksty pochodne `#78d49b`–`#8ce2aa` należą do komponentów |
| live/progress | `var(--live)` = `#f2293a` | transmisja oraz watched/playback progress; nie ogólny błąd |
| scheduled | `#6d3cc7` / rodzina `#8b5cf6` | kolejka i harmonogram; domenowy wyjątek |
| liked | `#ff4d6a` | aktywne polubienie; hover `#ff7b8d` |
| members-only | `#f5c542` | złoty marker treści dla wspierających |

Reguła dla subtelnego statusu:

```css
background: color-mix(in srgb, var(--semantic-color) 11%, transparent);
color: color-mix(in srgb, var(--semantic-color) 75%, white);
```

Mocne, pełne tło statusu stosuj wyłącznie dla małego badge'a, aktywnego przełącznika albo stanu, który musi być natychmiast widoczny. Biały tekst jest zarezerwowany dla takich pełnych teł i ciemnych overlayów na mediach.

Kolor ikony aplikacji jest konfigurowalny globalnie dla instalacji i nie zmienia `--accent`. Nie wolno używać koloru logo jako tokena interakcji.

### 3.3. Border: gdzie go nie ma i gdzie jest dozwolony

Domyślna wartość dla powierzchni i akcji to `border: 0`.

| Element | Border | Uzasadnienie |
| --- | --- | --- |
| `Button`, `IconButton`, `Switch`, `Chip`, pill `Tabs` | brak | interakcję pokazuje wypełnienie i hover |
| `SettingsSection`, karta filmu, zwykła karta treści | brak | hierarchię budują powierzchnia i odstęp |
| `Popover`, `FloatingPopover`, `Dialog` | brak | granicę zapewnia różnica tła i cień |
| `Alert`, neutralny `Badge` | brak | rolę pokazuje tinted fill |
| `Input`, `Textarea`, affix `InputGroup` | `1px solid var(--surface-3)` | granica edytowalnego pola |
| `Checkbox` | `1px solid var(--surface-3)` | widoczny obszar kontroli 18×18 px |
| `OptionPicker`, `TriStateSwitch`, `PermissionMatrix` | `1px solid var(--surface-3)` | jedna wspólna rama złożonej kontrolki |
| `SettingRow`, `List` divided, menu/dialog header i footer | separator `1px` | podział struktury, nie ramka dookoła |
| `FileDropzone` | `2px dashed var(--surface-3)` | drop target musi mieć widoczną granicę |
| swatch/wybór na obrazie | 1–2 px, często transparent w stanie neutralnym | zaznaczenie musi pozostać czytelne niezależnie od koloru tła |
| semantic toast | success/danger: `1px solid color-mix(in srgb, <kolor> 35%, transparent)`; scheduled: `1px solid rgba(220,199,255,.34)` | istniejący wyjątek dla komunikatu ponad treścią |

Nie łącz ramki całej sekcji z separatorami jej wierszy. Nie dodawaj bordera tylko po to, żeby „karta wyglądała jak karta”. Jeśli dwa poziomy są zbyt podobne, popraw poziom powierzchni lub odstęp.

### 3.4. Odstępy

Globalna skala ma krok 4 px:

| Token | Wartość | Zastosowanie |
| --- | --- | --- |
| `--space-0` | `0` | brak odstępu |
| `--space-1` | `4px` | ścisłe grupy ikon i mikroelementy |
| `--space-2` | `8px` | akcje, przyciski w grupie, standardowy inline gap |
| `--space-3` | `12px` | standardowy stack, elementy menu, wnętrza kompaktowe |
| `--space-4` | `16px` | sekcje, większe grupy, dialog body |
| `--space-5` | `20px` | duże odstępy w sekcji |
| `--space-6` | `24px` | podział bloków i główny grid ustawień |

Do ogólnych layoutów używaj `Stack gap={0…6}` i `Inline gap={0…6}`. System ma też optyczne wartości 6, 7, 9, 10, 11, 14 i 18 px; są poprawne wewnątrz istniejącej receptury komponentu, lecz nie tworzą nowych tokenów.

Najważniejsze receptury:

| Kontekst | Padding / gap |
| --- | --- |
| content desktop | `18px 32px 80px`, z safe-area po bokach i na dole |
| content do `760px` | `12px 8px 60px`, z safe-area |
| settings section desktop | `20px 22px` |
| settings section do `760px` | `14px` |
| settings section do `480px` | `12px` |
| setting row | `12px 0`, gap między copy i control `16px` |
| page header | margin `4px 0 20px`, gap `16px` |
| section header | margin-bottom `14px`, gap `12px` |
| dialog | header `14px 16px`, body `16px`, footer `12px 16px` |
| popover | `12px`; wariant menu `6px` |
| menu item | `9px 10px`, gap `10px` |
| list row | `11px 0`, gap `12px` |
| video grid | `22px` pionowo, `12px` poziomo |
| metadata karty filmu | `10px 2px 0`, gap `10px` |

### 3.5. Promienie

W kodzie istnieje jeden token `--radius: 12px`, ale komponenty używają celowej drabiny optycznej:

| Promień | Rola |
| --- | --- |
| `3–4px` | duration badge, mały status na miniaturze |
| `5px` | checkbox, mały swatch |
| `6px` | tooltip, code badge, mały wewnętrzny element |
| `7px` | kompaktowy input, element segmented/menu, mała akcja na mediach |
| `8px` | input, menu item, element listy, standardowy wewnętrzny control |
| `9–10px` | tabs/chip, alert, nawigacja i zgrupowane kontrolki |
| `12px` | standardowa miniatura/karta oraz popover |
| `14px` | dialog i dropzone |
| `16px` | sekcja ustawień |
| `18–22px` | wyłącznie duży hero lub specjalna powierzchnia domenowa |
| `50%` | awatar, thumb suwaka, status dot |
| `999px` | przycisk pill, badge, switch track, progress track |

Nie używaj `99px` i `999px` jako dwóch odrębnych koncepcji; oba oznaczają pill. Dla nowego kodu wybieraj `999px`.

### 3.6. Typografia

Globalny stack:

```css
font-family: "Roboto", -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif;
font-size: 14px;
```

Roboto nie jest obecnie dostarczany przez aplikację. Jeżeli nie ma go w systemie, przeglądarka użyje fontu systemowego. Projekt nie może zależeć od metryk dostępnych wyłącznie w Roboto.

| Rola | Rozmiar / waga | Dodatkowe zasady |
| --- | --- | --- |
| page title | `19px / 700` | tracking `-0.2px` |
| dialog title | `16px / 700` | jedna linia, bez dekoracji |
| section title | `15px / 700` | ikona 17 px |
| subtle section title | `14px` | `--text-2` |
| uppercase section title | `13px` | `--text-2`, tracking `.04em` |
| body/base | `14px` | domyślna wielkość aplikacji |
| `Text lg` | `14px`, line `1.5` | opis pierwszego poziomu |
| `Text md` | `13px`, line `1.5` | standardowy opis komponentu |
| `Text sm` | `12px`, line `1.5` | metadata/pomoc |
| label kontrolki | `13.5px / 500` | zawsze `--text` |
| description/hint | `12px`, line `1.45` | `--text-2` |
| button md | `13.5px / 500` | wysokość 36 px |
| button sm | `12.5px / 500` | wysokość 30 px |
| menu item | `13.5px` | bez uppercase |
| tabs/chip | `13px / 600` | aktywność przez fill lub underline |
| badge | `10.5–11.5px / 650` | krótka treść, bez zdań |
| eyebrow/menu label | `10.5–11px / 700` | uppercase, tracking `.04–.08em` |
| tooltip | `11px / 500` | jedna krótka informacja |

Duże tytuły `25–36px` należą do wyspecjalizowanych hero, np. playlisty lub Insights. Nie należy stosować ich w zwykłym `PageHeader`.

W nowym ogólnym UI trzymaj się wag `400 / 500 / 600 / 700`. Wartości `650`, `720` i `750` występują w istniejących komponentach jako korekty optyczne; bez dostarczonego variable fontu mogą zostać zsyntetyzowane i nie powinny być nowym domyślnym standardem.

Link w treści może używać `--accent`; przy hover powinien dostać underline. Link nawigacyjny i karta dziedziczą kolor, a underline pojawia się dopiero przy hoverze tytułu/nazwy kanału.

### 3.7. Ikony

- Domyślną biblioteką jest Lucide.
- Standardowa ikona w przycisku ma `16×16px`, `stroke-width: 1.8`.
- Ikona menu lub nagłówka ma zwykle `17×17px`.
- Ikona nawigacji bocznej ma `20×20px`, `stroke-width: 1.7`.
- Duża ikona pustego stanu ma `40×40px`, `stroke-width: 1.4`.
- Ikona dziedziczy `currentColor`; nie otrzymuje osobnego hexa bez roli domenowej.
- Akcja tylko z ikoną musi używać `IconButton` i zawsze mieć lokalizowany `label`/`aria-label`.
- Tooltip jest objaśnieniem, nie zamiennikiem nazwy dostępnościowej.
- Emoji służy reakcjom i treści użytkownika. Nie zastępuje Lucide w nawigacji ani kontrolkach systemowych.

### 3.8. Cienie i elevation

Cienie nie są jeszcze tokenami, ale współdzielone powierzchnie tworzą spójną drabinę:

| Poziom | Cień |
| --- | --- |
| local toast | `0 2px 12px rgba(0,0,0,.5)` |
| popover | `0 4px 24px rgba(0,0,0,.55)` |
| toast | `0 6px 30px rgba(0,0,0,.5)` |
| floating popover | `0 8px 30px rgba(0,0,0,.58)` |
| dialog | `0 16px 48px rgba(0,0,0,.55)` |

Nie dodawaj cienia do zwykłego `SettingsSection`, list row ani karty filmu. Cień oznacza warstwę unoszącą się nad bieżącym kontekstem albo wyspecjalizowane media/hero.

### 3.9. Fokus, disabled i loading

Standardowy fokus klawiatury:

```css
outline: 2px solid var(--accent);
outline-offset: 2px;
```

W elemencie osadzonym wewnątrz jednej powierzchni można użyć `outline-offset: -2px`. Checkbox stosuje dwuczęściowy ring: 2 px koloru tła i 4 px akcentu.

Disabled:

- opacity `0.5` dla przycisków/chipów,
- opacity `0.55` dla pól, checkboxów i switchy,
- `cursor: default`,
- brak reakcji hover i brak zmiany koloru — to kontrakt docelowy; znane braki implementacji są zapisane w rozdziale 12,
- kontrolka pozostaje czytelna, ale nie konkuruje z aktywnymi elementami.

Loading nie ma osobnego wariantu `Button`. Obowiązujący wzorzec to:

- `disabled`,
- `LoaderCircle` z klasą `.spin`,
- etykieta w czasie teraźniejszym, np. „Importowanie…”,
- brak skakania szerokości, jeżeli przycisk pozostaje w stałym miejscu.

Globalny spinner trwa `750ms linear infinite`; w `prefers-reduced-motion: reduce` nie obraca się.

### 3.10. Motion

| Typ | Czas | Easing / zachowanie |
| --- | --- | --- |
| hover/focus/color | `120–180ms` | `ease` |
| popover enter | `160ms` | `cubic-bezier(.22, 1, .36, 1)`, 3–4 px + scale `.98→1` |
| popover exit | `120ms` | `ease-in` |
| progress width | `250ms` | `ease` |
| rozwinięcie regionu | `320–340ms` | spring-like `.22,1,.36,1` |
| media hover scale | `250ms` | `ease` |
| wejście karty/feed gesture | maks. około `680ms` | tylko domenowe, nie dla zwykłej kontrolki |

Każdy nowy motion musi mieć zachowanie dla `prefers-reduced-motion`. W trybie reduce usuń ruch przestrzenny i pętle; natychmiastowa zmiana koloru/opacity jest dopuszczalna. Nie dodawaj bezterminowego pulsu poza realnym stanem live/loading.

## 4. Layout aplikacji

### 4.1. App shell

| Element | Desktop | Mobile |
| --- | --- | --- |
| topbar | wysokość `58px + safe-top`; padding poziomy `20px + safe-area` | do `480px`: `8px + safe-area` |
| topbar background | `rgba(15,15,15,.88)`, blur `10px` | bez zmiany roli |
| sidebar | szerokość `260px`; padding `10px 10px 20px`; sticky pod topbarem | do `760px`: drawer `min(286px, 100vw - 42px)` |
| sidebar nav item | wysokość `44px`; padding `0 12px`; gap `18px`; radius `10px` | ta sama geometria |
| główna treść | `18px 32px 80px` + safe areas | do `760px`: `12px 8px 60px` + safe areas |
| global search | max-width `560px`, height `38px` | kurczy się w dostępnej przestrzeni |

Sidebar na mobile używa backdropu `rgba(0,0,0,.48)`, blur tła drawera `18px` i zamyka się już przed hydratacją dla viewportu `≤760px`. Nie twórz drugiego mechanizmu mobilnej nawigacji.

Topbar, sidebar i content muszą używać `env(safe-area-inset-*)` przez globalne tokeny. Nie zapisuj `safe-area` ponownie w feature CSS.

Szerokość głównej treści zależy od charakteru strony, nie od jednego globalnego containera:

| Powierzchnia | Maksymalna szerokość |
| --- | --- |
| feed i gridy mediów | cała dostępna szerokość |
| watch | `1750px`, wycentrowane |
| settings shell | `1218px` łącznie; content `980px` |
| search | `800px` |
| import | `860px` |
| backup/restore | `900px` |
| social i channel posts | `720px` |
| wąski toolbar/status subskrypcji | `680px` |

Nie ograniczaj feedu desktopowym `max-width`. Wąski container stosuj wtedy, gdy użytkownik czyta lub wypełnia liniowy przepływ; media grid powinien wykorzystać ekran.

Search w topbarze jest jednym z funkcjonalnych wyjątków od borderless: input ma `1px solid --surface-3`, lewy pill radius i padding poziomy `18px`, a przycisk wyszukiwania ma szerokość `60px`, tło `--surface-2` i prawy pill radius. Na focus border inputu przechodzi na `--accent`; do `480px` padding inputu spada do `10px`.

### 4.2. Nagłówek strony

Każda standardowa strona zaczyna się od `PageHeader`:

- title jest wymagany,
- description ma max-width `760px` i margin-top `6px`,
- identity ma gap `12px`,
- actions mają gap `8px`, zawijają się i są wyrównane do prawej,
- cały header ma margin `4px 0 20px`,
- poniżej `720px` akcje przechodzą do osobnego wiersza,
- poniżej `640px` na powierzchniach ustawień header układa się pionowo i akcje zajmują pełną szerokość.

Nie odtwarzaj lokalnie `.page-title` ani `.page-hint`.

### 4.3. Sekcje i grupowanie

- `SectionHeader` rozdziela logiczne bloki na stronie; standardowo ma margin-bottom `14px`.
- `Stack` jest domyślnym układem pionowym; domyślny gap to `12px`.
- `Inline` jest domyślnym układem akcji; domyślny gap to `8px`, wrap jest włączony.
- `Divider` ma margin `16px 0`; linia ma 1 px `--surface-3`.
- Nie używaj pustych divów ani dodatkowych borderów do uzyskania odstępu.

### 4.4. Grid filmów i układy medialne

- Klasa layoutowa `.video-grid` używa `repeat(auto-fill, minmax(var(--video-card-min, 248px), 1fr))`; nie istnieje publiczny komponent `VideoGrid`.
- Zakres ustawienia szerokości karty to `180–480px`, wartość domyślna `248px`.
- Gap grida to `22px 12px`.
- Miniatura standardowa ma proporcje `16:9` i radius `12px`.
- Karta nie ma borderu ani własnego tła.
- Metadata pod miniaturą ma padding `10px 2px 0` i gap `10px`.
- Awatar ma standardowo `36px`; warianty gridu skalują go do 30/34/40 px.
- Tytuł ma `14px / 500`, line-height `1.4`, maksymalnie 2 linie.
- Kanał ma `12.5px`, czas `12px`, oba `--text-2`.
- Poziomy search result używa miniatury `240px`, gap `12px`; poniżej `560px` przechodzi w układ pionowy.
- Overlay actions zaczyna się `8px` od krawędzi miniatury; na wąskim kontenerze `≤220px` kompresuje padding i przyciski przez container query.
- Pasek watched/progress ma `3px`; fill używa `--live`. Nie dokładaj drugiego progress bara na tę samą miniaturę.
- Duration badge leży `6px` od prawego dolnego rogu, ma padding `2px 5px`, radius `3px` i tekst `11px / 600` na czerni z opacity `.82`.
- Live badge leży `8px` od lewego dolnego rogu, ma padding `2px 8px`, radius `4px` i tekst `10.5px / 700`.

Nowe powierzchnie z filmem muszą używać `VideoThumbnail`. Komponent centralizuje fallback obrazu, watched state i progress; nie implementuj tych warstw ponownie.

### 4.5. Breakpointy

Tylko `760px` jest globalnym progiem shell. Pozostałe breakpointy należą do właściciela konkretnego layoutu.

| Próg | Obecna rola |
| --- | --- |
| `1280px` | duże układy watch/social |
| `880px` | `SettingsNav` desktop → mobile |
| `760px` | sidebar → drawer, mniejszy padding contentu |
| `720px` | wrap `PageHeader`, część kart/Insights |
| `640px` | najczęstszy stack contentu, wierszy i akcji |
| `600px` / `560px` | gęste dialogi, media row → column, pola full width |
| `480px` | narrow phone, 12 px settings padding, topbar 8 px |
| `420px` / `380px` | wyłącznie specjalistyczne pickery i ciasne odtwarzacze |

Jeżeli komponent jest osadzany w różnych szerokościach, wybierz container query zamiast kolejnego viewport breakpointu. `SettingsSection` jest named containerem `settings-section`; aktualne progi to m.in. 700, 560 i 520 px. Miniatura filmu ma container `video-thumbnail` z progiem 220 px.

Weryfikacja widoków powinna obejmować co najmniej 360, 768, 1280 i 1920 px.

### 4.6. Overflow i zawijanie

- Każde dziecko flex/grid, które może zawierać tekst, dostaje `min-width: 0`.
- Jednoliniowe nazwy w wąskim kontekście używają ellipsis.
- Tytuł karty filmu używa clamp do 2 linii, nie stałej wysokości tekstu.
- Długie menu i selecty używają `ScrollArea`; nie rozszerzają viewportu.
- Tabs przewijają się poziomo bez widocznego scrollbara i pokazują gradient krawędzi tylko wtedy, gdy jest więcej treści.
- Dla desktopowego przeciągania poziomych rzędów używaj `useHorizontalDragScroll`; natywny touch scroll pozostaje bez zmian.
- Call site ma utrzymać popover minimum 8 px od krawędzi viewportu. Zwykły `Popover` wybiera pionowe położenie, ale nie clampuje osi poziomej; przy krawędzi lub w rodzicu z `overflow` użyj `FloatingPopover` i ogranicz szerokość contentu.
- Globalny scrollbar WebKit ma width `10px`, height `8px`, thumb `--surface-3` z radiusem `5px` i transparentny track. Sidebar zwęża go do `6px` i pokazuje thumb dopiero przy hover/focus-within.
- Ukrycie scrollbara jest dozwolone tylko dla krótkiego poziomego scroller-a z czytelnym edge fade lub innym sygnałem dalszej treści.

## 5. Komponenty podstawowe

### 5.1. Button, IconButton i linki

Warianty: `default | primary | secondary | danger | ghost`. Rozmiary: `md | sm`.

| Wariant | Stan bazowy | Hover |
| --- | --- | --- |
| `default` | `--chip`, `--text` | `--chip-hover` |
| `primary` | bg `--text`, fg `--bg` | bg `#d9d9d9` |
| `secondary` | bg `--surface-3`, fg `--text` | zachowuje mocny neutralny fill |
| `danger` | dyskretna akcja na neutralnym tle | tekst `#ff6b76` |
| `ghost` | transparent, `--text-2` | bg `--surface-2`, tekst `--text` |

Geometria:

| Rozmiar | Wysokość | Padding X | Font | Icon-only |
| --- | --- | --- | --- | --- |
| `md` | `36px` | `15px` | `13.5px / 500` | `36×36px` |
| `sm` | `30px` | `12px` | `12.5px / 500` | `30×30px` |

Wspólne: gap `7px`, radius `999px`, border `0`, ikona `16px`/stroke `1.8`.

- `Button` służy akcjom.
- `ButtonLink` służy nawigacji React Router.
- `ButtonAnchor` służy zewnętrznym URL.
- `IconButton` służy akcji bez tekstu i wymaga `label`.
- `SplitButton` łączy główną akcję z chevronem; nie składaj dwóch niezależnych pillów obok siebie.
- W `SplitButton` główna część zachowuje padding-right `12px`, toggle ma width `32px`, a wewnętrzny separator ma `1×18px` i opacity `.16`.
- Danger nie jest domyślnie czerwonym filled buttonem. Potwierdzenie destrukcji należy wzmocnić przez treść `Popconfirm`/`Dialog`, nie przez dużą czerwoną powierzchnię.

### 5.2. Input, Textarea, Field i InputGroup

| Element | Wysokość | Padding | Radius | Border |
| --- | --- | --- | --- | --- |
| Input md | `36px` | `0 11px` | `8px` | `1px --surface-3` |
| Input sm | `30px` | `0 9px` | `7px` | `1px --surface-3` |
| Textarea | min `92px` | `9px 11px` | `8px` | `1px --surface-3` |
| InputGroup affix | wysokość grupy | `0 10px` | tylko na zewnętrznych rogach | `1px --surface-3` |

- Pole ma tło `--bg`; placeholder używa `--text-3`.
- `Field` ma gap `6px`; label `13.5px / 500`; hint/error `12px`, line-height `1.45`.
- `Field` jest właścicielem label, hint i błędu dla zwykłego formularza.
- W `SettingRow` użyj jego `label`/`htmlFor`; nie dubluj etykiety przez dodatkowy `Field`, chyba że kontrolka zawiera kilka osobno podpisanych pól.
- `InputGroup` skleja prefix/suffix i input; środkowe elementy nie mają promienia.
- Textarea zmienia wysokość tylko pionowo.

### 5.3. Checkbox, Switch, TriStateSwitch i slidery

**Checkbox**

- kontrolka `18×18px`, radius `5px`, border `1px --surface-3`,
- gap do copy `9px`,
- check `13px`, stroke `3`,
- checked: tło i border `--accent`, check biały,
- label jest wymagany; description jest opcjonalny.

**Switch**

- track `42×24px`, padding `3px`, radius `999px`, border `0`,
- thumb `18×18px`,
- off: track `--surface-3`, thumb `--text-2`,
- on: track `--accent`, thumb `#fff`, przesunięcie `18px`,
- każdy `Switch` wymaga lokalizowanego `ariaLabel`, również jako prawa kontrolka `SettingRow`; obecny `SettingRow` nie tworzy dla niego `aria-labelledby`.

**TriStateSwitch**

- tylko dla decyzji `inherit | allow | deny`,
- frame: `--bg`, border 1 px, radius `10px`, padding `3px`,
- opcja: min-height `32px`, padding `5px 9px`, radius `7px`, font `12px / 600`,
- icon-only: `32×32px`,
- allow active: zielony tinted fill; deny active: czerwony tinted fill.

**Slider / SteppedSlider**

- track `6px`, radius pill,
- thumb `18px`, bez bordera; w WebKit cień `0 3px 10px color-mix(in srgb, var(--accent) 45%, transparent)`,
- `Slider` służy wartości ciągłej,
- `SteppedSlider` służy jawnej liście dyskretnych kroków i obsługuje Arrow/Home/End,
- `ProgressBar` nie jest inputem: track ma `5px` i tylko prezentuje postęp.

### 5.4. Wybór właściwego komponentu

| Potrzeba | Komponent |
| --- | --- |
| jedna opcja z długiej listy | `SelectMenu` |
| wiele opcji z długiej listy | `MultiSelectMenu` |
| 2–4 równorzędne, natychmiastowe opcje | `SegmentedControl` |
| zmiana widoku/sekcji | `Tabs` |
| prosty filtr/toggle treści | `Chip` |
| bogata opcja z ikoną i opisem | `OptionPicker` |
| gęsta siatka samych ikon | `IconPicker` |
| dziedzicz/zezwól/zabroń | `TriStateSwitch` |
| kolor z palety lub ręczny HEX | `ColorPicker` |

**SelectMenu**

- trigger to `Button secondary`, radius `8px`, min-width `170px`,
- popover ma min-width `210px`, max-width `100vw - 24px`, padding `8px`,
- lista ma max-height `min(420px, 70vh)`,
- search ma margin-bottom `7px`,
- `floating` włączaj tylko, gdy ancestor może clipować content,
- `searchPlaceholder`, `emptyLabel`, `placeholder` i `label` zawsze przekazuj z i18n.

**SegmentedControl**

- outer: `--surface`, radius `9px`, padding/gap `3px`,
- option: padding `7px 10px`, radius `7px`, gap `6px`, border `0`,
- active: `--surface-3` i `--text`.

**Tabs i Chip**

- pill: min-height `34px`, padding `7px 12px`, gap `7px`, radius `9px`, font `13px / 600`,
- pill active: tło `--text`, tekst `--bg`,
- `settings`: min-height `38px`, padding `8px 14px`, aktywny underline `2px --accent`,
- `subtle`: min-height `38px`, padding `8px 16px`, font `14px`, aktywny underline `2px --accent`,
- count badge: `11px`, padding `1px 6px`.

**OptionPicker**

- frame: padding/gap `5px`, radius `11px`, border 1 px,
- option: min-height `58px`, padding `10px 11px`, gap `10px`, radius `8px`,
- przy szerokości kontenera settings `≤560px` przechodzi do jednej kolumny.

**IconPicker**

- domyślnie 8 kolumn,
- gap `5px`, option min-height `36px`, radius `8px`, ikona `18px`,
- selected: `color-mix(in srgb, var(--accent) 14%, transparent)` + border `color-mix(in srgb, var(--accent) 50%, transparent)`.

### 5.5. ColorPicker, EmojiPicker i ShortcutInput

**ColorPicker**

- trigger domyślny: height `36px`, padding `4px 9px 4px 5px`, radius `8px`, border 1 px,
- wariant swatch: `30×30px`, padding `3px`,
- popover max-width `232px`,
- spectrum height `128px`, radius `8px`,
- paleta: 6 kolumn, gap `5px`,
- sekcja HEX: border-top, margin-top i padding-top po `9px`.

**EmojiPicker**

- popover: max-width `368px` albo `100vw - 16px`, padding `8px`,
- recent: siatka 6 kolumn, element `34×34px`, radius `7px`,
- katalog ładuje się lazy; nie zastępuj go własną siatką emoji.

**ShortcutInput**

- całość min-width `210px`, gap `2px`,
- capture min-width `112px`, bg `--surface-3`, radius `7px`, font monospace,
- recording: ring 2 px accent,
- invalid: ring 1 px `#ff5969`, tekst `#ff7b88`,
- do `600px` zajmuje pełną szerokość.

## 6. Kompozycje

### 6.1. Settings

Settings są najściślej kontrolowaną powierzchnią design systemu.

Standardowy shell:

```text
Settings page
├── PageHeader
└── settings-shell: 214px nav + 24px gap + content max 980px
    ├── SettingsNav
    └── SettingsSection
        ├── SectionHeader
        └── SettingRow × N
            ├── label + description
            └── shared control
```

Wymiary:

- shell max-width `1218px`, kolumny `214px minmax(0, 980px)`, gap `24px`,
- poniżej `880px`: jedna kolumna, gap `16px`, mobilny trigger `SettingsNav`,
- section: bg `--surface`, border `0`, radius `16px`, max-width `980px`, padding `20px 22px`, margin-bottom `18px`,
- row: separator top 1 px poza pierwszym, padding `12px 0`, gap `16px`,
- `FormActions`: gap `8px`, margin-top `12px`, wrap; domyślnie do prawej,
- do `760px`: section radius `12px`, padding `14px`, pola/selecty mogą przejść na 100%,
- do `640px`: row układa copy nad kontrolką, control ma 100%,
- do `480px`: section padding `12px`, grupy akcji i pola pełnej szerokości.

Przykład:

```tsx
<SettingsSection title={t("displayPlayback")} description={t("playbackHint")}>
  <SettingRow
    label={t("feedAutoplay")}
    description={t("feedAutoplayHint")}
  >
    <Switch
      checked={autoplay}
      onCheckedChange={setAutoplay}
      ariaLabel={t("feedAutoplay")}
    />
  </SettingRow>

  <SettingRow label={t("quality")}>
    <SelectMenu
      label={t("quality")}
      value={quality}
      options={qualityOptions}
      onChange={setQuality}
    />
  </SettingRow>
</SettingsSection>
```

Nie używaj w Settings surowych kontrolek, własnego row layoutu ani border-box cards wewnątrz każdej opcji. Jeśli nowa interakcja będzie powtarzalna, najpierw rozszerz `components/ui`.

### 6.2. Nawigacja Settings

- Desktop nav ma padding `2px 8px 12px 0`.
- Grupy dzieli 1 px `--surface-3`, margin/padding top `15px`.
- Group label ma `11px / 700`, uppercase, tracking `.045em`, padding `0 11px 4px`.
- Item ma min-height `36px`, padding `8px 11px`, radius `9px`, font `14px`, border `0`.
- Hover: `--surface-2` + `--text`.
- Active: `color-mix(in srgb, var(--accent) 13%, transparent)` + font 600; hover zwiększa udział akcentu do 17%.
- Mobile trigger ma radius `11px`, pełną szerokość; menu ma max-width `360px` lub `100vw - 32px`.
- Mobile menu ma max-height `min(70dvh, 560px)` i przewija się wewnętrznie.

### 6.3. Listy

Używaj `List`, `ListRow`, `ListButton` i `ListActions`.

- row grid: `auto minmax(0,1fr) auto auto`,
- gap `12px`, padding `11px 0`,
- divided list: 1 px separator przed kolejnymi wierszami,
- title `13.5px / 600`, ellipsis,
- description/meta `12px`, line-height `1.45`, `--text-2`,
- clickable row: transparent, border `0`, hover `--surface-2`,
- actions: gap `8px`, wrap, wyrównanie do końca,
- w Settings obecny próg `≤640px` przełącza row na dwie kolumny: meta i actions lądują pod contentem. Poza Settings właściciel layoutu musi jawnie zdefiniować własny próg; bazowy `List` nie ma media query.

`ListButton` służy klikalnemu wierszowi. Nie opakowuj całego `ListRow` w dodatkowy button/link.

### 6.4. Menu i popovery

**Menu**

- surface składa się z `Popover surface="menu"` albo `FloatingPopover` + `Menu`,
- `Menu` ma min-width `190px`, padding `6px`,
- `MenuItem` ma padding `9px 10px`, gap `10px`, radius `8px`, font `13.5px`, border `0`,
- hover `--surface-3`, selected `color-mix(in srgb, var(--accent) 12%, transparent)`,
- icon/check `17px`; check `--accent`,
- label grupy `10.5px / 700`, uppercase, padding `6px 10px 4px`,
- separator margin `6px 4px`,
- loading min-height `44px`, padding `8px 12px`.

**Popover**

- używaj, gdy ancestor nie clipuje powierzchni,
- bg `--surface-2`, radius `12px`, border `0`, shadow popover, padding `12px`, min-width `190px`,
- gap od triggera `6px`; przy `placement="auto"` margines `8px` bierze udział wyłącznie w wyborze pozycji pionowej, nie gwarantuje poziomego clampingu,
- align `start | center | end`, placement `top | bottom | auto`,
- zamyka się po Escape i kliknięciu poza drzewem zagnieżdżonych popoverów.

**FloatingPopover**

- używaj w sidebarze, scroll containerze, dialogu lub przy możliwym clippingu,
- portal do `body`, pozycja śledzi scroll/resize,
- gap domyślny `8px`; pozycja jest clampowana do marginesu `8px`, o ile content sam mieści się w viewportcie,
- bg `--surface-2`, radius `12px`, border `0`, padding `12px`, cień `0 8px 30px rgba(0,0,0,.58)`.

`surface="menu"` zmniejsza padding surface do `6px`. Nie dodawaj potem drugiego wrappera z własnym paddingiem 12 px.

### 6.5. Dialog i potwierdzenia

`Dialog` jest właścicielem portalu, backdropu, Escape, focus trap, `aria-modal`, inert app root i przywrócenia poprzedniego fokusu.

- backdrop `rgba(0,0,0,.72)`, padding `16px`,
- dialog width `520px`, max-width `100%`, max-height `min(85vh, 720px)`,
- bg `--surface-2`, radius `14px`, border `0`,
- header/footer mają wyłącznie separator od body,
- title `16px`,
- body przewija się wewnętrznie,
- footer: gap `8px`, akcje po prawej.

Domyślne `520px` zmieniaj tylko nazwanym wariantem domenowym. Obecne sensowne klasy szerokości to `420px` dla confirm, `540px` dla Social, `620px` dla channel settings/refresh, `640px` dla channel search/sync, `720px` dla transcript i do `1500px` dla permission matrix. Focus trap i ograniczenie do viewportu pozostają wspólne. Nazwany wariant może zmienić padding, gdy wymaga tego zawartość — np. bezpaddingowy scroll region transkryptu lub macierzy — ale nie powinien niejawnie nadpisywać geometrii globalnym selektorem.

Dla krótkiego „na pewno?” użyj `Popconfirm`. Dla destrukcji z konsekwencjami, dodatkową konfiguracją lub większą ilością tekstu użyj `Dialog` + `Alert danger`.

Kolejność w footerze: anulowanie jako `default`/`ghost`, akcja właściwa po prawej jako `primary` albo `danger`. `busy` ustawia wyłącznie `aria-busy`; aby zablokować Escape, close i kliknięcie tła podczas operacji, przekaż jednocześnie `busy` oraz `dismissible={false}`.

### 6.6. Feedback

**Alert**

- warianty `info | warning | danger | success`,
- padding `10px 12px`, gap `9px`, radius `10px`, border `0`,
- font `13px`, line-height `1.45`,
- bg = semantic base 11% na transparentnym tle,
- danger używa `role="alert"`; pozostałe `role="status"`,
- opcjonalny title jest blockiem i ma margin-bottom `2px`.

**Badge**

- warianty `neutral | accent | danger | success | warning`,
- md: min-height `20px`, padding `1px 8px`, font `11.5px`,
- sm: min-height `18px`, padding `1px 6px`, font `10.5px`,
- radius `999px`, bez bordera,
- badge zawiera nazwę/status/liczbę, nie pełne zdanie.

**Toast**

- fixed bottom `24px`, wycentrowany,
- max-width `min(420px, 100vw - 24px)`,
- padding `12px 20px`, radius `10px`,
- `role="status"`, `aria-live="polite"`,
- nie używaj toastu jako jedynego miejsca informacji o nieodwracalnym błędzie.

**EmptyState**

- zwykły: padding `90px 20px`,
- compact: `24px 16px`,
- icon: `40px`, margin-bottom `14px`,
- title `--text`, font-weight 600,
- description max-width `520px`, margin-top `4px`,
- action margin-top `14px`.

Ilustrowany wariant jest zarezerwowany dla stabilnego, pełnostronicowego pustego stanu głównej destynacji. Szczegóły są w `docs/illustrations.md`; nie dodawaj ilustracji do Settings, filtra bez wyników, błędu ani małego panelu.

Wspólna ilustracja ma scenę `220×150`, badge zawsze w punkcie `(110, 58)` z promieniem `18`. Całość dziedziczy jeden `currentColor = --accent`; nie hardkoduj hexa w scenie. Obrys struktury ma `2.6`, pierścień badge'a `2.4`, glyph `3.2`, a małe karty atmosfery `2`. Linie używają round cap/join, a całe SVG jest `aria-hidden`.

### 6.7. Loading i skeletony

- Dla strony lub grida używaj `DelayedPageSkeleton`/`VideoGridSkeleton`; domyślny delay `200ms` zapobiega miganiu.
- Skeleton ma odpowiadać geometrii docelowej treści, nie być ogólnym prostokątem.
- Base skeleton używa `--surface-2` i shimmer `1.35s`.
- Miniatura skeletonu zachowuje `16:9` i radius `12px`.
- W reduced motion shimmer jest wyłączony.
- W małym menu użyj `MenuLoading`, nie pełnego page skeletonu.
- Krótkie działanie w przycisku pokazuje loader w przycisku, nie osobny overlay.

### 6.8. Specjalistyczne komponenty

- `FileDropzone`: min-height `220px`, padding `48px 32px`, gap `12px`, radius `14px`, dashed border 2 px. Drag-over zmienia border na accent i tło na `--surface-2`.
- `PermissionMatrix`: scrollowalna rama z borderem 1 px, radius `10px`; cells `9px 10px`; sticky header i kolumny. To data-dense wyjątek od borderless.
- `PermissionMatrix`: sticky identity/secondary columns mają na desktopie `220px / 190px`, a do `640px` `160px / 150px`.
- `ScrollArea`: gradient krawędzi ma wysokość `18px`; pojawia się tylko, gdy w danym kierunku istnieje content do przewinięcia.
- `RevealRegion`/`RevealList`: używaj do „pokaż więcej”; nie montuj własnego height animation.
- `PlaylistPicker`, `PlaylistIconPicker`, `SchedulePicker`, `TagPickerMenu`, `SubtitlePicker`: zachowują logikę domenową i wspólne prymitywy; nie przenoś ich API/data fetching do `components/ui`.
- `TagChip`: tylko tag domenowy z kolorem użytkownika. Do ogólnych filtrów używaj `Chip`.
- `TagChip`: font `11px / 500`, padding `2.5px 9px`, gap `5px`, radius pill; transparentny border 1 px rezerwuje miejsce na user-defined kolor.
- `PlaylistIconPicker`: używaj wspólnego katalogu ikon i fallbacku; trigger ma `42×36px` albo compact `30×30px`, a popover max-width `360px`.
- `Tooltip`: tło `rgba(0,0,0,.88)`, tekst biały, font `11px / 500`, padding `4px 9px`, radius `6px`, gap `7px` od anchora.

## 7. Standardowe receptury

### 7.1. Zwykła strona z filtrem i wynikami

```tsx
<>
  <PageHeader
    title={t("pageTitle")}
    description={t("pageDescription")}
    actions={<Button leadingIcon={<Plus />}>{t("add")}</Button>}
  />

  <Tabs
    label={t("resultView")}
    value={view}
    onChange={setView}
    options={viewOptions}
  />

  {loading ? (
    <VideoGridSkeleton />
  ) : items.length === 0 ? (
    <EmptyState icon={<Inbox />} title={t("emptyTitle")} description={t("emptyHint")} />
  ) : (
    <div className="video-grid">…</div>
  )}
</>
```

### 7.2. Formularz poza Settings

```tsx
<Stack as="form" gap={3} onSubmit={submit}>
  <Field label={t("name")} htmlFor="name" error={nameError}>
    <Input id="name" value={name} onChange={onNameChange} />
  </Field>

  <Field label={t("description")} htmlFor="description" hint={t("descriptionHint")}>
    <Textarea id="description" value={description} onChange={onDescriptionChange} />
  </Field>

  <FormActions>
    <Button variant="ghost" onClick={cancel}>{t("cancel")}</Button>
    <Button variant="primary" type="submit">{t("save")}</Button>
  </FormActions>
</Stack>
```

### 7.3. Menu akcji

```tsx
<Popover
  surface="menu"
  align="end"
  trigger={<IconButton label={t("moreActions")} icon={<MoreVertical />} />}
>
  <Menu>
    <MenuItem icon={<Pencil />} onClick={edit}>{t("edit")}</MenuItem>
    <MenuSeparator />
    <MenuItem icon={<Trash2 />} onClick={requestDelete}>{t("delete")}</MenuItem>
  </Menu>
</Popover>
```

Jeżeli menu jest w kontenerze z `overflow`, tę samą zawartość przenieś do `FloatingPopover`; nie zmieniaj geometrii `MenuItem`.

## 8. Dostępność i rodzaje inputu

- Każda kontrolka ma widoczny `:focus-visible`.
- Każdy icon-only button ma lokalizowany `aria-label`.
- `Dialog` używa `descriptionId`, gdy body zawiera opis konsekwencji.
- `Tabs`, `SegmentedControl`, `OptionPicker`, `TriStateSwitch` zachowują role z komponentów; nie zastępuj ich losowymi divami.
- Nie polegaj wyłącznie na kolorze. Selected ma również `aria-selected`/`aria-checked`, ikonę, underline albo zmianę fillu.
- Standardowy cel interakcji ma 36 px. Rozmiar 30 px jest wariantem kompaktowym dla gęstych toolbarów/menu, nie domyślną kontrolką mobilną. Widoczny checkbox lub switch może być mniejszy, jeżeli cały prawidłowo powiązany label/row powiększa hit area.
- Na urządzeniach bez hovera krytyczne akcje muszą być widoczne lub dostępne przez jawny trigger.
- Disabled musi być semantycznym `disabled`, nie tylko obniżoną opacity.
- Status live/loading może używać animacji, ale informacja musi pozostać czytelna po jej wyłączeniu.
- Powierzchnie przewijane używają `overscroll-behavior: contain`, kiedy scroll nie powinien uciekać do strony.
- Długi tekst i tłumaczenia muszą się zawijać; nie projektuj szerokości pod angielski string.

## 9. Treść i lokalizacja

Obsługiwane języki: `en`, `pl`, `de`, `fr`, `es`, `pt-BR`, `ru`, `ja`, `hu`.

- `ui/src/i18n/locales/en.ts` definiuje kontrakt kluczy.
- Każdy nowy lub zmieniony string musi zostać przetłumaczony we wszystkich katalogach w tym samym zestawie zmian.
- Zachowuj placeholdery `{count}`, `{name}`, `{time}` dokładnie w każdym języku.
- Domyślne angielskie fallbacki komponentu nie zwalniają z przekazania lokalizowanego labela, placeholdera lub empty state.
- Tekst przycisku nazywa działanie: „Zapisz”, „Importuj”, „Usuń”. Tooltip może dopowiedzieć warunek, ale nie zastępuje etykiety.
- Opis Settings mówi o skutku i zakresie, nie powtarza labela.
- Alert ma krótki title i jednoznaczny następny krok, jeśli istnieje.
- Empty state ma krótki tytuł i jedno zdanie wyjaśniające, co zapełni ekran.
- Polski copy w ilustracyjnych empty states pozostaje bezosobowy, żeby uniknąć form rodzaju w czasie przeszłym.
- Nie używaj emoji jako ozdobnika w komunikatach systemowych.

Po zmianie copy uruchom:

```sh
bun test ui/src/i18nCatalog.test.ts ui/src/i18nFormatting.test.ts
ui/node_modules/.bin/tsc --noEmit -p ui/tsconfig.json
```

## 10. CSS i własność komponentów

### 10.1. Gdzie trafia styl

| Rodzaj | Lokalizacja |
| --- | --- |
| token/reset/global foundation | `ui/src/styles/` |
| komponent wielokrotnego użytku | CSS obok `ui/src/components/ui/*.tsx` |
| komponent domenowy | CSS obok `ui/src/components/*.tsx` |
| komponent ustawień | CSS obok `ui/src/components/settings/*.tsx` |
| zachowanie wyłącznie jednej strony | CSS obok `ui/src/pages/*.tsx` |

`ui/src/styles.css` zawiera tylko kolejność warstw i importy fundamentów. Nie może zawierać `.watch-*`, `.settings-*`, `.video-*`, `.profile-*`, `.dropdown-*` ani `.ui-*`.

### 10.2. Granice odpowiedzialności

- `components/ui` nie zna filmów, playlist, profili, API ani copy domenowego.
- Komponent domenowy posiada fetching, mutations, loading i przetłumaczone nazwy opcji.
- Wariant wizualny, który pojawia się w co najmniej dwóch domenach, powinien wejść jako typed prop do wspólnego komponentu.
- Nie styluj współdzielonego komponentu głębokim selektorem strony, jeżeli zmiana opisuje wariant możliwy do nazwania.
- Stany są propsami (`variant`, `size`, `selected`, `disabled`), nie umowną mieszanką klas wywołującego.
- `min-width: 0` i zachowanie responsive należą do właściciela layoutu.

### 10.3. Warstwy kaskady

Zadeklarowana kolejność to:

```css
@layer reset, tokens, base, components, pages, utilities;
```

Obecnie większość owner CSS nie jest jeszcze opakowana w `@layer`, więc unlayered rules wygrywają z nazwanymi warstwami. Nie opieraj nowej funkcji na przypadkowej kolejności importów. Ujednolicenie warstw powinno być osobnym, weryfikowanym refaktorem, a nie pobocznym skutkiem feature change.

### 10.4. Tokeny i wartości lokalne

- Użyj istniejącego tokena zawsze, gdy rola jest globalna.
- Lokalny custom property jest poprawny dla obliczanej geometrii komponentu, np. progress, szerokość kolumny lub kolor miniatury.
- Nowa globalna rola używana przez kilka komponentów powinna dostać token zamiast kopiowanego hexa.
- Nie używaj zmiennej bez definicji i bez sensownego fallbacku.
- Nie dodawaj `!important`; obecne użycia nie są wzorcem.
- `color-mix()` jest preferowany dla tinted state zamiast ręcznego dopisywania hex alpha.

## 11. Warstwy z-index

Z-index nie jest jeszcze stokenizowany. Aktualny stack wygląda następująco:

| Poziom | Wartość |
| --- | --- |
| sidebar backdrop | `45` |
| mobile sidebar | `46` |
| topbar | `50` |
| zwykły anchored popover | `60` |
| local toast / lokalny overlay | `80` |
| część domain popovers | `100–200` |
| global toast / zwykły tooltip | `200` |
| fullscreen Shorts | `500` |
| `Dialog` / `FloatingPopover` | `1000` |
| portal tooltip | `1100` |
| drag layer | `2000` |
| legacy `Popconfirm` override | `9999` |

Nie kopiuj `9999`. Przed dodaniem nowej globalnej warstwy należy wprowadzić nazwany token lub ujednolicić istniejący poziom. Overlay musi być testowany z topbarem, sidebar drawerem, dialogiem, floating popoverem i tooltipem jednocześnie.

## 12. Znane odstępstwa i dług systemu

Poniższe elementy opisują stan repozytorium, ale nie są wzorcem do kopiowania:

1. `--danger` jest używany w `ui/src/pages/BookmarksPage.css`, ale nie istnieje w tokenach; deklaracje z nim są nieważne.
2. `--font-mono` jest używany w `ui/src/components/DownloadConfiguration.css`, ale nie jest zdefiniowany.
3. Roboto jest wpisany w stack, ale aplikacja go nie ładuje ani nie bundluje.
4. Success/warning/danger mają wspólne kolory bazowe, lecz kilka komponentów posiada osobne foreground hex values. Paleta statusów wymaga przyszłej tokenizacji.
5. Istnieje tylko jeden token radius mimo wielu celowych wartości; zapis pill występuje jako `99px` i `999px`.
6. Shadow, motion, z-index, breakpoint i type scale nie mają globalnych tokenów.
7. Większość CSS komponentów i stron nie używa zadeklarowanych `@layer components/pages`.
8. Część wspólnej responsywności `PageHeader`, `List` i `SettingRow` nadal mieszka w `SettingsPage.css` zamiast przy właścicielu.
9. Nie wszystkie `Button`, `MenuItem`, tabs, chipy i pickery mają jeszcze jednakowo jawny focus/disabled style. W szczególności `Button` nadal reaguje regułą hover mimo `disabled`. Celem nowych zmian jest standard 2 px accent i brak hover dla disabled.
10. `Popover`/`Menu` zamykają się po Escape, ale menu nie ma jeszcze pełnego roving focus/sterowania strzałkami. `Dialog` ma pełny focus trap.
11. `Tooltip` bez portalu opiera widoczność głównie na hoverze; nie może być jedynym źródłem informacji.
12. `Popconfirm` zachowuje legacy border i `z-index: 9999`; nie należy na jego podstawie projektować nowej powierzchni.
13. Repo ma wiele owner-specific breakpointów. Nie każdy z nich jest globalnym standardem.
14. Są luki w `prefers-reduced-motion` i pojedyncze zależności animacji między plikami; nowy kod musi pozostać samowystarczalny.
15. Plugin modal oraz część PIN/relogin overlays nadal omijają wspólny `Dialog`; nie kopiuj ich mechaniki ani CSS.
16. Feed onboarding, Bookmarks i część starszych settings/auth cards mają dekoracyjne obrysy. To istniejące wyjątki migracyjne, nie nowa zasada powierzchni.
17. Insights jest celowym wyjątkiem data-visualization: niektóre wykresy używają bardzo subtelnych linii `rgba(255,255,255,.055–.08)` dla osi i siatki. Te linie opisują dane, nie ramują zwykłej karty.
18. Bookmarks jako główna destynacja używa obecnie zwykłego `EmptyState icon` i nie ma przydzielonej ilustracji w `docs/illustrations.md`. Nie dodawaj sceny bez aktualizacji kontraktu ilustracji.
19. `--live` jest nadal używany przez część legacy komunikatów błędu. Docelowo błędy mają korzystać z roli danger, a `--live` zostaje przy transmisji, watched/playback progress i domyślnej czerwieni znaku aplikacji.

Te punkty powinny być naprawiane osobnymi, małymi zmianami z testem wizualnym. Nie należy „normalizować” ich przy okazji niepowiązanego feature bez sprawdzenia regresji.

## 13. Checklist przed zakończeniem zmiany UI

### Komponenty i układ

- [ ] Sprawdzono `ui/src/components/ui` i istniejące komponenty domenowe.
- [ ] Settings używa `SettingsSection`, `SettingRow`, `Field` i shared controls.
- [ ] Karta/panel nie dostały dekoracyjnego bordera.
- [ ] Padding, gap, radius i typografia odpowiadają recepturze komponentu.
- [ ] Layout ma `min-width: 0`, poprawne wrap/ellipsis i nie powoduje overflow.
- [ ] Mobile korzysta z istniejącego breakpointu lub uzasadnionego container query.
- [ ] Popover używa właściwego wariantu zwykłego albo floating.

### Stany i dostępność

- [ ] Hover, focus-visible, active, disabled, loading, empty i error są obsłużone.
- [ ] Kluczowa akcja działa klawiaturą i bez hovera.
- [ ] Icon-only button ma lokalizowany label.
- [ ] Informacja nie jest przekazywana wyłącznie kolorem.
- [ ] Motion ma wariant reduced-motion.
- [ ] Długi tekst i wszystkie języki mieszczą się lub poprawnie zawijają.

### Copy i weryfikacja

- [ ] Wszystkie stringi są w katalogu i18n dla 9 języków.
- [ ] Empty state używa ilustracji tylko zgodnie z `docs/illustrations.md`.
- [ ] Uruchomiono tylko potrzebne testy, typecheck/build i `git diff --check`.
- [ ] Dla zmiany UI sprawdzono co najmniej 360, 768, 1280 i 1920 px.
- [ ] Nie uruchomiono pełnego `check:precommit` ani `check:validate`.

## 14. Mapa plików źródłowych

- Fundamenty: `ui/src/styles/tokens.css`, `reset.css`, `typography.css`, `scrollbars.css`, `utilities.css`.
- Shell: `ui/src/AppShell.css`, `ui/src/app-shell/`.
- Publiczny UI: `ui/src/components/ui/index.ts` i pliki obok niego.
- Ustawienia: `ui/src/components/ui/Settings.*`, `SettingsNav.*`, `ui/src/components/settings/`, `ui/src/pages/SettingsPage.css`.
- Media: `ui/src/components/VideoCard.css`, `VideoCardMetadata.css`, `VideoGrid.css`, `VideoThumbnail.*`.
- Feedback/loading: `ui/src/components/ui/Feedback.*`, `Progress.*`, `ui/src/components/LoadingState.*`.
- Overlaye: `ui/src/components/ui/Popover.*`, `FloatingPopover.*`, `Dialog.*`, `Menu.*`, `ui/src/components/Tooltip.*`.
- Ilustracje i voice: `docs/illustrations.md`, `ui/src/components/illustrations/`.
- Lokalizacja: `docs/localization.md`, `shared/uiLanguages.ts`, `ui/src/i18n/`.
- Reguły repozytorium: `AGENTS.md`.
