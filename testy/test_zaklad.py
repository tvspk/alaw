# Základní test aplikace v mobilním Chromiu (Playwright): přidání písně, zvuk, režimy učení, smyčka,
# úprava verše, časování ťukáním, záloha a import. Spuštění: python3 testy/test_zaklad.py [složka_pro_snímky]
import json, subprocess, sys, tempfile, threading, time
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
SHOTS = Path(sys.argv[1]) if len(sys.argv) > 1 else None
TMP = Path(tempfile.mkdtemp())

# Tradiční lidová píseň (volné dílo) s časy LRC.
LRC = """[00:01.00]Ar lan y môr mae rhosys cochion
[00:04.00]Ar lan y môr mae lilis gwynion

[00:07.00]Ar lan y môr mae 'nghariad inne
[00:10.00]Yn cysgu'r nos a chodi'r bore"""

GEMINI = {"id": "x", "artist": "Jana", "title": "Ukázková píseň (Ukázka)", "language": "cy", "youtube_id": None, "lyrics_source": "sample",
          "is_synced": False, "lines": [{"id": 1, "start_ms": None, "end_ms": None, "original": "Dwi'n hoffi canu", "literal": "Jsem v mít rád zpívání",
          "translation": "Rád zpívám", "contractions": [{"short": "Dwi'n", "full": "Rydw i yn", "note": "hovorově"}], "user_notes": []}]}

errors = []
def check(cond, msg):
    if not cond:
        raise AssertionError(msg)
    print('  ✓', msg)

