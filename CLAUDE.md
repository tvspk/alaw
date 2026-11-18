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
- Plán: 3) verze a sporná místa, 4) pokrok a opakování, 5) synchronizace přes GitHub (vzor: tvspk/gorsaf, tvspk/memochat).
