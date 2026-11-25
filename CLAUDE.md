# Pravidla pro práci na Alaw

- **Žádné osobní údaje** v repozitáři (je veřejný): žádná skutečná jména, věk, vztahy. V ukázkách a testech obecná
  jména (Jana, Rozárka). Tokeny, klíče ani párovací kódy sem nikdy nepatří.
- **Žádné texty písní chráněné autorským právem** v repozitáři (ani v testech). V testech jen lidové písně (volné dílo).
  Písně dodává uživatel sám, aplikace nemá vlastní knihovnu.
- Bez sestavování: `index.html`, `css/`, `js/` (ES moduly). **Po každé změně spusť `python3 scripts/build_sw.py`.**
- Formát písně je popsaný v `js/model.js` (`v:1`, píseň → verze → verše). Při nekompatibilní změně zvyš verzi a přidej převod.
  Data z cizích zdrojů (záloha, synchronizace) vždy přes `normalizeSong`.
- Nastavení jen pro zařízení (velikost písma, režim, rychlost) jsou v `localStorage['alaw-prefs']` a nesynchronizují se.
- Test: `python3 testy/test_zaklad.py`. CSP nemá `'unsafe-eval'`, proto v testech nepoužívat `page.wait_for_function`
  (čekat smyčkou přes `page.evaluate`, funkce `wait`).
- Zdroje textů jsou v `js/sources.js` (search → výsledky, load → text). Stahování jen přes `js/net.js`: Android = most
  `AlawAndroid.fetch`, prohlížeč = přímo (jen weby s CORS v `CORS_OK` a v CSP `connect-src`) nebo přes prostředníka `worker/`.
  Změna struktury cizího webu: ověř `python3 testy/zdroje_naostro.py` a uprav i napodobené stránky v `testy/test_hledani.py`.
  Musixmatch (0.13.1) jen z odkazu (`loaders` v `sources.js`, `parseMusixmatch`): text je v `#__NEXT_DATA__` → `trackInfo.data.lyrics.body`.
- Gemini (`js/ai.js`): klíč jen v `localStorage['alaw-ai']`, nikdy v repozitáři ani záloze. Model se vybírá automaticky (nejnovější `gemini-X-flash`).
- APK (`android/`): stránka se servíruje z `https://appassets.androidplatform.net/` (kvůli YouTube a IndexedDB). Nová verze APK:
  zvyš `android/verze.txt` (versionCode +1) a `APP_VERSION` v `js/app.js`. Klíč v Secrets `ALAW_KEYSTORE`, `ALAW_KEYSTORE_PASSWORD` (alias `alaw`).
  Jiný klíč = aktualizace nejde nainstalovat. APK se v prostředí Claude nedá spustit – ověřuje se na telefonu.
- Synchronizace (`js/sync.js`, UI `js/syncui.js`): schránka = soukromý `tvspk/alaw-sync` (Claude do ní přístup NEMÁ a mít nemá).
  Větev na zařízení `al-<12 hex>`, soubor `state` + kousky zvuku `a/<klíč>/<i>` (≤ 8 MiB), AES-GCM, klíč HKDF z 8 slov
  (salt 'Alaw sync v1'). Píseň = položka, **novější úprava vyhrává** (`updatedAt` přes `stamp()` = hodiny GitHubu),
  smazání = náhrobek (`meta.tombs`). Zvuk se stahuje hned celý, nezmenšuje se. Nesynchronizuje se: `alaw-prefs`, `alaw-ai`.
  Ukládat písně jen přes `store.saveSong`/`deleteSong` (razítko času + náhrobek + naplánování synchronizace).
  Formát stavu `v:1`; při nekompatibilní změně zvýšit. QR: `js/qr.js` (window.GSQR), obsah `ALAW:` + 8 slov, bez tokenu.
  Test: `python3 testy/test_sync.py` (napodobený GitHub, dvě zařízení). Nikdy netestovat proti skutečnému GitHubu.
- Učení (`js/learn.js` logika a výběr cvičení, `js/lesson.js` lekce, `js/drill.js` procvičování celé písně): pokrok po verších podle znění (`lineKey`), ukládat jen přes
  `store.saveProgress`/`resetProgress` (razítko + synchronizace). V synchronizaci `prog[]`, naposledy změněný záznam vyhrává.
