# Test hromadného přidání písní z nahrávek (#/bulk) a hledání textů (#/lyrics) v mobilním Chromiu.
# LRCLIB je napodobený přes page.route, síť se nepoužívá. Spuštění: python3 -u testy/test_hromadne.py [složka_pro_snímky]
import subprocess, sys, tempfile
from pathlib import Path
from playwright.sync_api import sync_playwright
from test_zaklad import serve, wait, check, shot, errors

TMP = Path(tempfile.mkdtemp())

# Lidové písně (volné dílo).
LRC = "[00:01.00]Ar lan y môr mae rhosys cochion\n[00:04.00]Ar lan y môr mae lilis gwynion\n[00:07.00]Ar lan y môr mae 'nghariad inne\n[00:10.00]Yn cysgu'r nos a chodi'r bore"
PLAIN = "Ar lan y môr mae rhosys cochion\nAr lan y môr mae lilis gwynion\nAr lan y môr mae 'nghariad inne\nYn cysgu'r nos a chodi'r bore"

def tone(path, seconds, meta=None):
    args = ['ffmpeg', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', f'sine=frequency=440:duration={seconds}', '-ac', '1', '-ar', '22050']
    for k, v in (meta or {}).items():
        args += ['-metadata', f'{k}={v}']
    if path.suffix == '.mp3':
        args += ['-id3v2_version', '3']
    subprocess.run(args + [str(path)], check=True)
    return path

def lrclib(route):
    q = route.request.url
    if 'Ar+Lan' in q or 'Ar%20Lan' in q:
        return route.fulfill(json=[
            {'id': 1, 'trackName': 'Ar Lan y Môr', 'artistName': 'Jana', 'albumName': 'Lidové', 'duration': 12, 'instrumental': False, 'plainLyrics': PLAIN, 'syncedLyrics': LRC},
            {'id': 2, 'trackName': 'Ar Lan y Môr', 'artistName': 'Sbor', 'albumName': 'Jiné', 'duration': 95, 'instrumental': False, 'plainLyrics': PLAIN + '\nNavíc', 'syncedLyrics': None}])
    if 'Calon' in q:  # délka nesedí → jen nejistá shoda, časy se nepřevezmou
        return route.fulfill(json=[{'id': 3, 'trackName': 'Calon Lân', 'artistName': 'Rozárka', 'albumName': '', 'duration': 200, 'instrumental': False, 'plainLyrics': PLAIN, 'syncedLyrics': LRC}])
    return route.fulfill(json=[])

# Vymyšlený text (ne skutečná píseň) na napodobené stránce.
PAGE = "<html><head><title>Moliannwn – geiriau</title></head><body><nav>Menu · Hafan · Cysylltu</nav><div class='lyrics'><p>Moliannwn oll yn llon<br>Mae'r gaeaf wedi mynd<br>Mae'r gwanwyn yn dod</p><p>A'r adar yn canu<br>Yn y coed gwyrdd</p></div><footer>(c) Jana</footer></body></html>"

def proxy(route):
    from urllib.parse import urlparse, parse_qs
    target = parse_qs(urlparse(route.request.url).query).get('url', [''])[0]
    if 'moliannwn' in target:
        return route.fulfill(body=PAGE, headers={'content-type': 'text/html; charset=utf-8', 'x-final-url': target, 'access-control-allow-origin': '*', 'access-control-expose-headers': 'x-final-url'})
    return route.fulfill(status=404, body='', headers={'access-control-allow-origin': '*'})

def main():
    files = [
        tone(TMP / '01 - Jana - Ar Lan y Môr.mp3', 12, {'title': 'Špatný název', 'artist': 'Špatný'}),
        tone(TMP / 'calon.mp3', 8, {'title': 'Calon Lân', 'artist': 'Rozárka'}),
        tone(TMP / 'Suo Gân.wav', 5, {'title': 'Suo Gân', 'artist': 'Sbor Jana'}),
        tone(TMP / 'Moliannwn.wav', 4),
    ]
    (TMP / 'poznamka.txt').write_text('není zvuk')
    srv = serve()
    url = f'http://127.0.0.1:{srv.server_address[1]}/'
    with sync_playwright() as p:
        browser = p.chromium.launch(args=['--autoplay-policy=no-user-gesture-required'])
        ctx = browser.new_context(**p.devices['Pixel 7'])
        page = ctx.new_page()
        page.on('console', lambda m: m.type == 'error' and errors.append(m.text))
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.on('dialog', lambda d: d.accept())
        page.route('https://lrclib.net/**', lrclib)
        page.route('https://alaw-test.workers.dev/**', proxy)
        page.add_init_script("if (!localStorage.getItem('alaw-prefs')) localStorage.setItem('alaw-prefs', JSON.stringify({ proxyUrl: 'https://alaw-test.workers.dev' }))")
        page.goto(url)
        page.wait_for_selector('text=Croeso!')

        print('Čisté funkce')
        r = page.evaluate("""async () => {
          const b = await import('./js/bulk.js');
          return {
            a: b.nameFromFile('03. Jana - Calon Lân.mp3'), b: b.nameFromFile('Pen-y-bont.wav'), c: b.nameFromFile('C:/x/Rozárka – Suo Gân.flac'),
            d: b.nameFromFile('12 Moliannwn.mp3'), e: b.pickName('song.mp3', { title: 'Calon Lân', artist: 'Jana' }),
            f: b.pickName('Jana - Ar Lan.mp3', { title: 'Jiné', artist: 'Jiný' }), g: b.pickName('Suo Gân.mp3', null),
            sure: b.isSure(b.rankLyrics([{ title: 'Calon Lân', artist: 'Jana', dur: 100 }], { title: 'Calon Lan', artist: '' }, 101)[0]),
            unsure: b.isSure(b.rankLyrics([{ title: 'Calon Lân', artist: 'Jana', dur: 160 }], { title: 'Calon Lan', artist: 'Jana' }, 101)[0]),
            noaudio: b.isSure(b.rankLyrics([{ title: 'Calon Lân', artist: 'Jana', dur: 160 }], { title: 'Calon Lan', artist: 'Jana' }, null)[0]),
          };
        }""")
        check(r['a'] == {'artist': 'Jana', 'title': 'Calon Lân'}, 'název souboru: číslo stopy pryč, interpret a název')
        check(r['b'] == {'artist': '', 'title': 'Pen-y-bont'}, 'spojovník uvnitř slova nedělí')
        check(r['c'] == {'artist': 'Rozárka', 'title': 'Suo Gân'}, 'pomlčka – a cesta ke složce')
        check(r['d'] == {'artist': '', 'title': 'Moliannwn'}, 'číslo stopy bez oddělovače')
        check(r['e']['from'] == 'tags' and r['e']['title'] == 'Calon Lân', 'bez interpreta v názvu souboru → údaje v souboru')
        check(r['f']['from'] == 'file' and r['f']['artist'] == 'Jana', 'název souboru s interpretem má přednost')
        check(r['g']['from'] == 'name' and r['g']['title'] == 'Suo Gân', 'bez údajů → název souboru')
        check(r['sure'] and not r['unsure'] and r['noaudio'], 'jistá shoda: délka ±3 s, bez nahrávky podle interpreta')
        r = page.evaluate("""async () => {
          const b = await import('./js/bulk.js');
          const txt = b.parseLinkFile('# odkazy od Clauda\\nRozárka - Moliannwn\\thttps://a.example/moliannwn\\nSuo Gân | https://b.example/x https://c.example/y\\nbez odkazu\\n');
          const js = b.parseLinkFile(JSON.stringify({ links: [{ artist: 'Jana', title: 'Calon Lân', url: 'https://d.example/' }, { title: 'X', url: 'ftp://nic' }] }));
          const songs = [{ id: 1, artist: 'Rozárka', title: 'Moliannwn' }, { id: 2, artist: 'Sbor Jana', title: 'Suo Gân' }, { id: 3, artist: 'Jiná', title: 'Calon Lân' }];
          const m = b.matchLinks([...txt, ...js, { artist: '', title: 'Neznámá', urls: ['https://e.example'] }], songs);
          return { txt, js, map: [...m.map.entries()], un: m.unmatched.map(l => l.title) };
        }""")
        check(r['txt'] == [{'artist': 'Rozárka', 'title': 'Moliannwn', 'urls': ['https://a.example/moliannwn']}, {'artist': '', 'title': 'Suo Gân', 'urls': ['https://b.example/x', 'https://c.example/y']}], 'soubor odkazů (text): název, interpret, víc odkazů, poznámky')
        check(r['js'] == [{'artist': 'Jana', 'title': 'Calon Lân', 'urls': ['https://d.example/']}], 'soubor odkazů (JSON), neplatné adresy pryč')
        check(r['map'] == [[1, ['https://a.example/moliannwn']], [2, ['https://b.example/x', 'https://c.example/y']], [3, ['https://d.example/']]] and r['un'] == ['Neznámá'], 'párování: interpret+název, jinak jednoznačný název')

        print('Přidání z nahrávek')
        page.click('a[href="#/bulk"]')
        page.wait_for_selector('text=Písně z nahrávek')
        with page.expect_file_chooser() as fc:
            page.click('text=♪ Vybrat nahrávky')
        check(fc.value.is_multiple(), 'výběr víc souborů najednou')
        fc.value.set_files([str(f) for f in files] + [str(TMP / 'poznamka.txt')])
        wait(page, "document.querySelectorAll('.bulk-row').length === 4")
        vals = page.evaluate("() => [...document.querySelectorAll('.bulk-row')].map(r => [...r.querySelectorAll('input:not([type=checkbox])')].map(i => i.value))")
        print('   ', vals)
        check(['Jana', 'Ar Lan y Môr'] in vals, 'mp3: interpret a název z názvu souboru (údaje v souboru přebije)')
        check(['Rozárka', 'Calon Lân'] in vals, 'mp3 bez interpreta v názvu: ID3')
        check(['Sbor Jana', 'Suo Gân'] in vals, 'wav: údaje INFO')
        check(['', 'Moliannwn'] in vals, 'wav bez údajů: jen název, interpret prázdný')
        check(page.locator('.bulk-row.noartist').count() == 1, 'řádek bez interpreta zvýrazněný')
        page.locator('.bulk-row.noartist input[aria-label="Interpret"]').fill('Rozárka')
        check(page.locator('.bulk-foot button.primary').inner_text() == 'Přidat 4 písně', 'tlačítko s počtem')
        shot(page, 'h1-vyber')
        page.click('.bulk-foot button.primary')
        page.wait_for_selector('text=Najít texty')
        n = page.evaluate("async () => (await (await import('./js/store.js')).listSongs()).map(s => [s.artist, s.title, !!s.versions[0].audio, s.versions[0].lines.length])")
        check(len(n) == 4 and all(x[2] and x[3] == 0 for x in n), '4 písně s nahrávkou, bez textu')
        check(['Rozárka', 'Moliannwn', True, 0] in n, 'ručně doplněný interpret uložen')

        print('Hledání textů')
        page.click('text=🔍 Hledat texty')
        wait(page, "document.body.textContent.includes('Hledat znovu nenalezené')", 20000)
        shot(page, 'h2-texty')
        check(page.locator('.bulk-cand.sure').count() == 1, 'jedna jistá shoda (Ar Lan y Môr, délka sedí)')
        check(page.locator('text=V LRCLIB nenalezeno').count() == 2, 'dvě nenalezené')
        check(page.locator('text=✓ Převzít všechny doporučené (1)').count() == 1, 'nabídka převzít jisté')
        page.click('text=✓ Převzít všechny doporučené (1)')
        wait(page, "document.body.textContent.includes('✓ Text uložen')")
        # nejistou (Calon Lân, délka nesedí) převzít ručně → bez časů
        page.locator('.bulk-row', has_text='Calon Lân').locator('text=Převzít').click()
        wait(page, "document.querySelectorAll('.ok').length === 2")
        s = page.evaluate("async () => Object.fromEntries((await (await import('./js/store.js')).listSongs()).map(s => [s.title, s.versions[0].lines.filter(l => l.start != null).length + '/' + s.versions[0].lines.length]))")
        print('   ', s)
        check(s['Ar Lan y Môr'] == '4/4', 'jistá shoda převzata i s časy')
        check(s['Calon Lân'] == '0/4', 'nesedí-li délka, text bez časů')

        print('Odkazy ze souboru')
        (TMP / 'odkazy.txt').write_text('Rozárka - Moliannwn\thttps://geiriau.example/moliannwn\nSuo Gân | https://geiriau.example/chybi\nNeznámá - Píseň | https://geiriau.example/x\n')
        with page.expect_file_chooser() as fc:
            page.click('text=📄 Načíst odkazy ze souboru')
        fc.value.set_files(str(TMP / 'odkazy.txt'))
        page.wait_for_selector('text=Odkazy: 2 písně spárováno, 1 bez shody')
        check(True, 'odkazy spárovány se dvěma písněmi bez textu, jeden bez shody')
        page.click('text=🔍 Hledat texty')
        wait(page, "document.body.textContent.includes('Hledat znovu nenalezené')", 20000)
        shot(page, 'h3-odkazy')
        row = page.locator('.bulk-row', has_text='Moliannwn')
        check(row.locator('text=🔗').count() == 1 and row.locator('text=5 veršů').count() == 1, 'text načtený z odkazu (5 veršů, bez menu a patičky)')
        check(page.locator('.bulk-row', has_text='Suo Gân').locator('text=/Z odkazu nic.*v LRCLIB nenalezeno/').count() == 1, 'nefunkční odkaz → hledá se dál v LRCLIB')
        page.click('text=✓ Převzít všechny doporučené (1)')
        wait(page, "document.querySelectorAll('.ok').length === 3")
        s = page.evaluate("async () => { const s = (await (await import('./js/store.js')).listSongs()).find(s => s.title === 'Moliannwn'); return [s.versions[0].lines.map(l => l.text), s.versions[0].sourceUrl]; }")
        check(s[0][0] == 'Moliannwn oll yn llon' and len(s[0]) == 5 and s[1] == 'https://geiriau.example/moliannwn', 'text z odkazu uložen i se zdrojem')

        print('Hledání: Google a vložení odkazu')
        page.locator('.bulk-row', has_text='Suo Gân').locator('text=🔍 Hledat jinde').click()
        page.wait_for_selector('text=🌐 Hledat na Googlu')
        href = page.get_attribute('a:has-text("Hledat na Googlu")', 'href')
        check(href.startswith('https://www.google.com/search?q=') and 'geiriau' in href and 'Suo' in href, 'odkaz na Google s názvem a „geiriau“')
        page.evaluate("document.querySelector('a[href^=\"https://www.google.com\"]').addEventListener('click', e => e.preventDefault())")
        page.click('text=🌐 Hledat na Googlu')
        t = page.evaluate("JSON.parse(localStorage.getItem('alaw-prefs')).shareTarget")
        check(t and t['title'] == 'Suo Gân', 'zapamatováno, ke které písni se text hledá')
        page.click('text=🔗 Vložit odkaz')
        page.fill('input[type=url]', 'https://geiriau.example/moliannwn')
        page.click('.sheet button[type=submit]')
        page.click('text=Použít tento text')
        wait(page, "document.querySelectorAll('.ok').length === 4")
        check(True, 'vložený odkaz uložen k písni')

        print('Sdílení z prohlížeče k hledané písni')
        page.evaluate("async () => { const st = await import('./js/store.js'); const s = (await st.listSongs()).find(s => s.title === 'Suo Gân'); s.versions[0].lines = []; await st.saveSong(s); st.setPrefs({ shareTarget: { id: s.id, title: s.title, t: Date.now() } }); }")
        page.goto(url + '?share-url=' + 'https%3A%2F%2Fgeiriau.example%2Fmoliannwn')
        page.wait_for_selector('text=Kam s textem?')
        page.click('text=K písni „Suo Gân“')
        page.click('text=Použít tento text')
        page.wait_for_selector('text=Moliannwn oll yn llon')
        check('#/song/' in page.url, 'sdílená stránka uložena k písni, otevřela se píseň')
        page.evaluate("async () => { const st = await import('./js/store.js'); const s = (await st.listSongs()).find(s => s.title === 'Suo Gân'); s.versions[0].lines = []; await st.saveSong(s); }")

        print('Knihovna a prázdná píseň')
        page.goto(url + '#/')
        page.wait_for_selector('text=1 píseň nemá text – najít texty')
        check(True, 'proužek „písně nemají text“')
        page.click('text=Suo Gân')
        page.wait_for_selector('text=Píseň zatím nemá text.')
        check(page.locator('text=🔍 Najít text').count() == 1, 'u písně bez textu tlačítko Najít text')

        print('Nastavení')
        page.goto(url + '#/settings')
        page.wait_for_selector('text=Záloha a import')
        check(page.locator('text=♪ Přidat písně z nahrávek').count() == 1, 'v Nastavení odkaz na přidání z nahrávek')
        page.goto(url + '#/new')
        page.wait_for_selector('text=Nová píseň')
        check(page.locator('text=Přidej písně z nahrávek najednou').count() == 1, 've formuláři nové písně odkaz')
        browser.close()
    real = [e for e in errors if 'favicon' not in e and '404 (Not Found)' not in e]  # 404 = schválně nefunkční odkaz
    check(not real, f'bez chyb v konzoli {real}')
    print('HOTOVO')

if __name__ == '__main__':
    main()
