# Alaw – předávací dokument

> Závazný popis stavu projektu pro další chat. Platí spolu s `CLAUDE.md` (pravidla) a `README.md` (co aplikace umí).
> Stav k 25. 11. 2026, verze **0.19.0** (APK versionCode 31), program Bangor **1.2.3**. Odpovídej zadavateli **česky**.

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
   - `bulk.transcribeToSong`: **rozhodnutí zadavatele: píseň s textem → přepis jako další verze** (popisek „Přepis (Gemini)“ / „Přepis (Whisper)“, další „… 2“),
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
   „Přepis (Whisper)“. Zadavatel klíč Groq na počítači vložil a ověření prošlo (**CORS Groq z prohlížeče funguje**).
   Gemini Files API (jen když ani zmenšená kopie nepřekročí 14 MB, tj. nahrávky nad ~7 min) zatím neověřeno.

9. **Čeština a britská angličtina (0.10):** zadavatel chtěl aplikaci (web i APK) česky i anglicky, britská angličtina,
   přepínač na hlavní stránce, na závěr 2× kontrola angličtiny „jako rodilý mluvčí“ (provedeno).
   - `js/i18n.js`: `t('český text', { proměnné })` – **český text je klíč**, `pl(n, jedno, 2–4, 5+)` pro množná čísla
     (angličtina [one, other]), `vlabel()` pro uložené výchozí popisky verzí, `srcLabel()` pro zdroj (sdílení, nahrávka, přepis),
     `num`/`dec` (desetinná čárka/tečka), `locale` (řazení, datum v synchronizaci). Slovník `js/i18n-en.js` (~690 textů + 27
     množných čísel). Chybějící překlad → zůstane česky a zapíše se do `window.__alawMissing` (hlásí test).
   - Volba jazyka v `alaw-prefs.lang` (jen zařízení, nesynchronizuje se), výchozí podle `navigator.language` (cs/sk → česky,
     jinak anglicky). Přepínač **CZ | EN v záhlaví knihovny**; přepnutí uloží volbu a **načte stránku znovu** (texty v konstantách
     modulů se tak vždy přeloží). `<html lang>` = `cs` / `en-GB`; CSS popisky („doslovně:“, „Napsal(a) jsi:“) přes `:lang(en)`.
   - **Data se nepřekládají** (písně, popisky verzí uložené česky – `Hlavní`, `Přepis (Whisper) 2`… se jen zobrazí anglicky).
     **AI výstup v jazyce rozhraní:** překlad, doslovný překlad, zkratky a vysvětlení verše (anglické prompty v `ai.js`). Uložený
     překlad zůstane v jazyce, ve kterém vznikl (pole `translation` je jedno); do druhého jazyka „Přeložit celou píseň znovu (AI)“.
     Přepisové prompty jazyk neřeší. (Zadavateli nabídnuto: oba překlady u verše naráz – vyžadovalo by změnu formátu; zatím ne.)
   - Hlášky z APK (`MainActivity.java`, česky) překládá `net.js androidErr`. Manifest a `<meta description>` dvojjazyčně.
   - Terminologie EN: verš = **line**, sloka = **verse**, refrén = chorus, text písně = **lyrics**, verze textu = version,
     sporné místo = **difference**, nejisté = uncertain, nahrávka = **recording**, přepis = transcription, prostředník = proxy,
     schránka = sync storage, párovací kód = pairing code, procvičit = **practise** (sloveso). Britský pravopis (memorise, recognise).
   - Testy: `testy/test_anglictina.py` (slovník úplný a bez navíc, proměnné sedí, bez češtiny a amerického pravopisu; prochází
     ~60 obrazovek/stavů v en-GB včetně všech cvičení lekce a hodnocení; přepínač a zapamatování volby). Seznam klíčů
     `testy/i18n_klice.py`. Ostatní testy mají `locale='cs-CZ'` (Playwright jinak hlásí en-US → anglicky).

10. **Dva překlady a stažení textu (0.11)** – rozhodnutí zadavatele (po brainstormingu):
   - U verše **český i anglický** překlad, doslovný překlad a zkratky (poznámky). Český = dosavadní pole verše (dosavadní
     překlady se berou jako české), anglický = `line.en`. Poznámka u verše jen jedna. Formát zůstal `v:1` (nepovinné pole);
     **starší verze aplikace `en` při synchronizaci zahodí** – zadavatel to řešit nechce (aktualizovat všechna zařízení).
   - AI překládá do jazyka rozhraní; **Nastavení → Překlady pomocí AI → „Nabízet v nabídce písně i překlad do angličtiny/češtiny“**
     (`prefs.trBoth`) přidá do nabídky písně „Přeložit i do …“ (doplní chybějící) / „Přeložit znovu do …“ (když je celý).
     „Přeložit celou píseň znovu“ přepíše jen jazyk rozhraní.
   - V písni **přepínač CZ / EN** vedle tlačítka Překlad (jen když má píseň oba), volba `prefs.trLang` (zařízení). Překlad ze zdroje
     (`alt`, z webu) se v EN ukáže místo chybějícího vlastního anglického (🌐); tlačítko „Ze zdroje“ jen v CZ pohledu.
   - Učení: překlad v jazyce rozhraní, jinak druhý. Úprava verše: pole pro oba jazyky (jazyk rozhraní první).
   - **Nabídka písně → Stáhnout text…**: text bez časů (.txt), s časy (.lrc, jen načasovaná), jen překlad (.txt, chybějící = „…“),
     text s překladem pod každým veršem (.txt; dvojice oddělené prázdným řádkem, sloky dvěma) – překlad pro každý jazyk, který
     píseň má. Hlavička „Název – Interpret“. Soubory `interpret-nazev.txt`, `…-cs.txt`, `…-cy-cs.txt`.

