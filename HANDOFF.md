# Alaw – předávací dokument

> Závazný popis stavu projektu pro další chat. Platí spolu s `CLAUDE.md` (pravidla) a `README.md` (co aplikace umí).
> Stav k 19. 11. 2026, verze **0.6.0** (APK versionCode 9). Odpovídej zadavateli **česky**.

## Co to je

Alaw (velšsky „melodie“) je aplikace na texty písní, hlavně velšských, a jejich učení nazpaměť.
Zadavatel není programátor: kroky mimo kód (GitHub, Cloudflare, Google) mu dávej **po jednom**, se slovy, na co přesně kliknout,
a čekej na „hotovo“. Písně si dodává sám, aplikace nemá vlastní knihovnu textů.

- Web: https://tvspk.github.io/alaw/ (GitHub Pages z `main`, kořen repozitáře)
- APK: https://github.com/tvspk/alaw/releases/latest/download/alaw.apk (vydává GitHub Actions)
- Kód: veřejný `tvspk/alaw`. Claude má přístup s push (GitHub App). Schránka synchronizace `tvspk/alaw-sync` je soukromá
  a Claude do ní přístup **nemá a mít nemá**.

## Hotovo (všech 5 kroků původního plánu)

1. **Základ (0.1):** knihovna, přidání písně (text / LRC), přehrávač (YouTube i vlastní soubor, rychlost, smyčka veršů,
   karaoke), časování ťukáním, režimy Číst / Mizení / Písmena, překlad, doslovný překlad, zkratky a poznámky u veršů,
   záloha JSON (i se zvukem), PWA offline.
2. **Hledání textů (0.2):** `js/sources.js`: LRCLIB, Welsh Lyrics wiki (fandom), LyricsTranslate, Wicidestun, Bandcamp,
   We Learn Welsh, Genius, AZLyrics. Náhled, doplnění časů z LRCLIB, anglický překlad ze zdroje (`line.alt`),
   text z odkazu a sdílení z Androidu. Na počítači přes prostředníka `worker/` na Cloudflare (nasazený, funguje).
   **Gemini** (`js/ai.js`): překlad, doslovný překlad, zkratky, vysvětlení verše. Opakování při přetížení (503),
   časový limit 45 s, záložní modely, nový formát klíče `AQ.…` (funguje). Zadavatel má klíč zdarma.
   **APK** (`android/`): WebView z `https://appassets.androidplatform.net/`, nativní stahování (bez CORS), ukládání
   souborů, tlačítko Zpět, nabídka nové verze, kamera pro QR.
5. **Synchronizace (0.3):** `js/sync.js` + `js/syncui.js`, podle vzoru tvspk/gorsaf a tvspk/memochat (skill
   „synchronizace-pres-github“). Rozhodnutí zadavatele: **novější úprava vyhrává**, **zvuk se stahuje hned celý**,
   **zvuk se nezmenšuje**. Zadavatel ji nastavil na telefonu (APK) i na počítači (web) a funguje.

