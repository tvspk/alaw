# Alaw

Alaw (velšsky „melodie“): texty písní (hlavně velšských) a jejich učení nazpaměť. Webová aplikace (PWA) pro Android i počítač, funguje offline.

## Co umí (verze 0.4)

- Knihovna písní s hledáním (i v textu, bez ohledu na stříšky), štítky a filtrem jazyka.
- Přidání písně: prostý text nebo LRC s časy, sloky oddělené prázdným řádkem, načtení ze souboru.
- Nahrávka: video z YouTube nebo vlastní zvukový soubor (mp3, m4a, ogg, wav, flac…) uložený v zařízení.
- Přehrávač: zpomalení 0,75× / 0,5×, skok o 5 s zpět, ťuknutí na verš = přehrát od něj, zvýraznění aktuálního verše.
- Smyčka jednoho verše nebo úseku veršů.
- Časování veršů ťukáním do rytmu (s krokem zpět a posunem všech časů).
- Režimy učení: Číst, Mizení (nastavitelné procento skrytých slov), Písmena (jen první písmeno); ťuknutím slovo odkryješ.
- U každého verše překlad, doslovný překlad, hovorové zkratky a vlastní poznámka.
- **Učení naostro** (tlačítko „Učit se“ v písni): nové verše po dvojicích (přečíst a poslechnout), pak podle prvních písmen,
  „jak verš zní?“ (vybav si verš po předchozím) a u dobře známých veršů psaní zpaměti (stříšky, velikost písmen,
  interpunkce ani drobný překlep nevadí). Po každém cvičení hodnocení Znovu / Těžké / Dobře / Snadno a opakování
  v intervalech (1 den, 3, 8…). Refrén se stejným textem se učí jednou. Nových veršů denně nastavitelně (výchozí 6).
- **Mapa písně** (režim Mapa): co umíš, co se učíš, co je k opakování a kdy; ťuknutím procvičíš jeden verš.
  Na úvodní obrazovce proužek pokroku u písní a nenápadná připomínka, když verše jiné písně začínají slábnout.
- Záloha do JSON (volitelně se zvukem, vždy s pokrokem učení) a import, včetně JSON z projektu „Lyrics Trainer“.
- **Hledání textů** najednou v LRCLIB (i s časy), Welsh Lyrics wiki (welshlyrics.fandom.com, často s anglickým překladem a videem),
  LyricsTranslate, Wicidestun (velšská Wikisource), Bandcamp, We Learn Welsh, Genius a AZLyrics. Náhled, převzetí do písně,
  doplnění časů z LRCLIB podle shodných veršů, anglický překlad ze zdroje u veršů.
- **Text z odkazu** a **sdílení z prohlížeče** (Android: Sdílet → Alaw): z neznámé stránky se vybere blok, který vypadá jako text písně.
- **Překlady přes Gemini** (vlastní klíč, uložený jen v zařízení): český volný a doslovný překlad, hovorové zkratky,
  vysvětlení verše slovo po slovu.
- **Aplikace pro Android (APK)**: stejná aplikace ve WebView, stahuje stránky sama (bez prostředníka), ukládání souborů,
  tlačítko Zpět, nabídka nové verze. Vydává se automaticky přes GitHub Actions (`android/verze.txt`).
- **Synchronizace** mezi telefonem a počítačem přes vlastní soukromý repozitář na GitHubu, šifrovaně (AES-256-GCM,
  párovací kód 8 slov, i jako QR). Písně, překlady, časy, nahrávky i pokrok učení; novější úprava vyhrává.

## Spuštění na počítači

```
python3 -m http.server 8000
```
a otevřít http://localhost:8000

## Vývoj

- Bez sestavování: čisté HTML, CSS a JavaScript (ES moduly) v `index.html`, `css/`, `js/`.
- Po každé změně souborů spusť `python3 scripts/build_sw.py` (aktualizuje seznam souborů a verzi v `sw.js`).
- Testy: `python3 testy/test_zaklad.py`, `python3 testy/test_hledani.py` (Playwright, Chromium jako Pixel 7, bez sítě),
  `python3 testy/test_sync.py` (napodobený GitHub), `node testy/test_worker.mjs`. Kontrola zdrojů proti skutečným webům: `python3 testy/zdroje_naostro.py`.
- APK: `sh android/build.sh` (nástroje z npm, Java 17). Prostředník pro počítač: `worker/` (návod v `worker/README.md`).
