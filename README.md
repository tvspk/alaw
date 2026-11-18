# Alaw

Alaw (velšsky „melodie“): texty písní (hlavně velšských) a jejich učení nazpaměť. Webová aplikace (PWA) pro Android i počítač, funguje offline.

## Co umí (verze 0.1)

- Knihovna písní s hledáním (i v textu, bez ohledu na stříšky), štítky a filtrem jazyka.
- Přidání písně: prostý text nebo LRC s časy, sloky oddělené prázdným řádkem, načtení ze souboru.
- Nahrávka: video z YouTube nebo vlastní zvukový soubor (mp3, m4a, ogg, wav, flac…) uložený v zařízení.
- Přehrávač: zpomalení 0,75× / 0,5×, skok o 5 s zpět, ťuknutí na verš = přehrát od něj, zvýraznění aktuálního verše.
- Smyčka jednoho verše nebo úseku veršů.
- Časování veršů ťukáním do rytmu (s krokem zpět a posunem všech časů).
- Režimy učení: Číst, Mizení (nastavitelné procento skrytých slov), Písmena (jen první písmeno); ťuknutím slovo odkryješ.
- U každého verše překlad, doslovný překlad, hovorové zkratky a vlastní poznámka.
- Záloha do JSON (volitelně se zvukem) a import, včetně JSON z projektu „Lyrics Trainer“.

## Spuštění na počítači

```
python3 -m http.server 8000
```
a otevřít http://localhost:8000

## Vývoj

- Bez sestavování: čisté HTML, CSS a JavaScript (ES moduly) v `index.html`, `css/`, `js/`.
- Po každé změně souborů spusť `python3 scripts/build_sw.py` (aktualizuje seznam souborů a verzi v `sw.js`).
- Test: `python3 testy/test_zaklad.py [složka_pro_snímky]` (Playwright, Chromium jako Pixel 7).