4. **Učení naostro (0.4):** `js/learn.js` (čisté funkce: klíč verše, SRS, porovnání psaní, slučování),
   `js/lesson.js` (obrazovka `#/learn/<id>` a `#/learn/<id>/<klíč verše>`), mapa v `js/song.js` (režim Mapa),
   proužek a připomínka v knihovně (`js/app.js`), sekce Učení v Nastavení. **Rozhodnutí zadavatele:**
   - učí se **vždy jednu píseň** → opakování jen uvnitř písně, žádná společná denní fronta; ostatní písně úvodní
     obrazovka jen **nenápadně připomene** (max. 2, kromě naposledy procvičované, ✕ skryje na týden),
   - hodnotí **vždy sám 4 stupni** (Znovu / Těžké / Dobře / Snadno); u psaní je jen zvýrazněný návrh podle chyb,
   - **refrén sdílí pokrok** (jednotka učení = verš podle znění, klíč `lineKey` = text bez velikosti, interpunkce a znamének),
   - **stříšky se při psaní ignorují úplně** (bez upozornění); drobný překlep (1 písmeno od 4 písmen, 2 od 8) se uzná a jen označí.
   Cvičení: nový → úvodní karta (+ poslech úseku, když je verš načasovaný); 1. krok → první písmena; dál → „Jak verš zní?“
   (vidíš předchozí verš); interval ≥ 7 dní → psaní zpaměti (volba „Vždy psát“). Kroky učení 1 a 10 min, pak dny (SM-2).
   Přepsaný verš (jiný klíč) začíná znovu. Pokrok je v IndexedDB `progress` (DB verze 2), v záloze `progress[]`
   a v synchronizaci `prog[]`: **po záznamech, naposledy změněný vyhrává** (`t` = `stamp()`), vynulování = nový záznam
   (bez náhrobků), pokrok smazané písně se zahodí. Formát stavu zůstal `v:1` (přidání, starší verze `prog` ignorují).

   **0.5 – další způsoby učení** (zadavatel vybral z brainstormingu; zamítl: ztlumení zvuku „zpívej sám“, stínování
   se zrychlováním, nahrávání sebe, kvíz zkratek, opakování jen na poslech):
   - Cvičení na verš v lekci **střídá aplikace sama** (`learn.pickExercise`, úrovně `LEVELS` podle síly verše, ne dvakrát
     za sebou stejné); každé jde vypnout (Nastavení → Učení, `prefs.exOff`). „Jak verš zní?“ zůstane vždy jako záloha.
     Úroveň 0: první písmena, doplň slovo, skládání slov; 1: jak verš zní, bliknutí, výběr ze tří, diktát;
     2: jak verš zní, z češtiny, napřeskáčku, výběr ze tří, diktát; 3 (≥ 7 dní): psaní, skládání slov, diktát, z češtiny.
   - **Časované texty často nebudou**: cvičení s nahrávkou (diktát, poslech) se nabídnou **jen když je verš načasovaný**
     a nahrávka je připravená; jinak se lekce obejde bez nich. Z češtiny jen u veršů s překladem.
   - Skládání slov **nikdy na čas**. Špatné možnosti (doplň slovo, výběr ze tří) **ze stejné písně**, co nejpodobnější.
   - **Procvičit celou píseň** (`js/drill.js`, `#/drill/<id>/<order|blur|cheat|exam>`): skládání sloky, rozmazávání
     (po kolech; s časy smyčka sloky přidává kola sama), tahák pro zpěv, zkouška celé písně – **do opakování jen chyby**
     (nevěděný verš → zpět do učení), známé verše se nemění. Ostatní procvičování pokrok nemění.
   - Testovací háčky: `window.__alawForceEx` (vynutit cvičení), `window.__alawFlashMs` (délka bliknutí).

3. **Verze a sporná místa (0.6):** `js/versions.js` (čisté funkce: porovnání, rozhodnutí, varianty pro učení),
   `js/compare.js` (obrazovka `#/compare/<id>[/<idVerze>[/<verš>]]`), přidání/úprava verze = `js/edit.js` přes
   `#/version/<id>/<idVerze|new>`. **Rozhodnutí zadavatele:**
   - **hlavní + nejvýš 2 další verze** (`MAX_VERSIONS = 3`); reálně spíš jedna další. S jedinou verzí se nic nového neukazuje.
   - učí se vždy hlavní verze; porovnává se celá píseň **po slovech** (LCS na klíčích slov jako `lineKey`), takže jinak
     zalomené řádky rozdíl nedělají. Sporné místo = slova v jednom verši hlavní verze; větší přepis přes víc veršů = „mixed“
     (jen ✓/⚠). Verše jen v jedné verzi zvlášť, nepočítají se jako sporné (často vynechaný refrén); ty z druhé verze jdou
     přidat do hlavní.
   - rozhodnutí: ✓ platí hlavní (`st:'ok'`), ⚠ nejisté (`st:'unsure'`), ✓ platí druhá = **přepíše hlavní verzi** a
     **pokrok verše zůstane** (`store.moveProgress` zkopíruje záznam na nový klíč, starý zůstane).
   - **obě varianty uzná psaní zpaměti jen u ⚠ nejistých míst** (ne u ověřených ani nerozhodnutých); lekce pak napíše
     „Uznáno podle jiné verze“. Doplň slovo nehádá nejisté ani nerozhodnuté slovo. Zkouška a odkrytý verš ukážou ⚠ poznámku.
   - poslech: smyčka verše 0,75× (lze 0,5× / 1×), z nahrávky hlavní verze, nebo druhé verze, má-li vlastní (časy pak z ní).
     **Nenačasovaný verš → „⏱ Načasovat verš“**: ťuk na začátku a konci; uloží začátek verše a začátek dalšího (když ho nemá).
   - v písni: ⚠ u verše s nerozhodnutým/nejistým místem (vede na porovnání toho verše), proužek se souhrnem nad textem,
     v nabídce „Porovnat verze textu“ a „Přidat verzi textu z jiného zdroje…“.
   - data: `line.vars = [{ w, a, b, st }]` jen u hlavní verze (nepovinné, prázdné se neukládá), formát zůstal `v:1`.
     **Starší verze aplikace `vars` při synchronizaci zahodí** → na všech zařízeních mít 0.6. Neplatná rozhodnutí uklízí `prune`.
   - opraveno i dřívější „null“ v kartě lekce (po odkrytí), v procvičování a ve vysvětlení verše (`ui.fill`).