11. **Bangor – velšský Whisper na počítači (0.12):** zadavatel (Windows) chtěl Bangor dřív než nápovědu „?“, aby nápověda
   pokryla i ho; „nejde o rychlost, jde o rozhraní“. Bangor nemá veřejnou službu s klíčem; modely jsou volně na Hugging Face.
   - Program `bangor/` (zip `alaw-bangor.zip` ve vydání, ve workflow): `alaw-bangor.bat` (první spuštění: Python 3.12 přes winget,
     venv v `%LOCALAPPDATA%\AlawBangor`, `faster-whisper==1.2.1`, `av==16.1.0` (novější av s faster-whisper 1.2.1 padá), `ctranslate2==4.9.0`;
     s `nvidia-smi` i `nvidia-cublas-cu12`, `nvidia-cudnn-cu12==9.*`), `alaw_bangor.py` (server `127.0.0.1:8765`, model
     `techiaith/whisper-large-ft-cy-en-ct2` int8 ~1,6 GB; GPU `int8_float16`, jinak CPU), `CTI-ME.txt` (návod CZ/EN).
     Starší názvy modelů `whisper-large-v3-ft-…` na HF už nejsou veřejné.
   - Aplikace: služba `bangor` v `stt.js` (jen mimo APK, zapnutá `prefs.bangor`), úloha s průběhem v %, čekání na stažení/načtení
     modelu; nepřístupný program = hláška a zastavení hromadného přepisu (`e.stop`). Popisek verze „Přepis (Bangor)“. Nastavení →
     Přepis z nahrávky má podsekce **Whisper přes Groq** a **Bangor** (stáhnout program, Zapnout a ověřit / Ověřit spojení / Vypnout,
     stav GPU/CPU). Na telefonu jen věta, že přepisy přijdou synchronizací. CSP `http://127.0.0.1:8765`.
   - Ověřeno v prostředí Claude: skutečný program s malým modelem (`Systran/faster-whisper-tiny`) + aplikace v Chromiu z localhostu.
     **Neověřeno: Windows (bat, winget, CUDA) a výzva Chrome k přístupu z `tvspk.github.io` – ověří zadavatel.**

12. **Nápověda „?“ u klíčů a přístupů (0.13):** `js/help.js`: `helpTitle(tag, text, topic)` = nadpis s kulatým tlačítkem ?,
   `openHelp(topic)` = spodní panel (3–6 kroků, tlačítka-odkazy, poznámka, Zavřít). Témata `gemini`, `groq`, `bangor` (podsekce
   v Přepisu z nahrávky), `sync` (syncui.js), `proxy` (jen počítač). Bangor a prostředník se na telefonu nezobrazují. Postupy
   ověřené webovým hledáním 20. 11. 2026 (AI Studio „Create API key“, Groq „Create API Key“ – klíč ukáže jen jednou, GitHub
   fine-grained token „Only select repositories“ + Contents „Read and write“, Cloudflare Workers & Pages → Create Worker).
   Test: `test_anglictina.py` otevře každou nápovědu v en-GB. **Rozhodnutí zadavatele: u „Načíst odkazy ze souboru“ otazník NE**
   (vzácná funkce; postup Claude vysvětlí, až na ni dojde).
13. **Musixmatch z odkazu (0.13.1):** zadavatel chtěl. `sources.js` `parseMusixmatch`/`loadMusixmatch` v `loaders` (soubor s odkazy, vložený
   odkaz, sdílení). Text je jen v datech pro skript `#__NEXT_DATA__` (`props.pageProps.data.trackInfo.data.lyrics.body`, název `track.name`,
   interpret `track.artistName`); bez textu (`hasLyrics:false`) → „Stránka nemá text písně“. Hledání na Musixmatch chce přihlášení → není
   mezi zdroji hledání. Na počítači přes prostředníka (neověřeno, zda Musixmatch Cloudflare nepouští; v APK přímo). Ověřeno na skutečné
   stránce (stažené z prostředí Claude) a testem `test_hledani.py` (napodobená stránka s lidovou písní).