- Verze textu (`js/versions.js` logika, `js/compare.js` obrazovka `#/compare/…`, `#/version/<id>/<idVerze|new>` = `edit.js`): učí se vždy
  hlavní verze (`song.primary`), nejvýš 3 verze. Rozhodnutí sporných míst jen u veršů hlavní verze (`line.vars`), „platí druhá“ přepíše
  text a převede pokrok (`store.moveProgress`). Test: `python3 -u testy/test_verze.py`.
- Písně z nahrávek a hledání textů (`js/bulk.js`, `#/bulk`, `#/lyrics`): texty se ukládají jen po potvrzení uživatelem,
  časy z LRCLIB jen při shodné délce nahrávky. Test: `python3 -u testy/test_hromadne.py`.
- Přepis z nahrávky (`ai.transcribeAudio`, `bulk.transcribeToSong`): píseň s textem → přepis jako další verze, nikdy nepřepsat
  hlavní text. Claude sám texty písní nepřepisuje ani nevypisuje (dělá to aplikace u zadavatele). Test: `python3 -u testy/test_prepis.py`.
- Přepis: služby v `js/stt.js` (Gemini, Groq); klíče jen v zařízení (`alaw-ai`, `alaw-groq`), nikdy v repozitáři ani záloze.
- **Bangor** (0.12, `js/stt.js` `transcribeBangor`, Nastavení `bangorBlock` v `app.js`): program `bangor/alaw_bangor.py` na počítači s Windows
  (spouštěč `bangor/alaw-bangor.bat` = Python 3.12 přes winget, venv v `%LOCALAPPDATA%\AlawBangor`, `faster-whisper` s pevnými verzemi,
  u NVIDIA i knihovny CUDA; model `techiaith/whisper-large-ft-cy-en-ct2`). Server jen `127.0.0.1:8765`, CORS jen `tvspk.github.io`
  a localhost; `/health`, `POST /transcribe` (tělo = nahrávka) → úloha, `/jobs/<id>` s průběhem. Chrome (od 142) se jednou zeptá na
  přístup k místní síti / aplikacím v zařízení (`targetAddressSpace: 'loopback'`). V APK skryté. Zapnutí `prefs.bangor` (zařízení).
  Zip `alaw-bangor.zip` přidává workflow do vydání. Změna závislostí ve spouštěči → zvýšit značku `pripraveno-1.txt` (jinak se nepřeinstaluje).
  **Časy veršů k hotovému textu (0.14.0):** `words=1` → časy slov (`bangorWords`), `model.alignTimes` je přiřadí k veršům (přepis se neukládá,
  nesedící verše se dopočítají; verše s časem jsou pevné body – doplní se jen chybějící), `bulk.js` `timesFromRecording`/`runTimes`,
  obrazovka `#/times`. Starší program bez `words` v `/health` → hláška. Oddělení překladu ze střídavých řádků: `model.splitInterleaved` (0.14.1).
  **Oddělení zpěvu (1.2, aplikace 0.15):** před přepisem `separate()` (Demucs `htdemucs`, PyTorch) ve zvláštním procesu
  (`alaw_bangor.py --vocals vstup výstup` → mono WAV 16 kHz); selhání = přepis původní nahrávky. `/health` `vocals`, úloha `phase` (vocals|transcribe),
  `vocals=0` vypne. Spouštěč doinstaluje torch (index PyTorch cu128/cu126/cu129/cu130, jinak cpu) + `demucs==4.1.0`, značka `pripraveno-2.txt`.
  1.2.1: `drop_silent` zahodí úseky, pod kterými je oddělený zpěv o 35 dB tišší než 95. percentil (Whisper v tichu vymýšlí text).
  Přepis žádá časy slov a `stt.splitSegment` dělí dlouhé úseky na verše (mezera + držené slovo + interpunkce, verš 3–12 slov).
  Test: `test_prepis.py` (napodobený program). Ruční zkouška skutečného programu: `ALAW_BANGOR_MODEL=Systran/faster-whisper-tiny python3 bangor/alaw_bangor.py`
  (oddělení zpěvu: `pip install --break-system-packages demucs==4.1.0`, model z HF `adefossez/HTDemucs`).
