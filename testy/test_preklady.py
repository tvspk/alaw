# Test překladů ve dvou jazycích (0.11) a stahování textu (Playwright, mobilní Chromium, bez sítě; Gemini napodobené):
#  český překlad v polích verše, anglický v line.en, přepínač CZ/EN u překladu, „Přeložit i do angličtiny“ (Nastavení),
#  přeložit znovu jen jeden jazyk, překlad ze zdroje jako záloha anglického, úprava verše v obou jazycích, normalizeSong,
#  učení (nápověda v jazyce rozhraní) a export: .lrc, text bez časů, překlad, text s překladem pod veršem.
# Spuštění: python3 -u testy/test_preklady.py [složka_pro_snímky]
import json, sys
from pathlib import Path
from playwright.sync_api import sync_playwright
from test_zaklad import serve, wait, check

SHOTS = Path(sys.argv[1]) if len(sys.argv) > 1 else None
errors = []
calls = {'cs': 0, 'en': 0}

# Tradiční lidová píseň (volné dílo).
LRC = """[00:01.00]Ar lan y môr mae rhosys cochion
[00:04.00]Ar lan y môr mae lilis gwynion

[00:07.00]Ar lan y môr mae 'nghariad inne
[00:10.00]Yn cysgu'r nos a chodi'r bore"""
LINES = [l.split(']', 1)[1] for l in LRC.split('\n') if l]

def gemini(route):
    req = route.request
    if req.method == 'GET':
        return route.fulfill(json={'models': [{'name': 'models/gemini-3-flash', 'supportedGenerationMethods': ['generateContent']}]})
    body = json.loads(req.post_data)
    en = 'British English' in body['systemInstruction']['parts'][0]['text']
    calls['en' if en else 'cs'] += 1
    payload = json.loads(body['contents'][0]['parts'][0]['text'])
    lines = [{'id': l['id'], 'translation': f"{'EN' if en else 'CZ'} {i + 1}", 'literal': f"{'lit' if en else 'dosl'} {i + 1}",
              'contractions': [{'short': "'nghariad", 'full': 'fy nghariad', 'note': 'my love' if en else 'můj milý'}] if "'nghariad" in l['original'] else []}
             for i, l in enumerate(payload['lines'])]
    return route.fulfill(json={'candidates': [{'content': {'parts': [{'text': json.dumps({'lines': lines})}]}, 'finishReason': 'STOP'}]})

def shot(page, name):
    if SHOTS:
        SHOTS.mkdir(parents=True, exist_ok=True)
        page.screenshot(path=str(SHOTS / f'{name}.png'))

def download(page, label):
    page.click('.topbar .icon-btn >> nth=-1')
    page.click('.sheet .menu button:has-text("Stáhnout text…")')
    page.wait_for_selector('.sheet h3:has-text("Stáhnout text")')
    with page.expect_download() as d:
        page.click(f'.sheet .menu button:has-text("{label}")')
    dl = d.value
    return dl.suggested_filename, Path(dl.path()).read_text(encoding='utf-8')

