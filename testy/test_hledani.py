# Test hledání textů, převzetí do písně, časů z LRCLIB, překladu ze zdroje, sdílení odkazu a překladu přes Gemini.
# Bez sítě: aplikace běží v „režimu Androidu“ (napodobený most AlawAndroid) a weby odpovídají ukázkovými daty
# se strukturou skutečných stránek. Gemini je napodobené přes page.route. Spuštění: python3 testy/test_hledani.py [snímky]
import json, sys, tempfile, threading, time
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse, parse_qs
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
SHOTS = Path(sys.argv[1]) if len(sys.argv) > 1 else None

# Lidová píseň (volné dílo).
CY = ["Ar lan y môr mae rhosys cochion", "Ar lan y môr mae lilis gwynion", "Ar lan y môr mae 'nghariad inne", "Yn cysgu'r nos a chodi'r bore"]
EN = ["At the seaside are red roses", "At the seaside are white lilies", "At the seaside is my love", "Sleeping the night and waking in the morning"]
LRC = '\n'.join(f'[00:{4 + i * 3:02d}.50] {l}' for i, l in enumerate(CY))

WIKI = ("{{Song|Singer=Traditional|Released=Unknown|Genre=Folk}}\n<youtube>https://www.youtube.com/watch?v=X-Sbi4OenxY</youtube>\n"
        "{{Lyrics|Cymraeg=" + '\n'.join(CY[:2]) + "\n\n" + '\n'.join(CY[2:]) + "|Saesneg=" + '\n'.join(EN[:2]) + "\n\n" + '\n'.join(EN[2:]) + "}}\n[[Category:Folk]]")

LT_SEARCH = """<html><body><div class="block-search-res__item"><div class="s-search-table__block-1"><div class="table__block-1 block-1-table">
<a href="/en/jana-lyrics.html" class="block-1-table__title"><h2>Jana</h2></a></div></div></div>
<div class="block-search-res__item"><div class="s-search-table__block-1"><div class="table__block-1 block-1-table">
<a href="/en/ar-log-ar-lan-y-mor-lyrics.html" class="block-1-table__title"><h2>Ar Lan y Môr</h2></a>
<div class="block-1-table__author-wrap"><a href="/en/ar-log-lyrics.html" class="block-1-table__author"><span class="text">Ar Log</span></a></div>
<div class="table__langs">Welsh</div></div></div></div></body></html>"""
LT_SONG = ("<html><head><title>Ar Log - Ar Lan y Môr lyrics</title></head><body><div id='song-body'><div class='ltf'>"
           "<div class='par'>" + ''.join(f'<div class="ll-0-{i}">{l}</div>' for i, l in enumerate(CY[:2])) + "</div><div class='emptyline'>&nbsp;</div>"
           "<div class='par'>" + ''.join(f'<div class="ll-1-{i}">{l.replace(chr(39), chr(8242))}</div>' for i, l in enumerate(CY[2:])) + "</div></div></div>"
           "<lite-youtube videoid='v-MEA7eQkU8'></lite-youtube></body></html>")
SHARED_PAGE = ("<html><head><title>Hen ganeuon</title></head><body><nav><a>Hafan</a><a>Amdanom</a><a>Cysylltu</a><a>Siop</a></nav>"
               "<h1>Ar Lan y Môr</h1><p>Un o'r caneuon gwerin mwyaf adnabyddus yng Nghymru, a genir yn aml mewn eisteddfodau a chyngherddau ledled y wlad gan gorau ac unawdwyr o bob oed.</p>"
               "<div class='lyrics'><p>" + '<br>'.join(CY[:2]) + "</p><p>" + '<br>'.join(CY[2:]) + "</p></div><footer>© 2026</footer></body></html>")

def respond(req):
    u = urlparse(req['url'])
    host, path, q = u.hostname, u.path, parse_qs(u.query)
    ok = lambda body, status=200: json.dumps({'status': status, 'text': body if isinstance(body, str) else json.dumps(body), 'url': req['url']})
    if host == 'lrclib.net':
        return ok([{'id': 1, 'trackName': 'Ar Lan y Môr', 'artistName': 'Jana', 'albumName': 'Caneuon', 'duration': 30, 'instrumental': False,
                    'plainLyrics': '\n'.join(CY), 'syncedLyrics': LRC}])
    if host == 'welshlyrics.fandom.com':
        if q.get('list') == ['search']:
            return ok({'query': {'search': [{'title': 'Ar Lan y Môr (traditional)'}, {'title': 'Recently Added Songs'}]}})
        return ok({'query': {'pages': [{'title': 'Ar Lan y Môr (traditional)', 'revisions': [{'slots': {'main': {'content': WIKI}}}]}]}})
    if host == 'cy.wikisource.org':
        return ok({'error': 'x'}, 429)
    if host == 'lyricstranslate.com':
        return ok(LT_SEARCH if 'site-search' in path else LT_SONG)
    if host == 'bandcamp.com':
        return ok({'auto': {'results': []}})
    if host == 'welearnwelsh.com':
        return ok([])
    if host == 'genius.com':
        return ok('blocked', 403)
    if host == 'hen-ganeuon.example':
        return ok(SHARED_PAGE)
    return json.dumps({'error': 'offline'})