def serve():
    class Quiet(SimpleHTTPRequestHandler):
        def log_message(self, *a):
            pass
    handler = partial(Quiet, directory=str(ROOT))
    srv = ThreadingHTTPServer(('127.0.0.1', 0), handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv

def wait(page, js, timeout=8000):
    # CSP bez 'unsafe-eval' nedovolí page.wait_for_function, proto čekáme smyčkou
    end = time.time() + timeout / 1000
    while time.time() < end:
        if page.evaluate(f'() => !!({js})'):
            return
        page.wait_for_timeout(100)
    raise AssertionError(f'Nedočkal jsem se: {js}')

def shot(page, name):
    if SHOTS:
        SHOTS.mkdir(parents=True, exist_ok=True)
        page.screenshot(path=str(SHOTS / f'{name}.png'))

def main():
    wav = TMP / 'nahravka.wav'
    subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=20', '-ac', '1', '-ar', '22050', str(wav)], check=True)
    (TMP / 'gemini.json').write_text(json.dumps(GEMINI, ensure_ascii=False))
    srv = serve()
    url = f'http://127.0.0.1:{srv.server_address[1]}/'
    with sync_playwright() as p:
        browser = p.chromium.launch(args=['--autoplay-policy=no-user-gesture-required'])
        ctx = browser.new_context(**p.devices['Pixel 7'], accept_downloads=True)
        page = ctx.new_page()
        page.on('console', lambda m: m.type == 'error' and errors.append(m.text))
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.goto(url)

        print('Knihovna')
        page.wait_for_selector('text=Croeso!')
        shot(page, '01-prazdna-knihovna')

        print('Nová píseň')
        page.click('.fab')
        page.fill('input[placeholder="Calon Lân"]', 'Ar Lan y Môr')
        page.fill('input[placeholder="Interpret (nepovinné)"]', 'Lidová')
        page.fill('input[placeholder="hymny, lidovky, rugby"]', 'lidovky')
        page.fill('textarea', LRC)
        with page.expect_file_chooser() as fc:
            page.click('text=Vybrat soubor')
        fc.value.set_files(str(wav))
        page.wait_for_selector('text=nahravka.wav')
        shot(page, '02-formular')
        page.click('button[type=submit]')
        page.wait_for_selector('.lyric')
        check(page.locator('.lyric').count() == 4, 'čtyři verše')
        check(page.locator('.lyric.stanza').count() == 1, 'druhá sloka oddělená')
        wait(page, 'document.querySelector(".progress")?.max > 15000')
        check(True, 'zvuk načten (délka > 15 s)')

        print('Přehrávání a aktivní verš')
        page.click('.play')
        page.wait_for_selector('.lyric.active', timeout=5000)
        check(page.locator('.lyric.active .text').inner_text().startswith('Ar lan y môr mae rhosys'), 'zvýrazněn první verš')
        page.locator('.lyric .text').nth(2).click()
        page.wait_for_timeout(600)
        check(page.locator('.lyric.active .text').inner_text().startswith("Ar lan y môr mae 'nghariad"), 'ťuknutí na verš přeskočí na něj')
        shot(page, '03-pisen-prehravani')

        print('Smyčka')
        page.locator('.lyric .more').nth(1).click()
        page.click('text=Opakovat tento verš')
        check(page.locator('.pill.loop').is_visible(), 'smyčka zapnutá')
        page.wait_for_timeout(4200)
        t = page.evaluate('+document.querySelector(".progress").value')
        check(3500 <= t <= 7100, f'přehrávání zůstává ve smyčce verše 2 (čas {t} ms)')
        page.click('.pill.loop')
        check(not page.locator('.pill.loop').is_visible(), 'smyčka zrušena')
        page.click('.play')

        print('Rychlost')
        page.click('.controls .pill >> nth=-1')
        check(page.locator('.controls .pill >> nth=-1').inner_text().startswith('0,5'), 'rychlost 0,5×')

        print('Režimy učení')
        page.click('.seg button:has-text("Mizení")')
        page.wait_for_selector('.w.hide', timeout=3000)
        n_hidden = page.locator('.w.hide').count()
        check(n_hidden > 0, f'mizení skrylo {n_hidden} slov')
        page.locator('.w.hide').first.click()
        check(page.locator('.w.peek').count() == 1, 'ťuknutí odkryje slovo')
        page.click('.seg button:has-text("Písmena")')
        total_words = sum(len(l.split()) for l in LRC.split('\n') if l.strip())
        check(page.locator('.w.hide').count() == total_words, 'písmena: skryta všechna slova')
        check(page.locator('.w.hide .first').first.inner_text() == 'A', 'první písmeno vidět')
        shot(page, '04-pismena')
        page.click('text=Odkrýt vše')
        check(page.locator('.w.hide').count() == 0, 'odkrýt vše')
        page.click('.seg button:has-text("Číst")')

        print('Úprava verše')
        page.locator('.lyric .more').first.click()
        page.click('text=Upravit verš, překlad, poznámku')
        boxes = page.locator('.sheet textarea')
        boxes.nth(1).fill('Na břehu moře jsou rudé růže')
        boxes.nth(3).fill("'nghariad = fy nghariad — mutace")
        page.click('.sheet button:has-text("Uložit")')
        page.wait_for_selector('.lyric .tr')
        check('rudé růže' in page.locator('.lyric .tr').first.inner_text(), 'překlad uložen a zobrazen')
        shot(page, '05-preklad')

        print('Úprava písně zachová překlad')
        page.click('[aria-label="Další možnosti"]')
        page.click('text=Upravit píseň')
        page.wait_for_selector('textarea')
        txt = page.input_value('textarea')
        page.fill('textarea', txt + '\n[00:13.00]Verš navíc')
        page.click('button[type=submit]')
        page.wait_for_selector('.lyric .tr')
        check(page.locator('.lyric').count() == 5 and 'rudé růže' in page.locator('.lyric .tr').first.inner_text(), 'nový verš přidán, překlad zůstal')

        print('Časování ťukáním')
        page.click('[aria-label="Další možnosti"]')
        page.click('text=Časovat verše ťukáním')
        page.wait_for_selector('.tap-btn')
        page.once('dialog', lambda d: d.accept())
        page.click('.section button:has-text("Smazat časy")')
        page.wait_for_timeout(300)
        for i in range(5):
            page.locator('.tap-btn').dispatch_event('pointerdown')
            page.wait_for_timeout(350)
        check(page.locator('.sync-list li.done').count() == 5, 'pět veršů načasováno')
        shot(page, '06-casovani')
        page.click('.topbar button:has-text("Uložit")')
        page.wait_for_selector('.lyric .time')
        times = page.locator('.lyric .time').all_inner_texts()
        check(len(times) == 5, f'časy uloženy: {times}')

        print('Knihovna a hledání')
        page.click('[aria-label="Zpět"]')
        page.wait_for_selector('.song-card')
        check(page.locator('.song-card .badge').count() == 2, 'odznaky ⏱ a ♪')
        shot(page, '07-knihovna')

        print('Import JSON (Lyrics Trainer)')
        page.click('[aria-label="Nastavení"]')
        with page.expect_file_chooser() as fc:
            page.click('text=Načíst soubor')
        fc.value.set_files(str(TMP / 'gemini.json'))
        page.wait_for_selector('text=Načteno: 1 nových')
        shot(page, '08-nastaveni')

        print('Záloha se zvukem a obnova v novém zařízení')
        page.check('input[type=checkbox] >> nth=1')
        with page.expect_download() as dl:
            page.click('text=Stáhnout zálohu')
        backup = TMP / 'zaloha.json'
        dl.value.save_as(backup)
        data = json.loads(backup.read_text())
        check(data['app'] == 'alaw' and len(data['songs']) == 2 and len(data['audio']) == 1, 'záloha: 2 písně, 1 nahrávka')

        ctx2 = browser.new_context(**p.devices['Pixel 7'])
        page2 = ctx2.new_page()
        page2.on('pageerror', lambda e: errors.append(str(e)))
        page2.goto(url + '#/settings')
        with page2.expect_file_chooser() as fc:
            page2.click('text=Načíst soubor')
        fc.value.set_files(str(backup))
        page2.wait_for_selector('text=Načteno: 2 nových')
        page2.goto(url)
        page2.wait_for_selector('.song-card')
        check(page2.locator('.song-card').count() == 2, 'obnova: 2 písně')
        page2.click('text=Ukázková píseň')
        page2.wait_for_selector('.contr span')
        check("Dwi'n → Rydw i yn" in page2.locator('.contr').inner_text(), 'zkratky z Lyrics Traineru')
        page2.click('[aria-label="Zpět"]')
        page2.click('text=Ar Lan y Môr')
        wait(page2, 'document.querySelector(".progress")?.max > 15000')
        check(True, 'nahrávka obnovená ze zálohy hraje')

        print('Offline (service worker)')
        page.goto(url)
        wait(page, 'navigator.serviceWorker.controller', 10000)
        ctx.set_offline(True)
        page.reload()
        page.wait_for_selector('.song-card')
        check(True, 'aplikace se načte offline')

        browser.close()
    srv.shutdown()
    real = [e for e in errors if 'favicon' not in e]
    if real:
        raise AssertionError('Chyby v konzoli: ' + ' | '.join(real))
    print('\nVšechny testy prošly.')

if __name__ == '__main__':
    main()
