# Test verzí textu a sporných míst (Playwright, mobilní Chromium, bez sítě): přidání verze, porovnání, poslech ve smyčce,
# rozhodnutí (platí hlavní / druhá / nejisté), převod pokroku opraveného verše, uznání obou variant při psaní zpaměti,
# načasování verše ťuknutím, limit verzí a smazání verze. Spuštění: python3 -u testy/test_verze.py [složka_pro_snímky]
import subprocess, sys, tempfile
from pathlib import Path
from playwright.sync_api import sync_playwright
from test_zaklad import serve, wait, check

SHOTS = Path(sys.argv[1]) if len(sys.argv) > 1 else None
TMP = Path(tempfile.mkdtemp())
errors = []

# Tradiční lidová píseň (volné dílo).
LRC = """[00:01.00]Ar lan y môr mae rhosys cochion
[00:04.00]Ar lan y môr mae lilis gwynion

[00:07.00]Ar lan y môr mae 'nghariad inne
[00:10.00]Yn cysgu'r nos a chodi'r bore"""

# Táž píseň „z jiného zdroje“: bez stříšky a s čárkou (nepočítá se), lili/lilis, innau/inne, jinak zalomený verš,
# opakovaný první verš a poznámka na konci.
OTHER = """Ar lan y mor mae rhosys cochion,
Ar lan y môr mae lili gwynion

Ar lan y môr mae nghariad innau
Yn cysgu'r nos
a chodi'r bore
Ar lan y môr mae rhosys cochion
Cytgan"""

PLAIN = """Ar lan y môr mae rhosys cochion
Ar lan y môr mae lilis gwynion"""

def shot(page, name):
    if SHOTS:
        SHOTS.mkdir(parents=True, exist_ok=True)
        page.screenshot(path=str(SHOTS / f'{name}.png'), full_page=True)

def new_song(page, title, text, wav):
    page.goto(page.url.split('#')[0] + '#/new')
    page.wait_for_selector('input[placeholder="Calon Lân"]')
    page.fill('input[placeholder="Calon Lân"]', title)
    page.fill('textarea', text)
    with page.expect_file_chooser() as fc:
        page.click('text=Vybrat soubor')
    fc.value.set_files(str(wav))
    page.wait_for_selector('text=nahravka.wav')
    page.click('button[type=submit]')
    page.wait_for_selector('.lyric')
    return page.evaluate("decodeURIComponent(location.hash.split('/')[2])")

def add_version(page, label, text):
    page.click('[aria-label="Další možnosti"]')
    page.click('text=Přidat verzi textu z jiného zdroje')
    page.wait_for_selector('text=Přidat verzi textu')
    page.fill('input[placeholder^="Např. Wicidestun"]', label)
    page.fill('textarea', text)
    page.click('button[type=submit]')
    page.wait_for_selector('.vsum')

def song_js(page, sid, body):
    # CSP nedovolí new Function, proto se tělo vkládá přímo do vyhodnocované funkce
    return page.evaluate("""async (sid) => { const S = await import('./js/store.js'); const M = await import('./js/model.js');
      const L = await import('./js/learn.js'); const song = await S.getSong(sid); %s }""" % body, sid)