14. **Časy veršů z nahrávky přes Bangor (0.14.0):** zadavatel chtěl časy u všech písní, které je nemají. **Rozhodnutí zadavatele:**
   **přepis se použije jen na časy a neukládá se** (žádná další verze), **verše bez shody se dopočítají odhadem** mezi sousedy.
   - Program Bangor 1.1: `POST /transcribe?…&words=1` → úseky mají `words: [{ start, end, word, p }]` (`word_timestamps`), `/health` má `words: true`.
     Starší program (bez `words`) → hláška „starší verze… stáhni znovu“ a zastavení (`e.stop`). Závislosti beze změny (značka `pripraveno-1.txt` zůstala).
   - `stt.js`: `bangorJob` (společné), `transcribeBangor` (jako dřív), `bangorWords` → `[{ w, s, e }]` v ms.
   - `model.js` `alignTimes(lines, words)` (čistá funkce): vážené LCS slov textu × slov přepisu (`wordSim`: Levenshtein, slova ≤ 2 písmena jen
     přesně, u velšských mutací i bez první hlásky; shoda od 0,6). Kotva = verš se shodou aspoň třetiny slov; začátek = medián odhadů z prvních
     ≤ 3 shodných slov (čas slova − pořadí × typická délka slova; Whisper krátké slovo po pauze přilepí dřív). Pořadí musí růst. Ostatní verše
     poměrně podle počtu slov mezi kotvami, před první/po poslední kotvě odhadem. `ok` jen při ≥ 2 kotvách a ≥ 30 % veršů, jinak se nic neuloží.
   - `bulk.js`: `needsTimes` (hlavní verze s textem, vlastní nahrávkou a bez jediného času), `timesFromRecording` (před uložením kontrola, že se
     píseň mezitím nezměnila), `runTimes` (nabídka písně „Doplnit časy z nahrávky (Bangor)“), obrazovka `#/times` (`renderTimes`, odkaz
     v Nastavení → Bangor, když je zapnutý).
   - Ověřeno v prostředí Claude: **skutečný model `techiaith/whisper-large-ft-cy-en-ct2` (CPU)** na velšské lidové písni čtené espeak-ng
     (i s přimíchaným šumem a tóny): všech 8 veršů do 0,16 s; verš navíc v textu se dopočítal. Skutečný zpěv s hudbou bude horší – ověří zadavatel.
   - Test: `test_prepis.py` (napodobený program se slovy, starý program, obrazovka i nabídka písně), `#/times` v `test_anglictina.py`.

15. **Oddělit překlad vložený mezi verši (0.14.1):** u písně „(Nid) Hon Yw'r Gân…“ měl zadavatel pod každým velšským veršem anglický
   překlad jako další verš (střídavě po řádcích). Rozhodnutí: **přesunout jako překlad veršů**, ne mazat. `model.js`: `trLineLang` (en/cs podle
   běžných slov, velština podle typických slov a písmen), `interleavedLang` (nabídnout, jen když ≥ 2 řádky a ≥ 1/5 vypadá jako překlad),
   `splitInterleaved(lines, 'auto'|'alt', lang)` → překlad přes `setTr` k předchozímu verši (dřívější překlad verše se nahradí, další řádky
   připojí „ / “), sloka z prázdného řádku před překladem přejde na další verš, časy řádků překladu zahozeny. UI: nabídka písně
   „🌐 Oddělit překlad vložený mezi verši…“ s náhledem (jazyk, režim podle jazyka / každý druhý řádek). Test v `test_preklady.py`.

16. **Časy jen chybějícím veršům + oprava verše si nechá čas (0.14.2):** `needsTimes` = hlavní verze s textem a nahrávkou, kde **aspoň
   jeden** verš nemá čas. `alignTimes` bere verše s časem jako pevné body (nemění je; nové kotvy jen mezi nimi, ok = kotvy + pevné ≥ 2),
   vrací i `fixed`, `filled`; hláška „✓ Doplněno {f} chybějících časů…“. `edit.js` `mergeLines`: úsek nespárovaných nových veršů mezi
   spárovanými sousedy převezme časy nespárovaných starých veršů ze stejného úseku, když jich je stejně. Pozn.: píseň s časy se v Upravit
   upravuje jako LRC (`[mm:ss.xx]` na začátku řádku) – při opravě slov se značkou čas zůstával už dřív; nové je to pro řádek přepsaný celý.