Ověřeno zadavatelem na telefonu: hledání, sdílení, YouTube, vlastní mp3, Gemini, prostředník, synchronizace.
Učení (0.4, 0.5) a verze (0.6) zatím jen testy v prostředí Claude – **ověřit na telefonu**.

## Zbývá (původní plán)

- Původní plán je hotový. Možná rozšíření (zatím nezadaná): sdílení z Androidu rovnou do nové verze, výměna hlavní verze.
- Drobnosti: pruh nové verze se objeví až po 20 h od poslední kontroly (záměr). Genius z prostředí Claude netestovatelný
  (blokuje servery). Na počítači může prostředník narazit na blokaci u Genius a Bandcampu.

## Známá rizika a doporučení (kontrola před 0.6, nic akutního)

- APK: most `AlawAndroid` (`addJavascriptInterface`) je vidět i ve vloženém přehrávači YouTube. Nemá přístup k tokenům ani
  datům, `saveFile` vždy potvrzuje uživatel a `open` pouští jen vydání tohoto projektu. Čistší by bylo
  `WebViewCompat.addWebMessageListener` s povoleným původem jen `https://appassets.androidplatform.net` (vyžaduje knihovnu
  androidx.webkit a test na telefonu).
- Prostředník `worker/` ověřuje jen hlavičku `Origin` (mimo prohlížeč jde podvrhnout) → prakticky veřejný prostředník jen na
  textové stránky do 4 MB, jen https. Pro osobní použití v pořádku; při zneužití stačí ve Cloudflare worker vypnout.
- Porovnání verzí počítá tabulku slov × slov; nad ~2000 slov na verzi se nepočítá (hláška „příliš dlouhý“).

## Jak pracovat

- Po každé změně v `index.html`, `css/`, `js/` spusť `python3 scripts/build_sw.py` (workflow jinak selže).
- Testy (Playwright, Chromium jako Pixel 7, bez sítě):
  `python3 -u testy/test_zaklad.py`, `python3 -u testy/test_verze.py`, `python3 -u testy/test_hledani.py`, `python3 -u testy/test_sync.py`,
  `node testy/test_worker.mjs`. Kontrola zdrojů proti skutečným webům: `python3 testy/zdroje_naostro.py`.
  Spouštěj s `-u` a výstup do souboru (`> /tmp/x.log`): přes rouru s `grep` se dlouhé testy zasekávaly.
- Playwright Chromium nemusí být nainstalovaný: `python3 -m playwright install chromium`.
- **Nová verze APK:** zvyš `android/verze.txt` („versionCode versionName“, versionCode vždy +1) a `APP_VERSION`
  v `js/app.js`, push do `main` → Actions postaví, ověří certifikát (SHA-256 `c633f3c8…a46da7`) a vydá `v<verze>`.
  Podpisový klíč je jen v Secrets (`ALAW_KEYSTORE`, `ALAW_KEYSTORE_PASSWORD`, alias `alaw`) a u zadavatele ve správci
  hesel. Místně ho Claude nemá: `sh android/build.sh` pak staví zkušebním klíčem (stačí na kontrolu, že se APK sestaví).
- Kontrola nasazení: `gh api repos/tvspk/alaw/actions/runs`, `gh api repos/tvspk/alaw/releases/latest`.
- Workflow odmítne commit, ve kterém je něco jako token (`github_pat_…`, `AIza…`, `AQ.Ab…`). V testech zkušební tokeny
  rozděl na dvě části (viz `testy/test_sync.py`).
- Síť z prostředí Claude jde jen na domény povolené v claude.ai → Settings → Capabilities (zadavatel přidal zdroje textů,
  YouTube, Wikisource, hymnary). Wikisource občas vrací 429 (sdílená IP), Fandom chce popisný User-Agent.
- Atribuce commitů: řádky `Co-Authored-By` a `Claude-Session` podle systémové připomínky aktuálního chatu.

## Formát dat (shrnutí, podrobně `js/model.js`)

Píseň `{ v:1, id, title, artist, language, tags[], createdAt, updatedAt, primary, versions[] }`,
verze `{ id, label, source, sourceUrl, youtubeId, audio:{key,name,type,size}|null, lines[] }`,
verš `{ id, start(ms|null), text, literal, translation, alt, contractions[{short,full,note}], note, stanza, vars?[{w,a,b,st}] }`.
IndexedDB `alaw` (verze 2): `songs`, `audio` (Blob podle `audio.key`), `meta` (`tombs` = náhrobky pro synchronizaci),
`progress` (pokrok `{ id:'idPísně|klíč', s, k, st, step, due, ivl, ease, reps, lapses, intro, last, t }`, viz `js/learn.js`).
localStorage: `alaw-prefs` (zařízení, i `newPerDay`, `alwaysType`, `autoPlayLine`, `remindHidden`), `alaw-ai` (klíč Gemini), `alaw-sync` (token + 8 slov, jen zařízení).