def main():
    wav = TMP / 'nahravka.wav'
    subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=20', '-ac', '1', '-ar', '22050', str(wav)], check=True)
    srv = serve()
    url = f'http://127.0.0.1:{srv.server_address[1]}/'
    with sync_playwright() as p:
        browser = p.chromium.launch(args=['--autoplay-policy=no-user-gesture-required'])
        ctx = browser.new_context(**p.devices['Pixel 7'])
        # přehrávač nemá <audio> v dokumentu: zapamatovat si ho při spuštění
        ctx.add_init_script("const _p = HTMLMediaElement.prototype.play; HTMLMediaElement.prototype.play = function () { window.__media = this; return _p.call(this); };")
        page = ctx.new_page()
        page.on('console', lambda m: m.type == 'error' and errors.append(m.text))
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.goto(url)
        page.wait_for_selector('text=Croeso!')

        print('Logika porovnání (versions.js)')
        r = page.evaluate("""async ([a, b]) => { const M = await import('./js/model.js'); const V = await import('./js/versions.js');
          const s = M.newSong({ title: 't', lines: M.parseLyrics(a) }); s.versions.push(M.newVersion(M.parseLyrics(b), { label: 'B' }));
          const [res] = V.analyze(s);
          return { items: res.items.map(x => [x.li, x.a, x.b]), other: res.onlyOther.map(x => [x.after, x.oLines.length, x.repeat]), main: res.onlyMain.length }; }""", [LRC.replace('[00:01.00]', '').replace('[00:04.00]', '').replace('[00:07.00]', '').replace('[00:10.00]', ''), OTHER])
        check(r['items'] == [[1, 'lilis', 'lili'], [2, 'inne', 'innau']], 'dvě sporná místa (stříška, čárka a zalomení se nepočítají)')
        check(r['other'] == [[3, 2, False]] and r['main'] == 0, 'verše navíc ve druhé verzi poznány (za veršem 4)')

        print('Přidání verze')
        sid = new_song(page, 'Ar Lan y Môr', LRC, wav)
        check(page.locator('.vbar').is_hidden(), 'píseň s jednou verzí proužek verzí nemá')
        # pokrok druhého verše (bude opraven) a třetího (nejisté místo) – oba umím
        song_js(page, sid, """const now = Date.now(); const recs = ['Ar lan y môr mae lilis gwynion', "Ar lan y môr mae 'nghariad inne"].map(t =>
          ({ ...L.freshRec(song.id, L.lineKey(t)), st: 'review', ivl: 10, reps: 4, due: now + 5 * 864e5, intro: now - 30 * 864e5 }));
          await S.saveProgress(...recs);""")
        add_version(page, 'Zpěvník', OTHER)
        check(page.locator('.spot:not(.block)').count() == 2, 'porovnání: 2 sporná místa')
        check('2 sporná místa' in page.inner_text('.vsum') and '2 nerozhodnuto' in page.inner_text('.vsum'), 'souhrn: 2 nerozhodnuto')
        check(page.locator('mark.d-a', has_text='lilis').count() == 1 and page.locator('mark.d-b', has_text='lili').count() >= 1, 'rozdílná slova zvýrazněná')
        check('null' not in page.inner_text('.view'), 'na obrazovce není „null“')
        check(page.locator('text=Verše navíc ve verzi Zpěvník').count() == 1, 'verše navíc ve druhé verzi zvlášť')
        wait(page, 'document.querySelector(".spot .row button")?.textContent.includes("Poslouchat")', 10000)
        shot(page, 'v1-porovnani')

        print('Poslech ve smyčce 0,75×')
        page.locator('.spot').first.locator('text=Poslouchat verš').click()
        wait(page, 'window.__media && !window.__media.paused', 5000)
        check(page.evaluate('window.__media.playbackRate') == 0.75, 'přehrává se zpomaleně 0,75×')
        page.wait_for_timeout(600)
        t = page.evaluate('window.__media.currentTime')
        check(3.5 <= t <= 7.2, f'hraje druhý verš ({t:.1f} s)')
        check(page.locator('text=⏹ Zastavit').count() == 1, 'tlačítko Zastavit u přehrávaného místa')
        page.click('text=⏹ Zastavit')

        print('Rozhodnutí: platí druhá verze (oprava, pokrok zůstane)')
        page.locator('.spot').first.locator('text=✓ Platí Zpěvník').click()
        page.wait_for_selector('text=Verš opraven, pokrok zůstal')
        r = song_js(page, sid, """const rec = (await S.getProgress(song.id)).get(L.lineKey('Ar lan y môr mae lili gwynion'));
          return [M.primaryVersion(song).lines[1].text, rec && rec.st, rec && rec.ivl];""")
        check(r == ['Ar lan y môr mae lili gwynion', 'review', 10], 'hlavní verze opravena a verš si nechal pokrok (interval 10 dní)')
        check(page.locator('.spot:not(.block)').count() == 1, 'zbývá jedno sporné místo')

        print('Rozhodnutí: nejisté')
        page.locator('.spot').first.locator('text=⚠ Nejisté').click()
        page.wait_for_selector('.spot.st-unsure')
        check('1 nejisté' in page.inner_text('.vsum') and 'nerozhodnuto' not in page.inner_text('.vsum'), 'souhrn: 1 nejisté, nic nerozhodnutého')
        check(page.locator('.spot.st-unsure .decide .btn.on', has_text='Nejisté').count() == 1, 'nejisté místo zůstává v seznamu se zvolenou volbou')
        vars_ = song_js(page, sid, "return M.primaryVersion(song).lines[2].vars;")
        check(vars_ == [{'w': 6, 'a': 'inne', 'b': 'innau', 'st': 'unsure'}], 'rozhodnutí uložené u verše hlavní verze')

        print('Píseň: proužek a ⚠ u verše')
        page.click('[aria-label="Zpět"]')
        page.wait_for_selector('.vbar')
        check('rozhodnuto, 1 místo nejisté' in page.inner_text('.vbar'), 'proužek: rozhodnuto, 1 nejisté')
        check(page.locator('.lyric[data-i="2"] .vflag.v-unsure').count() == 1 and page.locator('.vflag').count() == 1, '⚠ jen u třetího verše')
        page.click('.lyric[data-i="2"] .vflag')
        page.wait_for_selector('.spot[data-li="2"]')
        check(page.evaluate('location.hash').endswith('/2') and page.locator('.spot.flash[data-li="2"]').count() == 1, '⚠ otevře porovnání na tom verši')
        page.click('[aria-label="Zpět"]')
        page.wait_for_selector('.vbar')

        print('Učení: psaní zpaměti uzná obě varianty nejistého místa')
        k3 = "ar lan y mor mae nghariad inne"
        def type_line(text):
            page.goto(url + '#/')
            page.evaluate("() => { window.__alawForceEx = 'type'; }")
            page.goto(url + f'#/learn/{sid}/' + k3.replace(' ', '%20'))
            page.wait_for_selector('textarea.ltype')
            page.fill('textarea.ltype', text)
            page.click('text=Zkontrolovat')
            page.wait_for_selector('.lverdict')
            out = page.inner_text('.lcard')
            check('null' not in out, 'v kartě lekce není „null“')
            return out
        out = type_line("Ar lan y mor mae nghariad innau")
        check('Výborně, přesně!' in out and 'Uznáno podle jiné verze' in out, 'varianta „innau“ uznána s poznámkou')
        shot(page, 'v2-uznano')
        out = type_line("Ar lan y mor mae nghariad inne")
        check('Výborně, přesně!' in out and 'Uznáno podle' not in out, 'hlavní znění uznáno bez poznámky')
        check('⚠ Nejisté: jiná verze má „innau“ místo „inne“' in out, 'u odkrytého verše upozornění na nejisté místo')

        print('Ověřené místo už druhou variantu neuzná')
        song_js(page, sid, "M.primaryVersion(song).lines[2].vars[0].st = 'ok'; await S.saveSong(song);")
        out = type_line("Ar lan y mor mae nghariad innau")
        check('Chyb: 1.' in out, 'po ověření je „innau“ chyba')
        page.evaluate("() => { window.__alawForceEx = null; }")

        print('Doplň slovo nehádá nejisté slovo')
        song_js(page, sid, "M.primaryVersion(song).lines[2].vars[0].st = 'unsure'; await S.saveSong(song);")
        blanks = set()
        for _ in range(8):
            page.goto(url + '#/')
            page.evaluate("() => { window.__alawForceEx = 'choiceWord'; }")
            page.goto(url + f'#/learn/{sid}/' + k3.replace(' ', '%20'))
            page.wait_for_selector('.blank')
            blanks.add(page.inner_text('.ltarget .ltext'))
        check(all('inne' in b for b in blanks) and len(blanks) >= 2, 'vynechané slovo nikdy není sporné „inne“')
        page.evaluate("() => { window.__alawForceEx = null; }")

        print('Záloha a synchronizace zachovají rozhodnutí')
        r = page.evaluate("""async (sid) => { const S = await import('./js/store.js'); const M = await import('./js/model.js');
          const s = M.normalizeSong(JSON.parse(JSON.stringify(await S.getSong(sid)))); return [s.versions.length, M.primaryVersion(s).lines[2].vars, M.primaryVersion(s).lines[0].vars]; }""", sid)
        check(r[0] == 2 and r[1][0]['st'] == 'unsure' and r[2] is None, 'normalizeSong: verze i rozhodnutí přežijí, prázdné se neukládají')

        print('Přidat verše jen ze druhé verze')
        page.goto(url + f'#/compare/{sid}')
        page.wait_for_selector('text=Přidat do hlavní verze')
        page.click('text=Přidat do hlavní verze')
        page.wait_for_selector('text=2 verše přidány do hlavní verze')
        n = song_js(page, sid, "return M.primaryVersion(song).lines.map(l => l.text).slice(4);")
        check(n == ['Ar lan y môr mae rhosys cochion', 'Cytgan'], 'verše přidány na konec hlavní verze')

        print('Limit verzí a smazání verze')
        page.goto(url + f'#/song/{sid}')
        page.wait_for_selector('.vbar')
        add_version(page, 'Třetí', PLAIN)
        check(page.locator('.vchips .chip').count() == 2, 'přepínač mezi dvěma dalšími verzemi')
        page.goto(url + f'#/song/{sid}')
        page.wait_for_selector('.lyric')
        page.click('[aria-label="Další možnosti"]')
        check(page.locator('text=Přidat verzi textu z jiného zdroje').count() == 0, 'třetí další verze už nejde přidat')
        page.keyboard.press('Escape')
        page.goto(url + f'#/version/{sid}/new')
        page.wait_for_selector('text=Píseň už má 3 verze')
        check(True, 'ani přímou adresou')
        page.goto(url + f'#/compare/{sid}')
        page.wait_for_selector('.vchips')
        page.click('.vchips >> text=Třetí')
        page.wait_for_selector('.vinfo >> text=Hlavní ↔ Třetí')
        page.on('dialog', lambda d: d.accept())
        page.click('[aria-label="Možnosti verze"]')
        page.click('text=Smazat tuto verzi')
        page.wait_for_selector('text=Verze smazána')
        r = song_js(page, sid, "return [song.versions.length, M.primaryVersion(song).lines[2].vars];")
        check(r[0] == 2 and r[1] and r[1][0]['st'] == 'unsure', 'verze smazána, rozhodnutí proti zbylé verzi zůstalo')

        print('Načasování verše ťuknutím (píseň bez časů)')
        sid2 = new_song(page, 'Bez časů', PLAIN, wav)
        add_version(page, 'Jiná', PLAIN.replace('lilis', 'lili'))
        wait(page, '[...document.querySelectorAll(".spot button")].some(b => b.textContent.includes("Načasovat"))', 10000)
        page.click('text=⏱ Načasovat verš')
        page.wait_for_selector('text=Teď začíná')
        page.click('text=Teď začíná')
        page.wait_for_timeout(1200)
        page.click('text=Teď končí')
        page.click('text=Uložit a poslouchat')
        page.wait_for_selector('text=Verš 2 načasován')
        r = song_js(page, sid2, "return M.primaryVersion(song).lines.map(l => l.start);")
        check(r[0] is None and r[1] is not None, 'druhý verš dostal začátek')
        wait(page, '!!document.querySelector(".spot") && document.querySelector(".spot").textContent.includes("Zastavit")', 5000)
        check(True, 'po uložení se verš rovnou přehrává ve smyčce')
        shot(page, 'v3-nacasovano')

        browser.close()
    srv.shutdown()
    real = [e for e in errors if 'favicon' not in e]
    if real:
        raise AssertionError('Chyby v konzoli: ' + ' | '.join(real))
    print('\nVšechny testy prošly.')

if __name__ == '__main__':
    main()