17. **Bangor 1.2 – oddělení zpěvu + verše podle pauz (0.15.0):** zadavatel hlásil, že Bangor u „Lan y Môr“ (Adwaith, živá session,
   2:40) vzal „strašně málo textu“. Rozbor v prostředí Claude se skutečným modelem (text písně se nevypisoval, jen čísla): zpívá se
   jen ~63 s (0:14–0:40, 0:54–1:20, 2:13–2:38, uprostřed hudba); přepis pokryl 65 % zpívaných míst, **chyběla poslední sloka** (hlasitá
   hudba) a 6 dlouhých úseků = 6 „veršů“ (až 27 slov). Zkoušeno: `no_speech_threshold=None`, `without_timestamps`, VAD (na zpěvu
   s hudbou nic nenajde), kousky po 15 s (víc slov, ale polovina mimo zpěv = halucinace) → nepomohlo. **Oddělený zpěv (Demucs)
   = 80 % pokrytí, žádná díra ve zpěvu, 89 slov místo 73.** Zadavatel schválil oba návrhy („proveď co navrhuješ“).
   - Program 1.2: oddělení zpěvu ve zvláštním procesu (viz CLAUDE.md), spouštěč doinstaluje PyTorch + Demucs (s NVIDIA ~3 GB),
     značka `pripraveno-2.txt` (při `pripraveno-1` se jen doinstaluje oddělení). Selhání instalace ani oddělení přepis nezastaví.
     U Whisperu se pauza ve zpěvu „schová“ do délky slova (držený tón 1–3 s, mezery 0) → `splitSegment` počítá mezeru + délku
     slova nad 0,7 s + interpunkci; na „Lan y Môr“ vyšlo 12 veršů po 5–9 slovech, začátky pravidelně po ~7 s.
   - Aplikace 0.15.0: přepis přes Bangor žádá `words=1` (program 1.1 i 1.2; 1.0 bez slov funguje dál bez dělení), hláška
     „Program Bangor odděluje zpěv od hudby…“. Časy veršů (`bangorWords`) z odděleného zpěvu taky přesnější.
   - **Neověřeno: instalace PyTorch/Demucs na Windows (index download.pytorch.org z prostředí Claude nedostupný) a souběh knihoven
     CUDA (torch v podprocesu, ctranslate2 v hlavním).** Groq dělení na verše zatím nemá (nezadáno; `timestamp_granularities[]=word`).

18. **Náhodné přehrávání (0.16.0):** zadavatel chtěl aplikaci používat i jako přehrávač. **Rozhodnutí zadavatele:** jen písně
   **s vlastní nahrávkou** (YouTube ne – potřebuje viditelné video), „Přehrát vše náhodně“ i **jen označené** (☑ výběr v knihovně),
   **zhasnutá obrazovka / pozadí v APK až později** (vyžaduje službu na popředí s oznámením v `MainActivity`, teď `web.onPause()`).
   - `js/radio.js`: fronta zamíchaná jednou, po konci znovu (tatáž píseň ne dvakrát po sobě); chybějící nahrávka (nestažená) se přeskočí;
     ⏮ po 3 s = od začátku; ✕ ukončí. Rychlost se u každé písně vrací na 1×. Media Session (klávesy pro hudbu, panel médií).
   - Malý přehrávač dole (název + interpret + pořadí, ⏮ ⏯ ⏭ ✕, proužek průběhu); ťuk na název = text písně. U hrající písně se skryje
     a hraje přehrávač písně (+ ⏭); karaoke, ťuk na verš i smyčka jdou nad společnou nahrávkou. Další píseň → obrazovka přejde na její text.
   - Přehrání čehokoli jiného (jiná píseň, lekce, procvičování, časování) náhodné přehrávání pozastaví (`Player.playing`), a naopak.
   - Přepnutí jazyka CZ/EN načte stránku znovu → přehrávání skončí (záměr, vzácné).
   - Test `testy/test_prehravac.py`. **Ověřit na telefonu i počítači.**

19. **Novinky z brainstormingu (0.17.0)** – zadavatel vybral 5, 6, 7, 9, 11, 12, 13 + vlastní 15 a 16 (zamítl/odložil: časovač vypnutí,
   seznamy, vyloučení/oblíbené, přednost učeným písním, vlastní slovníček, statistiky; zhasnutá obrazovka v APK později):
   - **5 vyrovnání hlasitosti** (náhodné přehrávání): měření při prvním přehrání (a dopředu další píseň), hlasité se ztlumí na −16 dBFS,
     tiché zůstanou (zesílit by šlo jen přes Web Audio – nechtěl jsem riskovat přehrávání v pozadí). Nastavení → Náhodné přehrávání.
   - **6 verš + překlad v malém přehrávači** (jen načasované písně; překlad v jazyce `trLang`, jinak druhý). Vypínatelné.
   - **7 zpívání na celou obrazovku** (⛶ v přehrávači písně): předchozí / aktuální / další verš, překlad, A−/A+, Wake Lock; bez časů celý text.
     Při náhodném přehrávání přejde s písní dál. Tlačítko Zpět v APK ho zavře.
   - **9 ověřování přepisu**: verze z přepisu (`source:'přepis'`) se ověřuje automaticky (i dřív přepsané písně), jiná po volbě v nabídce.
     Proužek „Ověřeno n z m“, režim Ověřovat = ✓ u veršů; úprava verše i Upravit = ověřeno. Knihovna: filtr „🔍 K ověření (n)“.
   - **11 zpěvník**: ☑ výběr → „📖 Zpěvník“ → `#/book` (název, překlad CZ/EN/bez, doslovný, nová stránka, obsah) → tisk / PDF.
     APK: nový most `print()` (PrintManager) – **neověřeno na telefonu**.
   - **12** Najít texty: při 429 čeká 1, 2, 3 min (odpočet, jde zastavit), pauza mezi písněmi 1 s.
   - **13** Groq: časy slov (`timestamp_granularities[]`) → dělení na verše jako Bangor. Ověřeno dokumentací Groq, ne skutečným voláním.
   - **15 vlastní překlad**: zadavatel: „překlady tam teď nejdou jednoduše vložit“. Nabídka písně → „📋 Vložit vlastní překlad…“: jazyk,
     překlad/doslovně, „Zkopírovat text pro AI“ (očíslované verše + pokyn), vložit odpověď → párování podle čísel (jinak po řádcích,
     opakovaný originál se vynechá), náhled, „Přepsat překlad, který verš už má“. Časy netřeba: překlad patří k verši.
   - **16 knihovna**: po Zpět na místo otevřené písně (zvýrazní se), šipka ↑ nahoru.

