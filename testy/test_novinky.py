# Test novinek 0.17: návrat v knihovně + šipka nahoru, vlastní překlad, ověřování přepisu, zpívání na celou obrazovku,
# verš a překlad v malém přehrávači, vyrovnání hlasitosti, zpěvník, čekání při 429, časy slov z Groq.
# Spuštění: python3 -u testy/test_novinky.py [složka_pro_snímky]
import base64, json, subprocess, sys, tempfile, threading, time
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
SHOTS = Path(sys.argv[1]) if len(sys.argv) > 1 else None
TMP = Path(tempfile.mkdtemp())
errors = []

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

lr_calls = []
def lrclib(route):
    lr_calls.append(route.request.url)
    h = {'access-control-allow-origin': '*'}
    if len(lr_calls) == 1:
        return route.fulfill(status=429, body='slow down', headers=h)
    return route.fulfill(json=[], headers=h)

R = 'window.__alawRadio'
SONG = lambda title: f"(async () => (await (await import('./js/store.js')).listSongs()).find(s => s.title === {json.dumps(title)}))()"

def main():
    loud = TMP / 'loud.wav'
    subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=6', '-af', 'volume=7', '-ac', '1', '-ar', '8000', str(loud)], check=True)
    quiet = TMP / 'quiet.wav'
    subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=330:duration=6', '-ac', '1', '-ar', '8000', str(quiet)], check=True)
    b64 = [base64.b64encode(f.read_bytes()).decode() for f in (loud, quiet)]
    srv = serve()
    url = f'http://127.0.0.1:{srv.server_address[1]}/'
    with sync_playwright() as p:
        browser = p.chromium.launch(args=['--autoplay-policy=no-user-gesture-required'])
        ctx = browser.new_context(**p.devices['Pixel 7'], locale='cs-CZ')
        ctx.grant_permissions(['clipboard-read', 'clipboard-write'], origin=url.rstrip('/'))
        page = ctx.new_page()
        page.on('console', lambda m: m.type == 'error' and errors.append(m.text))
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.route('https://lrclib.net/**', lrclib)
        page.goto(url)
        page.wait_for_selector('text=Croeso!')

        print('Písně (lidové, volné dílo)')
        page.evaluate('''async ([b64]) => {
          const store = await import('./js/store.js'), m = await import('./js/model.js');
          const add = async (title, lrc, audio, extra = {}) => {
            const s = m.newSong({ title, artist: 'Lidová', lines: m.parseLyrics(lrc), versionExtra: extra });
            if (audio != null) {
              const bin = Uint8Array.from(atob(b64[audio]), c => c.charCodeAt(0)), key = 'k' + audio;
              await store.putAudioBlob(key, new Blob([bin], { type: 'audio/wav' }));
              s.versions[0].audio = { key, name: key + '.wav', type: 'audio/wav', size: bin.length };
            }
            await store.saveSong(s);
          };
          await add('Ar Lan y Môr', "[00:00.00]Ar lan y môr mae rhosys cochion\\n[00:02.50]Ar lan y môr mae lilis gwynion", 0);
          await add('Calon Lân', "[00:00.00]Nid wy'n gofyn bywyd moethus\\n[00:03.00]Aur y byd na'i berlau mân", 1, { source: 'přepis', label: 'Přepis (Bangor)' });
          await add('Suo Gân', '', null);
          for (let i = 1; i <= 25; i++) await add(`Zz výplň ${String(i).padStart(2, '0')}`, 'La la la', null);
        }''', [b64])
        page.reload()
        page.wait_for_selector('.song-card')

        print('16 Knihovna: návrat k otevřené písni, šipka nahoru')
        check(page.locator('.to-top:not([hidden])').count() == 0, 'nahoře šipka není')
        card = page.locator('.song-card:has-text("Zz výplň 22")')
        card.scroll_into_view_if_needed()
        page.wait_for_timeout(200)
        y0 = page.evaluate('scrollY')
        check(y0 > 600 and page.locator('.to-top:not([hidden])').count() == 1, f'odrolováno ({y0}) → šipka nahoru')
        card.click()
        page.wait_for_selector('.lyric')
        page.go_back()
        page.wait_for_selector('.song-card')
        wait(page, 'scrollY > 500')
        check(abs(page.evaluate('scrollY') - y0) < 60, 'po Zpět jsem na stejném místě')
        check(page.locator('.song-card.last-open:has-text("Zz výplň 22")').count() == 1, 'otevřená píseň je zvýrazněná')
        page.click('.to-top')
        wait(page, 'scrollY < 5')
        check(True, 'šipka vyjede nahoru')

        print('15 Vlastní překlad')
        page.click('.song-card:has-text("Ar Lan y Môr")')
        page.wait_for_selector('.lyric')
        page.click('.topbar [aria-label="Další možnosti"]')
        page.click('.sheet >> text=Vložit vlastní překlad…')
        page.click('text=📋 Zkopírovat text pro AI')
        clip = page.evaluate('navigator.clipboard.readText()')
        check('1. Ar lan y môr mae rhosys cochion' in clip and '2. Ar lan y môr mae lilis gwynion' in clip and 'češtin' in clip, 'očíslovaný text s pokynem ve schránce')
        page.fill('.sheet textarea', '1. Na břehu moře jsou rudé růže\n2. Na břehu moře jsou bílé lilie')
        check('Přiřazeno 2 z 2' in page.locator('.sheet .hint').first.inner_text(), 'přiřazeno 2 z 2')
        shot(page, 'n1-preklad')
        page.click('.sheet button:has-text("Uložit")')
        page.wait_for_selector('.lyric .tr')
        check(page.locator('.lyric .tr').first.inner_text() == 'Na břehu moře jsou rudé růže', 'překlad u verše')
        s = page.evaluate(SONG('Ar Lan y Môr'))
        check(s['versions'][0]['lines'][1]['start'] == 2500, 'časy veršů zůstaly')
        page.click('.topbar [aria-label="Další možnosti"]')
        page.click('.sheet >> text=Vložit vlastní překlad…')
        page.click('.sheet button:has-text("angličtina")')
        page.click('.sheet button:has-text("Doslovně")')
        page.fill('.sheet textarea', 'Ar lan y môr mae rhosys cochion\nOn shore the sea are roses red\nAr lan y môr mae lilis gwynion\nOn shore the sea are lilies white')
        check('Přiřazeno 2 z 2' in page.locator('.sheet .hint').first.inner_text(), 'střídavě s originálem → originál vynechán')
        page.click('.sheet button:has-text("Uložit")')
        wait(page, "!document.querySelector('.sheet')")
        s = page.evaluate(SONG('Ar Lan y Môr'))
        l0 = s['versions'][0]['lines'][0]
        check(l0['en']['literal'] == 'On shore the sea are roses red' and l0['translation'] == 'Na břehu moře jsou rudé růže', 'anglický doslovný uložen, český zůstal')

        print('7 Zpívání na celou obrazovku')
        page.click('.playerbar button:has-text("⛶")')
        page.wait_for_selector('.stage')
        page.click('.stage .play')
        wait(page, "document.querySelector('.st-cur')?.textContent === 'Ar lan y môr mae lilis gwynion'", 6000)
        check(page.locator('.st-prev').inner_text() == 'Ar lan y môr mae rhosys cochion', 'velký aktuální verš, předchozí nad ním')
        shot(page, 'n2-zpivani')
        page.click('.stage [aria-label="Zavřít"]')
        check(page.locator('.stage').count() == 0, 'zavřeno')
        page.click('.playerbar .play')

        print('9 Ověřování přepisu')
        page.goto(url + '#/')
        page.wait_for_selector('.song-card')
        check(page.locator('.chip:has-text("K ověření (1)")').count() == 1, 'v knihovně filtr „K ověření (1)“')
        page.click('.chip:has-text("K ověření")')
        check(page.locator('.song-card').count() == 1, 'filtr ukáže jen přepsanou píseň')
        page.click('.song-card:has-text("Calon Lân")')
        page.wait_for_selector('.rbar')
        check('Ověřeno 0 z 2' in page.locator('.rbar').inner_text() and page.locator('.lyric.unv').count() == 2, 'proužek 0 z 2, verše označené')
        page.click('.rbar button:has-text("Ověřovat")')
        page.click('.lyric >> nth=0 >> .okbtn')
        wait(page, "document.querySelector('.rbar').textContent.includes('1 z 2')")
        check(page.locator('.lyric.unv').count() == 1, 'odškrtnutý verš je ověřený')
        shot(page, 'n3-overovani')
        page.click('.lyric >> nth=1 >> .more')
        page.click('.sheet >> text=Upravit verš')
        page.click('.sheet button:has-text("Uložit")')
        wait(page, "document.querySelector('.rbar').textContent.includes('Všechny verše ověřené')")
        check(True, 'upravený verš = ověřený, vše hotovo')
        page.goto(url + '#/')
        page.wait_for_selector('.song-card')
        check(page.locator('.chip:has-text("K ověření")').count() == 0, 'filtr zmizel')

        print('6 + 5 Malý přehrávač: verš s překladem, vyrovnání hlasitosti')
        page.click('.sel-toggle')
        page.click('.song-card:has-text("Ar Lan y Môr")')
        page.click('.sel-bar button:has-text("Přehrát (1)")')
        wait(page, f'{R}.player.playing')
        wait(page, "document.querySelector('.mini-line:not([hidden]) .ml-text')", 4000)
        check(page.locator('.mini-line .ml-tr').inner_text().startswith('Na břehu moře'), 'v malém přehrávači verš a překlad')
        mh = page.evaluate("parseInt(getComputedStyle(document.body).getPropertyValue('--mini-h'))")
        check(mh > 80, f'výška malého přehrávače se započítá ({mh} px)')
        wait(page, f'{R}.player.audio && {R}.player.audio.volume < 0.5', 8000)
        vol = page.evaluate(f'{R}.player.audio.volume')
        check(json.loads(page.evaluate("localStorage.getItem('alaw-loud')")).get('k0') is not None, f'hlasitá nahrávka změřena a ztlumena (hlasitost {vol:.2f})')
        db = page.evaluate("(async () => { const L = await import('./js/loudness.js'); const n = 8000, a = new Float32Array(n * 2); for (let i = 0; i < a.length; i++) a[i] = 0.1 * Math.sin(i / 3); return L.loudnessDb([a], n); })()")
        check(-24 < db < -22, f'měření hlasitosti: sinus 0,1 ≈ −23 dB ({db:.1f})')
        shot(page, 'n4-maly-prehravac')
        page.click('.minibar [aria-label="Ukončit náhodné přehrávání"]')

        print('11 Zpěvník')
        page.click('.sel-toggle')
        page.click('.song-card:has-text("Ar Lan y Môr")')
        page.click('.song-card:has-text("Calon Lân")')
        page.click('.sel-bar button:has-text("Zpěvník (2)")')
        page.wait_for_selector('.book')
        check(page.locator('.b-song').count() == 2 and page.locator('.b-toc li').count() == 2, 'dvě písně a obsah')
        page.click('.b-tools button:has-text("čeština")')
        check(page.locator('.b-tr').first.inner_text() == 'Na břehu moře jsou rudé růže', 'překlad pod veršem')
        page.click('.b-tools label:has-text("Obsah na začátku") input')
        page.click('.b-tools button:has-text("bez")')
        check('null' not in page.locator('.view').inner_text(), 'bez obsahu a překladu: žádné „null“')
        page.click('.b-tools label:has-text("Obsah na začátku") input')
        page.evaluate('window.print = () => { window.__printed = document.title; }')
        page.click('text=🖨 Uložit jako PDF')
        wait(page, 'window.__printed')
        check(page.evaluate('window.__printed') == 'Zpěvník', 'tisk s názvem zpěvníku')
        shot(page, 'n5-zpevnik')

        print('12 Najít texty: 429 → počkat a zkusit znovu')
        page.evaluate('window.__alawWait429 = 1500; window.__alawBulkDelay = 0')
        page.goto(url + '#/lyrics')
        page.wait_for_selector('text=Najít texty')
        page.click('button:has-text("🔍 Hledat texty")')
        wait(page, "document.body.textContent.includes('Čekám')", 5000)
        check(True, 'po 429 čeká a odpočítává')
        wait(page, 'document.body.textContent.includes("Hledat znovu nenalezené")', 10000)
        check(len(lr_calls) >= 2 and lr_calls[0] == lr_calls[1] and 'Web nás nepustil' not in page.locator('.view').inner_text(), 'druhý pokus prošel, žádná chyba')

        print('13 Groq: časy slov k úsekům')
        res = page.evaluate('''(async () => {
          const { withWords, whisperLines } = await import('./js/stt.js');
          const segs = [{ start: 0, end: 6, text: ' Ar lan y môr mae rhosys cochion Ar lan y môr mae lilis gwynion', no_speech_prob: 0.1, avg_logprob: -0.2, compression_ratio: 1.1 }];
          const w = 'Ar lan y môr mae rhosys cochion Ar lan y môr mae lilis gwynion'.split(' ');
          const words = w.map((x, i) => ({ word: x, start: i < 7 ? i * 0.3 : 3.5 + (i - 7) * 0.3, end: i < 7 ? i * 0.3 + 0.25 : 3.5 + (i - 7) * 0.3 + 0.25 }));
          return whisperLines(withWords(segs, words)).map(l => [l.text, l.start]);
        })()''')
        check(res == [['Ar lan y môr mae rhosys cochion', 0], ['Ar lan y môr mae lilis gwynion', 3500]], f'dlouhý úsek rozdělen na dva verše ({res})')

        real = [e for e in errors if '429 (Too Many Requests)' not in e]  # 429 = schválně z napodobeného LRCLIB
        check(not real, 'bez chyb v konzoli' + (f': {real}' if real else ''))
        browser.close()
    print('Hotovo – vše prošlo.')

main()
