# Test náhodného přehrávání (0.16): společný přehrávač, malý přehrávač dole, připojení obrazovky písně,
# přechod na další píseň, pozastavení jiným přehrávačem, výběr označených. Spuštění: python3 -u testy/test_prehravac.py [složka_pro_snímky]
import base64, subprocess, sys, tempfile, threading, time
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
SHOTS = Path(sys.argv[1]) if len(sys.argv) > 1 else None
TMP = Path(tempfile.mkdtemp())
errors = []

# Lidové písně (volné dílo), jen první verše.
SONGS = [
    ('Ar Lan y Môr', 'Lidová', "[00:00.00]Ar lan y môr mae rhosys cochion\n[00:02.00]Ar lan y môr mae lilis gwynion", True),
    ('Calon Lân', 'Lidová', "[00:00.00]Nid wy'n gofyn bywyd moethus\n[00:02.00]Aur y byd na'i berlau mân", True),
    ('Dafydd y Garreg Wen', 'Lidová', "[00:00.00]Cariwch, medd Dafydd, fy nhelyn i mi\n[00:02.00]Ceisiaf cyn marw roi tôn arni hi", True),
    ('Suo Gân', 'Lidová', "Huna blentyn ar fy mynwes", False),
]

def check(cond, msg):
    if not cond:
        raise AssertionError(msg)
    print('  ✓', msg)

def serve():
    class Quiet(SimpleHTTPRequestHandler):
        def log_message(self, *a):
            pass
    srv = ThreadingHTTPServer(('127.0.0.1', 0), partial(Quiet, directory=str(ROOT)))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv

def wait(page, js, timeout=10000):
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

R = 'window.__alawRadio'
CUR = f'{R}.current()'