20. **0.17.1:** zadavatel vyzkoušel přehrávání („líbí se mi, jak nabízíš zobrazení textu“) a chtěl **⏮ předchozí píseň** i tam, kde byl jen ⏭
   (přehrávač písně při náhodném přehrávání, celá obrazovka), a **posuvník písně** (celá obrazovka; malý přehrávač má místo proužku posuvník).
   ⏮ po 3 s přehrávání = od začátku písně, jinak předchozí píseň. Opraveno „null“ v malém přehrávači u verše bez překladu a ve zpěvníku
   (bez obsahu / bez překladu) – `replaceChildren` s null → `fill`.

21. **Zhasnutá obrazovka (0.18.0, jen APK):** náhodné přehrávání hraje dál se zhasnutým displejem / v pozadí.
   - `PlaybackService.java`: služba na popředí typu `mediaPlayback` s oznámením (MediaStyle: ⏮ ⏯ ⏭ ✕, i na zamčené obrazovce),
     `MediaSession` (sluchátka, hodinky), částečný wake lock při hraní (v pauze se pustí po 15 s – mezi písněmi je chvilka „pauza“).
     Oprávnění `FOREGROUND_SERVICE(_MEDIA_PLAYBACK)`, `POST_NOTIFICATIONS` (Android 13+ se zeptá při prvním spuštění), `WAKE_LOCK`.
   - `MainActivity`: most `media(json)` (stav z `radio.js` `native()`), `onPause` neuspí WebView, když běží náhodné přehrávání;
     povely zpět přes `window.alawMedia(cmd)`. Zvuk dál hraje WebView (žádný nativní přehrávač). Zavření aplikace z posledních = konec.
   - **Neověřeno na telefonu** (v prostředí Claude jen sestavení APK a napodobený most v `test_prehravac.py`). Riziko: zda WebView
     opravdu hraje dál se skrytou stránkou a zda se po konci písně spustí další (JS v pozadí) – ověří zadavatel. Kdyby ne: nativní
     přehrávač (MediaPlayer) v službě, stránka by mu předávala soubor.
   - Přehrávání jedné písně (ne náhodné) se zhasnutím dál zastaví (nezadáno).

22. **0.18.1:** zadavatel nevěděl, jak označit písně → v knihovně tlačítko „☑ Vybrat písně k přehrání“ (zapne výběr) a v liště výběru
   nápověda „Ťukáním na písně v seznamu je označ“. Skok **−5 s nahrazen −10 s a +10 s** ve všech přehrávačích (`ui.skipBtns`;
   píseň, celá obrazovka, procvičování, porovnání verzí, časování ťukáním). Lišta písně při náhodném přehrávání skryje na úzkém displeji čas.
   **Čeká na zadavatele:** zkouška zhasnuté obrazovky (bod 21).

23. **0.18.2 + Bangor 1.2.2 – díra ~30 s v přepisu:** zadavatel: přepis Bangor u „Gwahanol“ nadějný, ale mezi 0:49 a 1:22 nic, i když se
   zpívá. Příčina (zdroj faster-whisper `transcribe.py`): když `no_speech_prob > 0,6` a `avg_logprob < −1`, Whisper **přeskočí celé 30s okno**
   (`seek += segment_size`). U zpěvu (zvlášť odděleného) je `no_speech_prob` často vysoké i na skutečném zpěvu (espeak-ng ukázka: 0,6–0,76).
   Aplikace navíc sama vyhazovala úseky `no_speech_prob > 0,6 && avg_logprob < −0,7`. Reprodukce v prostředí Claude (3 sloky + tón, oddělený
   zpěv, model tiny): staré nastavení = jen poslední sloka, nové = všechny tři. Oprava: u odděleného zpěvu `no_speech_threshold=None`
   (hudbu bez zpěvu dál chytá `drop_silent`), úseky nad zpěvem `sung: true` a `stt.js` je podle `no_speech_prob` nevyhazuje (i časy veršů).
   Skutečnou nahrávku „Gwahanol“ Claude neměl (přístup ke složce zamítnut) – **ověří zadavatel**: stáhnout zip znovu, rozbalit přes starý,
   restartovat program (instalace se neopakuje), 2× F5, přepsat znovu (přibude „Přepis (Bangor) 2“). Písně přepsané dřív mohou mít stejné díry
   (i doplněné časy veršů – tam se dopočítaly odhadem).

