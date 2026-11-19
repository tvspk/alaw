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
- **Stav projektu, rozhodnutí a další kroky: `HANDOFF.md`** (přečti jako první). Plán: 3) verze a sporná místa.