GEMINI_MODELS = {'models': [
    {'name': 'models/gemini-3.5-flash', 'supportedGenerationMethods': ['generateContent']},
    {'name': 'models/gemini-3.7-flash', 'supportedGenerationMethods': ['generateContent']},
    {'name': 'models/gemini-3.7-flash-lite', 'supportedGenerationMethods': ['generateContent']},
    {'name': 'models/text-embedding-004', 'supportedGenerationMethods': ['embedContent']}]}
gemini_calls = []

def gemini(route):
    req = route.request
    gemini_calls.append(req.url)
    if req.headers.get('x-goog-api-key') != 'AIzaTEST':
        return route.fulfill(status=400, json={'error': {'message': 'API key not valid'}})
    if req.url.endswith('/models?pageSize=1000'):
        return route.fulfill(json=GEMINI_MODELS)
    body = json.loads(req.post_data)
    payload = json.loads(body['contents'][0]['parts'][0]['text'])
    assert 'gemini-3.7-flash:generateContent' in req.url, req.url
    if 'lines' in payload:
        out = {'lines': [{'id': l['id'], 'translation': f"CZ {l['original'][:12]}", 'literal': 'doslovně', 'contractions':
                          [{'short': "'nghariad", 'full': 'fy nghariad', 'note': 'vynechané fy'}] if 'nghariad' in l['original'] else []} for l in payload['lines']]}
    else:
        out = {'words': [{'word': w, 'base': w.lower(), 'meaning': 'význam', 'grammar': ''} for w in payload['line'].split()], 'note': 'Opakuje se „Ar lan y môr“.'}
    route.fulfill(json={'candidates': [{'content': {'parts': [{'text': json.dumps(out, ensure_ascii=False)}]}, 'finishReason': 'STOP'}]})

errors = []
def check(cond, msg):
    if not cond: raise AssertionError(msg)
    print('  ✓', msg)

def wait(page, js, timeout=8000):
    end = time.time() + timeout / 1000
    while time.time() < end:
        if page.evaluate(f'() => !!({js})'): return
        page.wait_for_timeout(100)
    raise AssertionError(f'Nedočkal jsem se: {js}')

def shot(page, name):
    if SHOTS:
        SHOTS.mkdir(parents=True, exist_ok=True)
        page.screenshot(path=str(SHOTS / f'{name}.png'))