def main():
    srv = serve()
    url = f'http://127.0.0.1:{srv.server_address[1]}/'
    with sync_playwright() as p:
        browser = p.chromium.launch()
        ctx = browser.new_context(**p.devices['Pixel 7'], locale='cs-CZ', accept_downloads=True)
        page = ctx.new_page()
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.on('console', lambda m: m.type == 'error' and errors.append(m.text))
        page.on('dialog', lambda d: d.accept())
        page.route('https://generativelanguage.googleapis.com/**', gemini)
        page.add_init_script("""if (!localStorage.getItem('alaw-ai')) localStorage.setItem('alaw-ai', JSON.stringify({ key: 'zkusebni-klic', model: 'gemini-3-flash', models: ['gemini-3-flash'] }));""")
        page.goto(url)
        page.wait_for_selector('text=Croeso!')

        print('Formát dat')
        r = page.evaluate("""async () => {
          const m = await import('./js/model.js');
          const s = m.newSong({ title: 'X', lines: m.parseLyrics('a\\nb') });
          s.versions[0].lines[0].en = { translation: 'A', literal: '', contractions: [{ short: 'x', full: 'y', note: 'z' }] };
          s.versions[0].lines[1].en = { translation: '', literal: '', contractions: [] };
          const n = m.normalizeSong(JSON.parse(JSON.stringify(s)));
          const l = n.versions[0].lines;
          const line = m.newLine('c'); line.alt = 'source';
          return { en0: l[0].en, en1: 'en' in l[1], alt: m.trText(line, 'en'), cs: m.trText(line, 'cs'),
                   langs: m.trLangs(n.versions[0]), any: m.anyTr(l[0], 'cs') };
        }""")
        check(r['en0'] == {'translation': 'A', 'literal': '', 'contractions': [{'short': 'x', 'full': 'y', 'note': 'z'}]}, 'anglický překlad projde normalizeSong')
        check(not r['en1'], 'prázdný anglický překlad se neukládá')
        check(r['alt'] == {'text': 'source', 'src': True} and r['cs'] is None, 'překlad ze zdroje = záloha anglického (označený)')
        check(r['langs'] == ['en'] and r['any'] == 'A', 'jazyky překladu verze, záloha z druhého jazyka')

        print('Nová píseň a český překlad (AI)')
        page.click('.fab')
        page.fill('input[placeholder="Calon Lân"]', 'Ar Lan y Môr')
        page.fill('input[placeholder="Interpret (nepovinné)"]', 'Lidová')
        page.fill('textarea', LRC)
        page.click('button[type=submit]')
        page.wait_for_selector('.lyric')
        page.click('.topbar .icon-btn >> nth=-1')
        check(page.locator('.sheet .menu button:has-text("Přeložit i do angličtiny")').count() == 0, 'bez volby v Nastavení se druhý jazyk nenabízí')
        page.click('.sheet .menu button:has-text("Přeložit pomocí AI")')
        page.wait_for_selector('.lyric .tr:has-text("CZ 1")')
        check(calls == {'cs': 1, 'en': 0}, 'v českém rozhraní český překlad')
        check(page.locator('.tr-switch').count() == 0, 'jeden jazyk překladu → bez přepínače CZ/EN')

        print('Nastavení: nabízet i angličtinu')
        page.goto(url + '#/settings')
        page.click('text=Nabízet v nabídce písně i překlad do angličtiny')
        check(page.evaluate("() => JSON.parse(localStorage.getItem('alaw-prefs')).trBoth") is True, 'volba uložena')
        page.go_back(); page.wait_for_selector('.lyric')
        page.click('.topbar .icon-btn >> nth=-1')
        page.click('.sheet .menu button:has-text("Přeložit i do angličtiny (AI)")')
        page.wait_for_selector('.tr-switch')
        check(calls == {'cs': 1, 'en': 1}, 'anglický překlad přes anglický prompt')
        check(page.locator('.lyric .tr').first.inner_text() == 'EN 1', 'po překladu se ukáže anglický')
        check(page.locator('.tr-switch button.on').inner_text() == 'EN', 'přepínač ukazuje EN')
        shot(page, 'p1-en')
        page.click('.tr-switch button:has-text("CZ")')
        check(page.locator('.lyric .tr').first.inner_text() == 'CZ 1', 'přepnutí na český překlad')
        page.click('.tools .chip:has-text("Doslovně")')
        check(page.locator('.lyric .lit').first.inner_text() == 'dosl 1', 'doslovný překlad v jazyce přepínače')
        page.click('.tr-switch button:has-text("EN")')
        check(page.locator('.lyric .lit').first.inner_text() == 'lit 1', 'doslovný anglicky')
        check("my love" in page.locator('.lyric .contr span').first.get_attribute('title'), 'poznámka ke zkratce anglicky')
        page.reload(); page.wait_for_selector('.tr-switch')
        check(page.locator('.tr-switch button.on').inner_text() == 'EN', 'volba jazyka překladu vydrží')

        sid = page.evaluate("() => location.hash.split('/')[2]")
        data = page.evaluate(f"async () => (await (await import('./js/store.js')).getSong('{sid}')).versions[0].lines[2]")
        check(data['translation'] == 'CZ 3' and data['en']['translation'] == 'EN 3', 'český v polích verše, anglický v line.en')
        check(data['contractions'][0]['note'] == 'můj milý' and data['en']['contractions'][0]['note'] == 'my love', 'zkratky v obou jazycích')

        print('Přeložit znovu jen jeden jazyk')
        page.click('.topbar .icon-btn >> nth=-1')
        check(page.locator('.sheet .menu button:has-text("Přeložit znovu do angličtiny (AI)")').count() == 1, 'celý anglický → „Přeložit znovu do angličtiny“')
        page.click('.sheet .menu button:has-text("Přeložit celou píseň znovu (AI)")')
        page.wait_for_timeout(800)
        check(calls == {'cs': 2, 'en': 1}, 'přeložit znovu = jen český (jazyk rozhraní)')
        data = page.evaluate(f"async () => (await (await import('./js/store.js')).getSong('{sid}')).versions[0].lines[0]")
        check(data['en']['translation'] == 'EN 1', 'anglický překlad zůstal')

        print('Úprava verše v obou jazycích')
        page.click('.lyric .more >> nth=0')
        page.click('.sheet .menu button:has-text("Upravit verš")')
        page.wait_for_selector('.sheet .form')
        labels = page.locator('.sheet .form .field > span').all_inner_texts()
        check('Překlad – čeština' in labels and 'Překlad – angličtina' in labels and 'Zkratky a hovorové tvary – angličtina' in labels, 'pole pro oba jazyky')
        page.locator('.sheet .form .field:has-text("Překlad – angličtina") textarea').fill('By the sea, red roses')
        page.click('.sheet button:has-text("Uložit")')
        page.wait_for_selector('.sheet', state='detached')
        check(page.locator('.lyric .tr').first.inner_text() == 'CZ 1', 'po „přeložit znovu“ česky se ukazuje český překlad')
        page.click('.tr-switch button:has-text("EN")')
        page.wait_for_selector('.lyric .tr:has-text("By the sea, red roses")')
        data = page.evaluate(f"async () => (await (await import('./js/store.js')).getSong('{sid}')).versions[0].lines[0]")
        check(data['en']['translation'] == 'By the sea, red roses' and data['translation'] == 'CZ 1', 'uloží se jen změněný jazyk')

        print('Stahování textu')
        name, txt = download(page, 'Text s časy (.lrc)')
        check(name.endswith('.lrc') and '[00:01.00]Ar lan y môr mae rhosys cochion' in txt, 'text s časy (.lrc)')
        name, txt = download(page, 'Text bez časů (.txt)')
        check(name == 'lidova-ar-lan-y-mor.txt', f'název souboru ({name})')
        check(txt == 'Ar Lan y Môr – Lidová\n\n' + '\n'.join(LINES[:2]) + '\n\n' + '\n'.join(LINES[2:]) + '\n', 'text bez časů, sloky oddělené')
        name, txt = download(page, 'Překlad – čeština (.txt)')
        check(name.endswith('-cs.txt') and txt == 'Ar Lan y Môr – Lidová\n\nCZ 1\nCZ 2\n\nCZ 3\nCZ 4\n', 'jen český překlad')
        name, txt = download(page, 'Překlad – angličtina (.txt)')
        check(name.endswith('-en.txt') and txt.splitlines()[2] == 'By the sea, red roses', 'jen anglický překlad')
        name, txt = download(page, 'Text a pod veršem překlad – čeština (.txt)')
        check(name.endswith('-cy-cs.txt'), f'název souboru textu s překladem ({name})')
        check(txt == ('Ar Lan y Môr – Lidová\n\n' + f'{LINES[0]}\nCZ 1\n\n{LINES[1]}\nCZ 2\n\n\n{LINES[2]}\nCZ 3\n\n{LINES[3]}\nCZ 4\n'), 'verš a pod ním překlad')

        print('Učení: překlad v jazyce rozhraní')
        page.goto(url + '#/'); page.wait_for_selector('.song-card')
        page.evaluate("() => { window.__alawForceEx = null; }")
        page.goto(url + f'#/learn/{sid}'); page.wait_for_selector('.lcard')
        check(page.locator('.lcard .tr').first.inner_text() == 'CZ 1', 'úvodní karta: český překlad v českém rozhraní')

        print('Překlad ze zdroje bez vlastního anglického')
        page.evaluate("""async () => {
          const m = await import('./js/model.js'), st = await import('./js/store.js');
          const s = m.newSong({ title: 'Zdroj', lines: m.parseLyrics('un\\ndau') });
          s.versions[0].lines.forEach((l, i) => { l.alt = 'source ' + i; l.translation = 'cz ' + i; });
          await st.saveSong(s); location.hash = '#/song/' + s.id;
        }""")
        page.wait_for_selector('.tr-switch')
        page.click('.tr-switch button:has-text("EN")')
        check(page.locator('.lyric .alt').first.inner_text() == 'source 0' and page.locator('.lyric .tr').count() == 0, 'EN: překlad ze zdroje místo chybějícího (označený 🌐)')
        check(page.locator('.tools .chip:has-text("Ze zdroje")').count() == 0, 'EN: bez druhého tlačítka „Ze zdroje“')
        page.click('.tr-switch button:has-text("CZ")')
        check(page.locator('.tools .chip:has-text("Ze zdroje")').count() == 1, 'CZ: „Ze zdroje“ zůstává')

        browser.close()
    srv.shutdown()
    real = [e for e in errors if 'favicon' not in e]
    if real:
        raise AssertionError('Chyby: ' + ' | '.join(real))
    print('\nPřeklady: všechny testy prošly.')

if __name__ == '__main__':
    main()