def main():
    b64 = []
    for i, f in enumerate((330, 440, 550)):
        wav = TMP / f'n{i}.wav'
        subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', f'sine=frequency={f}:duration=3.5', '-ac', '1', '-ar', '8000', str(wav)], check=True)
        b64.append(base64.b64encode(wav.read_bytes()).decode())
    srv = serve()
    url = f'http://127.0.0.1:{srv.server_address[1]}/'
    with sync_playwright() as p:
        browser = p.chromium.launch(args=['--autoplay-policy=no-user-gesture-required'])
        ctx = browser.new_context(**p.devices['Pixel 7'], locale='cs-CZ')
        page = ctx.new_page()
        page.on('console', lambda m: m.type == 'error' and errors.append(m.text))
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.goto(url)
        page.wait_for_selector('text=Croeso!')

        print('Písně: 3 s nahrávkou, 1 bez')
        page.evaluate('''async ([songs, b64]) => {
          const store = await import('./js/store.js'), m = await import('./js/model.js');
          let i = 0;
          for (const [title, artist, lrc, rec] of songs) {
            const s = m.newSong({ title, artist, lines: m.parseLyrics(lrc) });
            if (rec) {
              const bin = Uint8Array.from(atob(b64[i]), c => c.charCodeAt(0));
              const key = 'test-' + i++;
              await store.putAudioBlob(key, new Blob([bin], { type: 'audio/wav' }));
              s.versions[0].audio = { key, name: key + '.wav', type: 'audio/wav', size: bin.length };
            }
            await store.saveSong(s);
          }
        }''', [SONGS, b64])
        page.reload()
        page.wait_for_selector('.song-card')
        btn = page.locator('.lib-actions button')
        check(btn.inner_text() == '🔀 Přehrát vše náhodně (3)', 'tlačítko v knihovně počítá jen písně s nahrávkou')
        check(page.locator('.minibar:not([hidden])').count() == 0, 'malý přehrávač zatím není')

        print('Spuštění')
        # napodobený most APK: stav pro službu s oznámením (zhasnutá obrazovka)
        page.evaluate("window.AlawAndroid = { media: m => (window.__media = window.__media || []).push(JSON.parse(m)) }")
        btn.click()
        wait(page, f'{R}.player.playing')
        check(page.locator('.minibar:not([hidden])').count() == 1, 'malý přehrávač dole')
        first = page.evaluate(f'{CUR}.song.title')
        check(first in [s[0] for s in SONGS[:3]], f'hraje píseň s nahrávkou ({first})')
        check(page.locator('.mini-title b').inner_text() == first, 'název v malém přehrávači')
        check('1/3' in page.locator('.mini-title small').inner_text(), 'pořadí 1/3')
        wait(page, "document.querySelector('.mini-line:not([hidden])')")
        check('null' not in page.locator('.mini-line').inner_text(), 'verš bez překladu: žádné „null“')
        check(page.evaluate("document.body.classList.contains('mini-on')"), 'ostatní prvky posunuté nad přehrávač')
        shot(page, 'p1-knihovna')

        page.evaluate("(() => { const r = document.querySelector('.mini-seek'); r.value = 2000; r.dispatchEvent(new Event('input')); })()")
        check(page.evaluate(f'{R}.player.time()') >= 1900, 'posuvník v malém přehrávači přetočí píseň')

        media = page.evaluate('window.__media')
        check(media[-1]['state'] == 'playing' and media[-1]['title'] == first and len(media[-1]['labels']) == 5, 'Android: služba dostala název a stav „hraje“')
        page.evaluate("window.alawMedia('pause')")
        wait(page, f'!{R}.player.playing')
        check(page.evaluate('window.__media')[-1]['state'] == 'paused', 'pauza z oznámení → stav „pauza“')
        page.evaluate("window.alawMedia('play')")
        wait(page, f'{R}.player.playing')
        check(True, 'přehrát z oznámení')

        print('Procházení aplikace')
        page.click('.topbar [aria-label="Nastavení"]')
        page.wait_for_selector('text=Učení')
        check(page.evaluate(f'{R}.player.playing'), 'v Nastavení hraje dál')
        check(page.locator('.minibar:not([hidden])').count() == 1, 'malý přehrávač i v Nastavení')

        print('Další píseň sama')
        wait(page, f'{CUR}.song.title !== {first!r}', 8000)
        wait(page, f'{R}.player.playing')
        second = page.evaluate(f'{CUR}.song.title')
        check(second != first, f'po konci hraje další ({second})')
        check(page.evaluate(f'{R}.queueInfo().pos') == 1, 'pozice ve frontě 2')

        print('Text hrající písně')
        page.click('.mini-title')
        page.wait_for_selector('.lyric')
        check(page.locator('.topbar h1 span').inner_text() == second, 'otevřel se text hrající písně')
        check(page.locator('.minibar:not([hidden])').count() == 0, 'u hrající písně je jen přehrávač písně')
        check(page.evaluate(f'{R}.player.playing'), 'hraje dál bez přerušení')
        check(page.locator('.playerbar [aria-label="Další píseň"]').is_visible(), 'v přehrávači písně je ⏭')
        wait(page, "document.querySelector('.lyric.active')")
        check(True, 'karaoke zvýrazňuje verš')
        shot(page, 'p2-pisen')

        print('⏭ na obrazovce písně → text další písně')
        page.click('.playerbar [aria-label="Další píseň"]')
        wait(page, f"{CUR}.song.title !== {second!r} && document.querySelector('.topbar h1 span')?.textContent === {CUR}.song.title")
        third = page.evaluate(f'{CUR}.song.title')
        check(True, f'obrazovka přešla na další píseň ({third})')
        wait(page, f'{R}.player.playing')

        print('⏮ na obrazovce písně → zpět na předchozí')
        page.click('.playerbar [aria-label="Předchozí píseň"]')
        wait(page, f"{CUR}.song.title === {second!r} && document.querySelector('.topbar h1 span')?.textContent === {second!r}")
        check(True, 'zpět na předchozí píseň i s textem')
        wait(page, f'{R}.player.playing')
        page.click('.playerbar button:has-text("⛶")')
        page.wait_for_selector('.stage [aria-label="Předchozí píseň"]')
        check(page.locator('.stage .progress').count() == 1 and page.locator('.stage [aria-label="Další píseň"]').count() == 1, 'celá obrazovka: ⏮ ⏭ a posuvník')
        page.click('.stage [aria-label="Další píseň"]')
        wait(page, f"{CUR}.song.title !== {second!r} && document.querySelector('.stage .st-title b')?.textContent === {CUR}.song.title")
        check(True, 'celá obrazovka zůstane otevřená u další písně')
        page.click('.stage [aria-label="Zavřít"]')
        third = page.evaluate(f'{CUR}.song.title')

        print('Jiná píseň s vlastním přehrávačem')
        other = next(s[0] for s in SONGS[:3] if s[0] != third)
        page.goto(url + '#/')
        page.wait_for_selector('.song-card')
        page.click(f'.song-card:has-text("{other}")')
        page.wait_for_selector('.lyric')
        check(page.locator('.minibar:not([hidden])').count() == 1, 'u jiné písně zůstává malý přehrávač')
        check(page.evaluate('getComputedStyle(document.querySelector(".playerbar")).bottom') != '0px', 'přehrávač písně je nad malým přehrávačem')
        wait(page, "document.querySelector('.progress').max > 3000")
        page.click('.playerbar .play')
        wait(page, f'!{R}.player.playing')
        check(True, 'přehrání jiné písně pozastaví náhodné přehrávání')
        shot(page, 'p3-jina-pisen')
        page.click('.mini-play')
        wait(page, f'{R}.player.playing')
        wait(page, "document.querySelector('.playerbar .play').getAttribute('aria-label') === 'Přehrát'")
        check(True, 'a naopak: malý přehrávač pozastaví píseň')

        print('Ukončení')
        page.click('.minibar [aria-label="Ukončit náhodné přehrávání"]')
        wait(page, f'!{CUR}')
        check(page.locator('.minibar:not([hidden])').count() == 0, 'malý přehrávač zmizel')
        check(page.evaluate('window.__media')[-1]['state'] == 'stopped', 'Android: služba ukončena')

        print('Označené písně')
        page.goto(url + '#/')
        page.wait_for_selector('.song-card')
        page.click('.sel-toggle')
        page.click('.song-card:has-text("Suo Gân")')
        check(page.locator('.sel-bar button:has-text("Přehrát")').count() == 0, 'bez nahrávky nejde přehrát')
        page.click(f'.song-card:has-text("{other}")')
        page.click('.sel-bar button:has-text("Přehrát (1)")')
        wait(page, f'{R}.player.playing')
        check(page.evaluate(f'{R}.queueInfo().total') == 1 and page.evaluate(f'{CUR}.song.title') == other, 'hraje jen označená píseň s nahrávkou')
        check(page.locator('.sel-bar:not([hidden])').count() == 0, 'výběr se ukončil')
        page.click('.minibar [aria-label="Předchozí píseň"]')
        check(page.evaluate(f'{CUR}.song.title') == other, '⏮ na začátku = znovu od začátku')

        check(not errors, 'bez chyb v konzoli' + (f': {errors}' if errors else ''))
        browser.close()
    print('Hotovo – vše prošlo.')

main()