def main():
    class Q(SimpleHTTPRequestHandler):
        def log_message(self, *a): pass
    srv = ThreadingHTTPServer(('127.0.0.1', 0), partial(Q, directory=str(ROOT)))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    url = f'http://127.0.0.1:{srv.server_address[1]}/'
    saved = []
    with sync_playwright() as p:
        b = p.chromium.launch()
        ctx = b.new_context(**p.devices['Pixel 7'])
        page = ctx.new_page()
        page.on('pageerror', lambda e: (print('!!! PAGEERROR', e), errors.append('P1 ' + str(e))))
        # chyby sítě (neplatný klíč v testu, YouTube bez internetu) nejsou chyby aplikace
        page.on('console', lambda m: m.type == 'error' and not any(x in m.text for x in ('Failed to load resource', 'network error', 'A network error occurred')) and errors.append(m.text))
        page.expose_function('pyFetch', lambda j: respond(json.loads(j)))
        page.expose_function('pySave', lambda n, m, b64: saved.append((n, m, len(b64))))
        page.add_init_script("""window.AlawAndroid = { fetch: (id, j) => window.pyFetch(j).then(r => window.__alawNet(id, r)),
          version: () => '0.1.0', open: u => { window.__opened = u; }, saveFile: (n, m, b) => window.pySave(n, m, b), setBars: () => {} };""")
        page.route('https://generativelanguage.googleapis.com/**', gemini)
        page.route('https://www.youtube.com/**', lambda r: r.abort())  # YouTube se tu netestuje
        page.route('https://api.github.com/repos/tvspk/alaw/releases/latest', lambda r: r.fulfill(json={'tag_name': 'v0.3.0'}))
        page.goto(url)

        print('Nabídka nové verze (APK)')
        page.wait_for_selector('.update-bar', timeout=6000)
        check('0.3.0' in page.inner_text('.update-bar'), 'pruh s novou verzí')
        page.click('.update-bar >> text=Stáhnout')
        check(page.evaluate('window.__opened').endswith('/releases/latest/download/alaw.apk'), 'otevře stažení APK')
        page.click('.update-bar >> text=Později')

        print('Hledání')
        page.click('.fab')
        page.click('text=Najít text na internetu')
        page.fill('input[placeholder="Název písně"]', 'Ar Lan y Môr')
        page.click('.search-form button[type=submit]')
        page.wait_for_selector('.src:has-text("LRCLIB") .result')
        page.wait_for_selector('.src:has-text("Welsh Lyrics wiki") .result')
        page.wait_for_selector('.src:has-text("LyricsTranslate") .result')
        wait(page, '![...document.querySelectorAll(".src-status")].some(e => e.textContent === "Hledám…")')
        check(page.locator('.src:has-text("LyricsTranslate") .result').count() == 1, 'LyricsTranslate: stránka interpreta vyřazena, píseň nalezena')
        check('nepustil' in page.inner_text('.src:has-text("Genius")'), 'Genius: chyba zobrazena u zdroje')
        check('⏱ s časy' in page.inner_text('.src:has-text("LRCLIB") .result'), 'LRCLIB: odznak s časy')
        shot(page, '01-vysledky')

        print('Náhled z wiki: časy z LRCLIB + anglický překlad')
        page.click('.src:has-text("Welsh Lyrics wiki") .result')
        page.wait_for_selector('.lyrics-preview')
        check('4 z 4' in page.inner_text('.sheet'), 'nabídka časů z LRCLIB (4 z 4 veršů)')
        shot(page, '02-nahled')
        page.click('text=Použít tento text')
        page.wait_for_selector('text=Text převzat')
        check(page.input_value('input[placeholder="Calon Lân"]') == 'Ar Lan y Môr', 'název z wiki')
        check(page.input_value('input[placeholder="Interpret (nepovinné)"]') == 'Traditional', 'interpret z wiki')
        check('X-Sbi4OenxY' in page.input_value('input[placeholder="https://youtu.be/…"]'), 'video z wiki')
        check(page.input_value('textarea').startswith('[00:04.50]'), 'text s časy z LRCLIB')
        page.click('button[type=submit]')
        page.wait_for_selector('.lyric .alt')
        check(page.locator('.lyric .alt').first.inner_text() == EN[0], 'anglický překlad ze zdroje u veršů')
        check(page.locator('.lyric.stanza').count() == 1, 'sloky zachované')
        check(page.locator('.lyric .time').first.inner_text() == '00:04', 'časy u veršů')
        shot(page, '03-pisen')

        print('Gemini: klíč a překlad')
        page.click('[aria-label="Další možnosti"]')
        page.once('dialog', lambda d: d.accept())
        page.click('text=Přeložit pomocí AI')
        page.wait_for_selector('text=Klíč API')
        page.fill('input[placeholder="AIza…"]', 'spatny')
        page.click('text=Uložit a ověřit')
        page.wait_for_selector('text=Klíč pro Gemini není platný.')
        check(True, 'neplatný klíč odmítnut')
        page.fill('input[placeholder="AIza…"]', 'AIzaTEST')
        page.click('text=Uložit a ověřit')
        page.wait_for_selector('text=Model: gemini-3.7-flash')
        check(True, 'vybrán nejnovější model flash (ne lite)')
        page.click('[aria-label="Zpět"]')
        page.wait_for_selector('.lyrics .lyric')
        page.click('[aria-label="Další možnosti"]')
        page.click('text=Přeložit pomocí AI')
        page.wait_for_selector('.lyric .tr')
        check(page.locator('.lyric .tr').count() == 4, 'všechny verše přeložené')
        check("'nghariad → fy nghariad" in page.inner_text('.lyric >> nth=2'), 'zkratka z AI')
        page.locator('.lyric .more').nth(0).click()
        page.click('text=Vysvětlit verš slovo po slovu')
        page.wait_for_selector('.gloss')
        n = page.locator('.gloss tr').count(); check(n == 7, f'vysvětlení: {n} slov verše')
        page.click('text=Uložit do poznámky verše')
        page.click('.sheet >> text=Zavřít')
        page.wait_for_selector('.lyric .note')
        check('Opakuje se' in page.inner_text('.lyric .note'), 'vysvětlení uloženo do poznámky')
        shot(page, '04-preklad')

        print('Tlačítko Zpět (Android)')
        page.locator('.lyric .more').nth(1).click()
        check(page.evaluate('window.alawBack()') and page.locator('.sheet').count() == 0, 'Zpět zavře nabídku')
        page.evaluate('window.alawBack()')
        page.wait_for_selector('.song-card')
        check(page.evaluate('window.alawBack()') is False, 'na knihovně Zpět aplikaci nezavírá sama (vrací false)')

        print('Uložení zálohy (Android)')
        page.click('[aria-label="Nastavení"]')
        page.click('text=Stáhnout zálohu')
        wait(page, 'true', 500)
        page.wait_for_timeout(500)
        check(saved and saved[0][0].startswith('alaw-zaloha-') and saved[0][2] > 100, f'záloha předána Androidu k uložení: {saved[0][0] if saved else None}')
        check('prostředník není potřeba' in page.inner_text('body'), 'na Androidu bez nastavení prostředníka')

        print('Sdílení odkazu')
        page.goto(url + '?share-url=' + 'https%3A%2F%2Fhen-ganeuon.example%2Far-lan')
        page.wait_for_selector('.lyrics-preview')
        prev = page.inner_text('.lyrics-preview')
        check(prev.startswith(CY[0]) and 'eisteddfodau' not in prev and 'Hafan' not in prev, 'z obecné stránky jen text písně')
        page.click('text=Použít tento text')
        check(page.input_value('input[placeholder="Calon Lân"]') == 'Ar Lan y Môr', 'název ze stránky')
        check(len(page.input_value('textarea').split('\n')) == 5, 'čtyři verše + prázdný řádek mezi slokami')
        shot(page, '05-sdileni')

        print('Text z odkazu (LyricsTranslate)')
        page.click('text=Z odkazu')
        page.fill('input[type=url]', 'https://lyricstranslate.com/en/ar-log-ar-lan-y-mor-lyrics.html')
        page.click('.sheet button[type=submit]')
        page.wait_for_selector('.lyrics-preview')
        check("'nghariad" in page.inner_text('.lyrics-preview') and '′' not in page.inner_text('.lyrics-preview'), 'apostrofy sjednocené')

        print('Web na počítači bez prostředníka')
        ctx2 = b.new_context()
        p2 = ctx2.new_page()
        p2.on('pageerror', lambda e: errors.append('P2 ' + str(e) + ' ' + str(e.stack)[:300]))
        p2.route('https://lrclib.net/**', lambda r: r.fulfill(json=json.loads(json.loads(respond({'url': r.request.url}))['text']), headers={'access-control-allow-origin': '*'}))
        p2.route('https://welshlyrics.fandom.com/**', lambda r: r.fulfill(body=json.loads(respond({'url': r.request.url}))['text'], headers={'access-control-allow-origin': '*', 'content-type': 'application/json'}))
        p2.route('https://cy.wikisource.org/**', lambda r: r.fulfill(status=429, body='{}', headers={'access-control-allow-origin': '*'}))
        p2.route('https://welearnwelsh.com/**', lambda r: r.fulfill(json=[], headers={'access-control-allow-origin': '*'}))
        p2.goto(url + '#/new')
        p2.click('text=Najít text na internetu')
        p2.fill('input[placeholder="Název písně"]', 'Ar Lan y Môr')
        p2.click('.search-form button[type=submit]')
        p2.wait_for_selector('.src:has-text("Welsh Lyrics wiki") .result')
        wait(p2, '![...document.querySelectorAll(".src-status")].some(e => e.textContent === "Hledám…")')
        check('prostředníka' in p2.inner_text('.src:has-text("LyricsTranslate")'), 'bez prostředníka: srozumitelná hláška u zdroje')
        check(p2.locator('.src:has-text("LRCLIB") .result').count() == 1, 'LRCLIB jde přímo z prohlížeče')
        b.close()
    srv.shutdown()
    if errors:
        raise AssertionError('Chyby v konzoli: ' + ' | '.join(errors))
    print('\nHledání: všechny testy prošly.')

if __name__ == '__main__':
    main()
