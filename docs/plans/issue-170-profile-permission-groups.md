# #170 — uprawnienia profili, grupy i macierz dostępu

## Cel

Zastąpić globalne `profile_admin_only_areas` polityką przypisaną do profilu:
grupa daje bazowe uprawnienia, a komórka macierzy może je dziedziczyć,
zezwalać albo blokować. Administratorzy zachowują bypass, zaś ustawienia
globalne i bezpieczeństwo pozostają administracyjne.

## Zakres

1. Jeden katalog typowanych uprawnień dla tras, ustawień i UI.
2. Tabele grup, praw grup, przypisania profilu, nadpisań oraz domyślnej grupy;
   migracja SQLite/PostgreSQL z `profile_admin_only_areas`.
3. API efektywnych praw oraz administracyjne API grup i macierzy.
4. Ekran Settings oparty o współdzieloną, dostępną macierz uprawnień.
5. Rozdzielenie ustawień własnych pluginów od administracyjnego zarządzania
   pluginami oraz jawna klasyfikacja wszystkich kluczy ustawień.
6. Wersjonowane sekcje portable backup dla polityki instancji i profilu,
   kompatybilne ze starym formatem.
7. Pełne tłumaczenia, testy migracji, autoryzacji, backupu i UI.

## Kryteria akceptacji

- Dorosły profil może zmienić własne ustawienia, w tym język i `feed_sort`.
- Jawne `deny` daje `403` i ukrywa niedostępną funkcję w UI.
- Grupy, grupa domyślna i nadpisania są zapisywane atomowo oraz wersjonowane.
- Ustawienia globalne, sekrety, role i operacje administracyjne pozostają
  chronione.
- Backup nie eksportuje sekretów ani roli administratora, a restore jest
  idempotentny i kompatybilny z dotychczasową polityką.
