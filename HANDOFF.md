# Alaw – předávací dokument

> Závazný popis stavu projektu pro další chat. Platí spolu s `CLAUDE.md` (pravidla) a `README.md` (co aplikace umí).
> Stav k 20. 11. 2026, verze **0.9.0** (APK versionCode 13). Odpovídej zadavateli **česky**.

## Co to je

Alaw (velšsky „melodie“) je aplikace na texty písní, hlavně velšských, a jejich učení nazpaměť.
Zadavatel není programátor: kroky mimo kód (GitHub, Cloudflare, Google) mu dávej **po jednom**, se slovy, na co přesně kliknout,
a čekej na „hotovo“. Písně si dodává sám, aplikace nemá vlastní knihovnu textů.

- Web: https://tvspk.github.io/alaw/ (GitHub Pages z `main`, kořen repozitáře)
- APK: https://github.com/tvspk/alaw/releases/latest/download/alaw.apk (vydává GitHub Actions)
- Kód: veřejný `tvspk/alaw`. Claude má přístup s push (GitHub App). Schránka synchronizace `tvspk/alaw-sync` je soukromá
  a Claude do ní přístup **nemá a mít nemá**.

## Hotovo (všech 5 kroků původního plánu + rozšíření)

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

6. **Písně z nahrávek (0.7):** `js/bulk.js`, obrazovky `#/bulk` (přidání) a `#/lyrics` (hledání textů).
   Zadavatel má ve složce na PC přes 100 nahrávek (mp3 a wav, ~1,1 GB), žádné texty. **Rozhodnutí zadavatele:** přidat
   **všechny**, **wav nepřevádět** (zvuk se nezmenšuje), soubory si nechá přejmenovat na „Interpret - Název“ (s Claude přes
   aplikaci Claude pro počítač; neznámého interpreta doplní ručně).
   - Název/interpret: název souboru s „ - “ (i –, —; číslo stopy pryč; spojovník uvnitř slova nedělí) > údaje v souboru
     (ID3v2/v1, RIFF INFO nebo id3 kousek ve wav) > název souboru. Duplicity (stejný interpret+název, nebo soubor stejného
     jména a velikosti) jsou předem odškrtnuté. Výběr víc souborů (`ui.pickFiles`), na počítači i celá složka
     (`webkitdirectory`); APK `MainActivity` přijímá víc souborů (`EXTRA_ALLOW_MULTIPLE` + `ClipData`).
   - Píseň = `newSong` s `source:'nahrávka'`, nahrávka, `lines:[]`. Formát se nemění (`v:1`).
   - Texty: LRCLIB (`lrclib.search` vrací i `dur`), `rankLyrics` + `isSure` (název ≥ 0,8, interpret ≥ 0,5, délka ±3 s;
     bez nahrávky interpret ≥ 0,8). **Nic se neuloží bez potvrzení** (po jedné, nebo „Převzít všechny jisté“).
     Časy z LRCLIB jen když sedí délka, jinak prostý text. `applyLyrics` přepíše jen prázdnou hlavní verzi (z „Hledat jinde“
     a náhledu i neprázdnou). Doplní interpreta, když chybí. V knihovně proužek „N písní nemá text“.
   - Riziko: 1,1 GB zvuku v synchronizaci = schránka na GitHubu přes 1 GB (GitHub doporučuje do 1 GB, tvrdě do 5 GB)
     a telefon stáhne vše. Nahrávání je po souborech zapamatované (`c.files`), po přerušení pokračuje.
   - Test: `python3 -u testy/test_hromadne.py` (napodobené LRCLIB a prostředník, ffmpeg vyrobí mp3 s ID3 a wav s INFO).
   - **0.7.1 – texty odkudkoli:** Claude ani Gemini texty chráněných písní nevypíšou, umí ale najít **odkaz**; text pak
     stáhne aplikace sama (`sources.loadFromUrl`, obecný výběr bloku s textem). Placené vyhledávací API zadavatel nechce
     (Gemini s Google Search jde jen s placením, Google Custom Search končí 1. 1. 2027, Brave chce kartu).
     - V okně hledání „🌐 Hledat na Googlu“ (`search.googleUrl`, u velštiny „geiriau lyrics“) a „🔗 Vložit odkaz“.
       S `openSearch(…, { songId })` se uloží `prefs.shareTarget` → sdílení stránky z prohlížeče do 3 h nabídne „K písni …“
       (`app.js offerShare`), jinak nová píseň jako dřív.
     - **Soubor s odkazy** (Najít texty → „📄 Načíst odkazy ze souboru“, `bulk.parseLinkFile`/`matchLinks`): pro hromadné
       dohledání ho připraví Claude (web search, jen odkazy, nikdy texty). Formát: text, na řádku `Interpret - Název<TAB>https://…`
       (víc adres na řádku = alternativy, `#` = poznámka), nebo JSON `[{ artist, title, url | urls[] }]`. Páruje se interpret+název,
       jinak jednoznačný název, jen s písněmi bez textu. Text z odkazu = „doporučený“ (převzít všechny), nefunkční → LRCLIB.
       Na počítači potřebuje prostředníka (většina webů nemá CORS); v APK přímo.

