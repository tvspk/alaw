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
- Plán: 2) hledání textů (fandom, LRCLIB, Cloudflare Worker), 3) verze a sporná místa, 4) pokrok a opakování,
  5) sdílení z Androidu, AI překlad, synchronizace přes GitHub (vzor: tvspk/gorsaf, tvspk/memochat).