Ověřeno zadavatelem na telefonu: hledání, sdílení, YouTube, vlastní mp3, Gemini, prostředník, synchronizace.
Zadavatel po vydání 0.12 napsal „ok všechno v pohodě“ (Bangor na Windows zřejmě v pořádku – při další práci krátce ověřit,
zda přepis přes Bangor opravdu proběhl). CZ/EN (0.10) a dva překlady + stažení textu (0.11) viděl („perfektní“), zkouší.
Učení (0.4, 0.5), verze (0.6), písně z nahrávek (0.7) a přepis/výměna verze/mazání (0.8) zatím jen testy v prostředí Claude – **ověřit na telefonu**.

24. **0.18.3 + Bangor 1.2.3 – další díry v přepisu:** zadavatel: Gwahanol po 1.2.2 „asi nej přepis“, ale „Torri Fi“ (4:15) po verši 1:15
   „úplně přestalo“. Nahrávku poslal do chatu; rozbor skutečným modelem (CPU, jen čísla): výsledky mezi běhy kolísají, nalezeny tři příčiny:
   (1) **smyčka** (jedno slovo 70×, komprese 12, časy slov slité na konec) → aplikace zahodila celý úsek (u mě 3:36–3:56);
   (2) Whisper po pár slovech **ukončí 30s okno** a zbytek přeskočí (2:33–3:06, i s `no_speech_threshold=None`); (3) **pád** celého přepisu
   ve faster-whisper (`boolean index did not match…` ve `find_alignment`). Oprava v programu: `fix_loops`, `fill_gaps` (2 kola), `guard_alignment`,
   výpis úseků do okna. Ověřeno na „Torri Fi“: díry 1:47–2:00, 2:33–3:06 doplněny (26 + 20 + 35 slov), smyčka přepsána znovu (38–40 slov).
   Aplikace: `trimLoop`. Pozor: doplněný úsek 1:47–2:00 může být sbor/vokalýza – zadavatel posoudí při ověřování. Co přesně bylo u zadavatele
   (GPU) po 1:15, nevíme – jeho okno vypsalo 18 úseků, 1 vynechaný; nový výpis úseků příště ukáže víc.

25. **0.19.0 – hromadně znovu přepsat staré přepisy z Bangoru:** zadavatel chtěl pustit nový Bangor na všechny písně přepsané dřívějšími
   verzemi. Na otázku „co se starými přepisy“ vybral **„Nahradit všechno“** (i ručně upravené; úpravy a pokrok u změněných veršů se ztratí).
   Nastavení → Bangor → „🔁 Přepsat znovu novým Bangorem“ (`#/redo`): seznam, start/zastavit, potvrzení, průběh; přerušení nevadí (hotové
   mají `engine` ≥ 1.2.3 a příště se nenabízí). Nové přepisy z Bangoru (`transcribeToSong`) si verzi programu pamatují taky.
   Test v `test_prepis.py` (napodobený program, verze 1.1 → hláška, 1.2.3 → nahrazení upraveného přepisu).

## Rozpracováno a další kroky (stav 24. 11. 2026, verze 0.15.0)

**24. 11. večer – Bangor 1.2 u zadavatele ověřen:** instalace Demucs na Windows prošla („všechno ok“), „Lan y Môr“: „dvě sloky to
dalo parádně“, ale v 1:49 (jen hudba) vymyšlený text. Pod ním je oddělený zpěv −52 dB pod zpěvem písně (skutečný zpěv 0 až −21 dB)
→ **1.2.1 / aplikace 0.15.1:** `drop_silent` (úsek o 35 dB tišší než 95. percentil po 0,5 s = pryč). Ověřeno skutečným programem.
Poslední sloka (hlasitá hudba) se mezi běhy mírně liší (Whisper na hraně), filtr ji nemaže. Zadavatel má stáhnout zip znovu,
rozbalit přes starý, restartovat program (instalace už proběhla, spustí se hned), F5 2× a přepsat znovu.