7. **Přepis z nahrávky, výměna hlavní verze, hromadné mazání (0.8):**
   - `ai.transcribeAudio` (Gemini, klíč zadavatele): do 14 MB `inline_data`, větší přes Files API (`upload/v1beta/files?uploadType=multipart`,
     čekání na `ACTIVE`, po přepisu `DELETE`). Odpověď JSON `{ lines: [{ start (s), text, new_stanza }] }`, `cleanTranscript`
     (prázdné a „…“ pryč; časy jen když jsou všechny a rostou). Odmítnutí kvůli autorským právům (`RECITATION`) = hláška u písně.
     **Nahrávání přes Files API nešlo z prostředí Claude ověřit proti skutečnému Googlu (síť) – ověřit u zadavatele na WAV.**
   - `bulk.transcribeToSong`: **rozhodnutí zadavatele: píseň s textem → přepis jako další verze** („Přepis z nahrávky“, (2)…),
     bez textu → hlavní verze. Časy jen pro nahrávku, ze které se přepisovalo; nenačasovaná hlavní verze převezme časy
     (`borrowTimes`). Hromadně v Najít texty (stop při vyčerpaném limitu / neplatném klíči).
   - `versions.makePrimary` + `compare.js` „⭐ Udělat hlavní verzí“: pokrok převeden (`moveProgress` pro sporná místa),
     rozhodnutí sporných míst se vynulují, nahrávka/YouTube přejde na novou hlavní, nemá-li vlastní.
   - Knihovna: režim výběru (☑, `libState.sel`), smazání označených přes `store.deleteSong` (náhrobky, nahrávky, pokrok).
   - **Kontrola projektu (2 kola) a opravy:** (1) synchronizace mohla smazat nahrávku uloženou těsně před písní (hromadné
     přidání!) → `db.freshAudio` + kontrola aktuálních písní před mazáním; (2) při nahrávání stovek MB zvuku se stav zapisuje
     průběžně po 200 MB (`COMMIT_EVERY`), kousky jsou hned ukotvené a druhé zařízení může stahovat; (3) záloha se zvukem nad
     300 MB nabídne zálohu bez zvuku (jinak by prohlížeč spadl); (4) sdílení do písně, která už text má, se zeptá;
     (5) test synchronizace se občas zasekl (zámek v napodobeném GitHubu) → `RLock`.
   - Test: `python3 -u testy/test_prepis.py` (napodobené Gemini vč. Files API a Groq).
8. **Whisper přes Groq (0.9):** zadavatel chtěl další službu k Gemini. `js/stt.js` (služby `ENGINES` gemini/groq, `pickEngine` se
   zeptá, když jsou dvě; předvybraná `prefs.stt`), klíč `localStorage['alaw-groq']` (`gsk_…`, ve workflow kontrola klíčů).
   `POST api.groq.com/openai/v1/audio/transcriptions` (multipart, `whisper-large-v3`, záloha `-turbo`, `verbose_json`, `language`
   jen cy/en/br/cs, `prompt` = název). Úseky → verše (`whisperLines`: pryč ♪, `no_speech_prob`, opakování; pauza > 3,5 s = sloka).
   Limit 25 MB → `audioprep.toSpeechWav` (mono 16 kHz WAV, jen dočasná kopie); totéž u Gemini, když je kopie menší
   (většina WAV tak obejde Files API). Hromadně: při 429 počká minutu (max. 3×), pak stop. Popisky verzí „Přepis (Gemini)“,
   „Přepis (Whisper)“. **CORS Groq ani Gemini Files API nešlo z prostředí Claude ověřit – ověřit u zadavatele.**

Ověřeno zadavatelem na telefonu: hledání, sdílení, YouTube, vlastní mp3, Gemini, prostředník, synchronizace.
Učení (0.4, 0.5), verze (0.6), písně z nahrávek (0.7) a přepis/výměna verze/mazání (0.8) zatím jen testy v prostředí Claude – **ověřit na telefonu**.

## Zbývá (původní plán)

- Původní plán je hotový. Možná rozšíření (zatím nezadaná): sdílení z Androidu rovnou do nové verze.
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
  `python3 -u testy/test_zaklad.py`, `python3 -u testy/test_verze.py`, `python3 -u testy/test_hledani.py`, `python3 -u testy/test_hromadne.py`, `python3 -u testy/test_prepis.py`, `python3 -u testy/test_sync.py`,
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
localStorage: `alaw-prefs` (zařízení, i `newPerDay`, `alwaysType`, `autoPlayLine`, `remindHidden`), `alaw-ai` (klíč Gemini), `alaw-groq` (klíč Groq), `alaw-sync` (token + 8 slov, jen zařízení).