- **Nápověda „?“** (0.13, `js/help.js`): nová služba/přístup v Nastavení → téma v `TOPICS` + `helpTitle(...)`; kroky přes `t()`
  + angličtina; postupy cizích webů ověřit webovým hledáním. Test v `test_anglictina.py` (seznam témat na počítači).
- Nahrávky ukládat před písní je v pořádku jen přes `putAudioBlob` (chrání `db.freshAudio` před úklidem synchronizace).
- **Jazyk rozhraní CZ / EN (britská angličtina)**: `js/i18n.js` + slovník `js/i18n-en.js`. Každý text pro uživatele piš jako
  `t('český text', { proměnné })`, množné číslo `pl(n, '{n} píseň', '{n} písně', '{n} písní')`, vždy s textem v jednoduchých
  uvozovkách (test z nich sestavuje seznam). Nový text → doplnit anglický překlad do `js/i18n-en.js` (britský pravopis,
  verš = line, sloka = verse, text písně = lyrics, nahrávka = recording, procvičit = practise). Data písní se nepřekládají;
  výchozí popisky verzí (`Hlavní`, `Přepis (…)`) se ukládají česky a zobrazují přes `vlabel()`. Proměnnou ani parametr
  nepojmenovávej `t` (zastínilo by překlad). Test: `python3 -u testy/test_anglictina.py` (ostatní testy běží v `cs-CZ`).
- **Překlad verše ve dvou jazycích** (0.11): český = pole verše `translation`, `literal`, `contractions`; anglický = `line.en`
  `{ translation, literal, contractions }` (prázdný se neukládá). Číst a zapisovat jen přes `model.trOf`/`setTr`, zobrazit přes
  `trText` (anglicky záloha `alt` = překlad ze zdroje, označený), v učení `anyTr`. Export `model.toTxt`. Test: `python3 -u testy/test_preklady.py`.
- **Náhodné přehrávání** (0.16, `js/radio.js`): jeden společný `Player` pro celou aplikaci, malý přehrávač `.minibar` v `body`
  (mimo `#app`, přežije přechod mezi obrazovkami). Jen písně s vlastní nahrávkou (`audioVersion`: hlavní verze, jinak první s nahrávkou).
  Obrazovka písně, která hraje, se připojí (`radio.attach/detach`, obsluha `H` v `song.js`) místo vlastního přehrávače; při změně písně
  přejde na text nové (když není otevřená nabídka). Hrát smí jen jeden `Player` (`Player.playing`), ostatní se pozastaví.
  Prvky u spodního okraje posunout pro `body.mini-on`. Test: `python3 -u testy/test_prehravac.py`. Zhasnutá obrazovka v APK (0.18):
  `PlaybackService.java` (služba na popředí + oznámení + MediaSession + wake lock), most `AlawAndroid.media(json)` ← `radio.native()`, povely `window.alawMedia(cmd)`.
- **0.17:** `js/stage.js` zpívání na celou obrazovku (Wake Lock, `carryStage` při náhodném přehrávání); `js/loudness.js` vyrovnání
  hlasitosti jen v náhodném přehrávání (jen ztlumení přes `audio.volume`, cache `localStorage['alaw-loud']`, `prefs.normVol`);
  `prefs.miniLine` verš+překlad v malém přehrávači (výška `--mini-h`); vlastní překlad `model.numberedText`/`parsePastedTr` + `openPasteTr`
  v `song.js`; ověřování textu `model.inReview` (verze `source:'přepis'` nebo `review:true`; `review:false` = ukončeno), verš `ok:true`
  (Upravit a úprava verše = ověřeno); zpěvník `js/book.js` `#/book` (tisk, APK `AlawAndroid.print` → PrintManager); Najít texty 429 →
  čekat 1/2/3 min; Groq `timestamp_granularities[]` word+segment → `stt.withWords` → `splitSegment`. Knihovna: `libState.y/last`,
  návrat po Zpět (`route(true)`), `.to-top`. Test: `python3 -u testy/test_novinky.py`.
- **Stav projektu, rozhodnutí a další kroky: `HANDOFF.md`** (přečti jako první).