**24. 11.:** vydáno 0.15.0 + Bangor 1.2 (bod 17). Zadavatel má: stáhnout nový zip (Nastavení → Bangor → Stáhnout program),
rozbalit přes starý, spustit `alaw-bangor.bat` (doinstaluje oddělení zpěvu), aplikaci obnovit 2× F5 a zkusit znovu „Lan y Môr“.
Pak ověřit, že okno programu píše „Zpěv oddělen od hudby (… na grafické kartě)“; když píše „Zpěv se nepodařilo oddělit“, poslat text z okna.
Písně přepsané dřív lze přepsat znovu (přibude další verze „Přepis (Bangor) 2“; max. 3 verze).

**25. 11.:** vydáno 0.16.0 – náhodné přehrávání (bod 18), pak 0.17.0 – novinky z brainstormingu (bod 19). Ověřit u zadavatele.

Pořadí podle zadavatele. U kroků mimo kód vždy **po jednom**, čekat na „hotovo“. Zadavatel není programátor, odpovídat česky.

**Kde jsme skončili (21. 11.):**
- Bangor u zadavatele běží (Windows, NVIDIA GPU), program 1.1 (časy slov). **Hromadný přepis písní bez textu doběhl**, kvalita
  „něco dobře, hodně špatně, ale dobrý základ pro ruční přepis“. **Časy veršů doplněny hromadně** („vypadá to dobře“).
  Zadavatel program zavřel; příště stačí dvojklik na `alaw-bangor.bat`.
- U „(Nid) Hon Yw'r Gân…“ byl pod každým velšským veršem anglický překlad → nástroj 0.14.1, zadavatel použil, dopadlo dobře.
- Teď zadavatel začne **ručně opravovat přepisy**. 0.14.2 (časy chybějícím veršům, čas u přepsaného řádku) **zadavateli ještě
  nepopsaná v praxi** – stačí říct: v Upravit nechat značku `[mm:ss.xx]` na začátku řádku; když verš čas ztratí, v nabídce písně
  „⏱ Doplnit časy z nahrávky (Bangor)“ doplní jen chybějící (program musí běžet). Po aktualizaci obnovit stránku 2× F5.

**Hotovo 20. 11. večer (bez změny kódu):**
- **Přejmenování nahrávek na PC – HOTOVO.** Složka zadavatele `D:\Cerdd alaw` (Windows), 277 souborů (mp3, 1 flac, 3 wav;
  některé „.mp3“ jsou ve skutečnosti MP4/AAC – aplikaci to nevadí). Přejmenováno 276 na `Interpret - Název[ vN].přípona`.
  Postup: Claude přes most k počítači (bez device_bash – jen výpis, stažení kopie, zápis souborů) připravil tabulku
  `alaw-prejmenovani.csv` a program `alaw-prejmenovat.bat`/`.ps1` (PowerShell, přejmenuje podle tabulky, shoda názvu i po
  normalizaci + velikost, nic nemaže), zadavatel ho spustil dvojklikem. Vrácení: `alaw-vratit.bat` podle `alaw-vraceni.csv`.
  - Pravidla zadavatele: **hranaté závorky za názvem pryč** (kódy YouTube), **stejná píseň víckrát → „ v1“, „ v2“** (jen stejný
    interpret i název; stejný název od jiného interpreta se nečísluje), **velké písmeno na začátku**, slova celá velkými se
    převedou (kromě zkratek jako LOL), dovětky „(Fideo)“, „(Lyric Video)“, „(geiriau ⧸ lyrics)“ pryč, „(Acwstig)“, „(Sesiwn …)“ zůstávají.
  - Interpreti: z názvu souboru, z ID3, **u stažených z YouTube podle kódu videa** (`youtube.com/oembed` → kanál „Interpret - Topic“
    = spolehlivé; kanál „Amrywiol“ = různí interpreti, nebrat), zbytek doplnil zadavatel.
- **Písně z nahrávek** přidány (277 písní). **Najít texty:** LRCLIB + soubor s odkazy `alaw-odkazy.txt` (74 písní: Welsh Lyrics
  wiki s kontrolou interpreta na stránce, LyricsTranslate, Bandcamp jen se zjištěným textem) → **65 písní má text, ~212 ne.**
  Druhé kolo (Bandcamp/LyricsTranslate jen podle názvu, webové hledání) skoro nic nenašlo (`alaw-odkazy-2.txt`, 1 odkaz).
  Last.fm (má texty části velšských písní) není v povolených doménách prostředí Claude – případně zadavatel povolí v claude.ai
  → Settings → Capabilities. Skripty (hledání odkazů, přejmenování) jsou v předávacím balíku, ne v repozitáři.
- **21. 11. – další kola hledání odkazů** (soubory dostal zadavatel, nejsou v repozitáři): `alaw-odkazy-3.txt` = 17 písní z Welsh Lyrics
  wiki (stažen seznam všech ~640 stránek, porovnání názvu, interpreta i kódu videa YouTube; Ciwb = nové aranže starých hitů → text
  originálu); aplikace spárovala 14 (3 už text měly). `alaw-odkazy-4.txt` = 8 písní z Genius (přes prohlížeč v aplikaci Claude; Genius
  po ~85 dotazech blokuje 429 – druhou polovinu písní zkusit později). `alaw-odkazy-5.txt` = 5 písní z Musixmatch (stránky interpretů,
  `hasLyrics`). Musixmatch: většina zbylých písní tam je, ale bez textu. Popisky videí YouTube texty nemají. Zbytek (~160) → Bangor.
- **Na počítači (web) chybí adresa prostředníka** (Najít texty hlásí „na počítači je potřeba prostředník“) → odkazy na Genius/Musixmatch
  zadavatel načítá na telefonu (APK). Adresu lze opsat z Nastavení → Hledání textů na telefonu (nabídnuto, nezadáno).
- Synchronizace po přidání 1,1 GB zvuku běží (průběžné zápisy po 200 MB); telefon pak stáhnout **na Wi-Fi**.

**Poznatky z provozu (možná oprava 0.13.1 – zadavateli nabídnuto, zatím nezadáno):**
- „Najít texty“ hlásí u části písní **„Web nás nepustil (429)“** (LRCLIB omezuje rychlost; `bulk.js` `run()` čeká jen 250 ms
  a na 429 nereaguje). Návrh: při `NetError` se stavem 429 počkat (např. 60 s, pak 2 min) a zkusit znovu, pauza mezi dotazy ~1 s.
  Zatím obchvat: po doběhnutí počkat 5–10 min a „Hledat znovu nenalezené“.
- „Alaw nereaguje“ po „Načíst odkazy ze souboru“ = **okno výběru souboru Windows schované za oknem aplikace** (Alt+Tab).
- Při odesílání velkého zvuku může UI na počítači krátce zadrhávat (`b64()` + šifrování kousků po 8 MiB v hlavním vlákně).

**Další kroky:**
1. Zeptat se, kolik písní zůstalo: (a) s nejistým nálezem v Najít texty (tlačítko „nenalezené“ je nepřepíše → po jedné převzít text
   nebo „🎧 Přepsat z nahrávky“), (b) kde časy hlásily „Přepis se s textem skoro neshoduje“ (→ ťukání, nebo vymyslet jiný postup).
2. Případné vylepšení (nabídnuto dřív, nezadáno): u písní přepsaných Bangorem jsou verše = úseky Whisperu, ne skutečné verše; po ruční
   úpravě rozdělení veršů lze časy doplnit znovu přes časy slov.
3. 0.13.1-návrh: reakce na 429 v Najít texty (výše) – jen když zadavatel chce.
4. Hodnocení přepisu: Bangor vs. Groq vs. Gemini na téže písni.
5. Zadavatel vyzkouší CZ/EN a dva překlady; připomínky k angličtině do `js/i18n-en.js`.
6. Ověřit na telefonu: učení (0.4, 0.5), verze (0.6), písně z nahrávek (0.7), přepis/mazání/výměna verze (0.8, 0.9);
   že telefon stáhl zvuk i nové texty a časy (synchronizace, Wi-Fi).

Možná rozšíření (nezadaná): sdílení z Androidu rovnou do nové verze; časy slov i přes Groq (`timestamp_granularities[]=word`).
- Drobnosti: pruh nové verze se objeví až po 20 h od poslední kontroly (záměr). Genius z prostředí Claude netestovatelný
  (blokuje servery). Na počítači může prostředník narazit na blokaci u Genius a Bandcampu.

**Zkouška Bangoru v prostředí Claude:** `pip install --break-system-packages faster-whisper==1.2.1 av==16.1.0 ctranslate2==4.9.0`,
`ALAW_BANGOR_PORT=8798 python3 bangor/alaw_bangor.py` stáhne i skutečný model (1,6 GB, HF dostupné, CPU ~ desítky s na krátkou nahrávku).
Zkušební „zpěv“: `apt-get install espeak-ng`, `espeak-ng -v cy` na lidovou píseň (volné dílo), ffmpeg pro ticho/šum.

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
  `python3 -u testy/test_zaklad.py`, `python3 -u testy/test_verze.py`, `python3 -u testy/test_hledani.py`, `python3 -u testy/test_hromadne.py`, `python3 -u testy/test_prepis.py`, `python3 -u testy/test_sync.py`, `python3 -u testy/test_preklady.py`, `python3 -u testy/test_anglictina.py`, `python3 -u testy/test_prehravac.py`, `python3 -u testy/test_novinky.py`,
  `node testy/test_worker.mjs`. Kontrola zdrojů proti skutečným webům: `python3 testy/zdroje_naostro.py`.
  Spouštěj s `-u` a výstup do souboru (`> /tmp/x.log`): přes rouru s `grep` se dlouhé testy zasekávaly. `test_zaklad` občas
  náhodně spadne na „Režimy učení“ (`.w.hide`) – při opakování projde.
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
