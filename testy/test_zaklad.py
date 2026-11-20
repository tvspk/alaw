# Základní test aplikace v mobilním Chromiu (Playwright): přidání písně, zvuk, režimy učení, smyčka,
# úprava verše, časování ťukáním, učení (lekce, mapa, psaní), záloha a import. Spuštění: python3 testy/test_zaklad.py [složka_pro_snímky]
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
        ctx = browser.new_context(**p.devices['Pixel 7'], locale='cs-CZ', accept_downloads=True)
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

        print('Učení: výpočty (learn.js)')
        r = page.evaluate("""async () => {
          const L = await import('./js/learn.js');
          const c = (a, b) => { const x = L.compareTyped(a, b); return [x.errors, x.typos, x.suggest]; };
          let rec = L.introduce(L.freshRec('s', 'k'), 0);
          const steps = [];
          for (const g of [3, 3, 3, 3, 1]) { rec = L.grade(rec, g, 0); steps.push([rec.st, rec.step, rec.ivl, rec.lapses]); }
          const song = { versions: [{ id: 'v', lines: ['Refrén tady', 'Sloka', 'refren, tady!'].map((text, i) => ({ id: 'l' + i, text })) }], primary: 'v' };
          return {
            same: c("Ar lan y môr mae rhosys cochion", "ar lan y mor mae rhosys cochion"),
            typo: c("Ar lan y môr mae rhosys cochion", "Ar lan y mor mae rosys cochion"),
            miss: c("Ar lan y môr mae rhosys cochion", "Ar lan y mor rhosys cochion"),
            bad: c("Ar lan y môr mae rhosys cochion", "Ar lan y mor mae lilis gwynion"),
            empty: c("Ar lan y môr", ""),
            steps,
            units: L.songUnits(song).map(u => u.lines),
            order: [1, 2, 7, 30].map(ivl => [2, 3, 4].map(g => L.grade({ ...L.freshRec('s', 'k'), st: 'review', ivl, ease: 1.3 }, g, 0).ivl)),
            norm: L.normalizeRec({ s: 'x', k: 'y', st: 'hack', due: 'a', ease: 99 }),
          };
        }""")
        check(r['same'] == [0, 0, 3], 'psaní: stříšky, velikost písmen nevadí')
        check(r['typo'] == [0, 1, 3], 'psaní: drobný překlep uznán (označen)')
        check(r['miss'] == [1, 0, 2] and r['bad'][0] == 2 and r['empty'] == [4, 0, 1], 'psaní: chybějící a špatná slova, návrh hodnocení')
        check([x[0] for x in r['steps']] == ['learn', 'review', 'review', 'review', 'learn'] and r['steps'][2][2] == 3 and r['steps'][3][2] == 8
              and r['steps'][4][3] == 1, f'opakování v intervalech: {r["steps"]}')
        check(all(a <= b < c for a, b, c in r['order']), f'Těžké ≤ Dobře < Snadno: {r["order"]}')
        check(r['units'] == [[0, 2], [1]], 'refrén (stejný text) sdílí pokrok')
        check(r['norm']['st'] == 'new' and r['norm']['ease'] == 5 and r['norm']['due'] == 0, 'cizí záznam pokroku se ošetří')

        print('Učení: lekce')
        page.evaluate("() => { const p = JSON.parse(localStorage.getItem('alaw-prefs') || '{}'); p.newPerDay = 2; p.exOff = Object.fromEntries(['choiceWord', 'scramble', 'flash', 'choice3', 'fromCz', 'before', 'dictation'].map(k => [k, true])); localStorage.setItem('alaw-prefs', JSON.stringify(p)); }")
        page.reload()
        page.wait_for_selector('.learn-box')
        check('5 veršů k naučení' in page.inner_text('.learn-box'), 'souhrn: 5 veršů k naučení')
        page.click('.learn-box button:has-text("Učit se")')
        page.wait_for_selector('.lcard')
        def card():
            return page.inner_text('.lcard .lex'), page.locator('.lcard .ltext').first.inner_text()
        def want(lex, sub=''):   # karta se po ťuknutí překreslí až po uložení (async), proto čekat
            end = time.time() + 5
            while time.time() < end:
                try:
                    c = card()
                    if c[0] == lex and sub in c[1]: return True
                except Exception: pass
                page.wait_for_timeout(100)
            raise AssertionError(f'čekal jsem kartu {lex!r} {sub!r}, je {card()!r}')
        check(want('Nový verš', 'rhosys'), 'nový verš 1')
        check('Začátek písně' in page.text_content('.lprev'), 'u prvního verše je „Začátek písně“')
        shot(page, '06a-novy-vers')
        page.click('.lcard button:has-text("Dál")')
        check(want('Nový verš', 'lilis'), 'nový verš 2 (po dvojicích)')
        check('rhosys' in page.inner_text('.lprev'), 'předchozí verš jako nápověda')
        page.click('.lcard button:has-text("Dál")')
        check(want('Podle prvních písmen', 'rhosys'), 'verš 1: první písmena')
        page.click('.lcard button:has-text("Odkrýt")')
        page.wait_for_selector('.grades')
        check(page.locator('.grade').count() == 4 and '10 min' in page.inner_text('.grade.g3'), 'hodnocení 1–4 s náhledem intervalu')
        shot(page, '06b-hodnoceni')
        page.click('.grade.g3')
        check(want('Podle prvních písmen', 'lilis'), 'verš 2: první písmena')
        page.click('.lcard button:has-text("Odkrýt")')
        page.click('.grade.g4')
        check(want('Jak verš zní?'), 'verš 1: vybav si verš')
        check(page.locator('.lcard .lq').count() == 1, 'verš skrytý')
        page.click('.lcard button:has-text("První písmena")')
        check(page.locator('.lcard .w.hide .first').count() == 7, 'nápověda: první písmena')
        page.click('.lcard button:has-text("Odkrýt")')
        page.click('.grade.g3')
        page.wait_for_selector('.ldone')
        check('Umíš 2 z 5' in page.inner_text('.ldone'), f'konec lekce: {page.inner_text(".ldone")!r}')
        check(page.locator('.ldone button:has-text("Naučit se další")').count() == 1, 'nabídka dalších nových veršů')
        shot(page, '06c-hotovo')
        page.click('.ldone button:has-text("Zpět k písni")')
        page.wait_for_selector('.learn-box')
        check('Umíš 2 z 5' in page.inner_text('.learn-box'), 'souhrn v písni se aktualizoval')

        print('Učení: mapa písně a psaní zpaměti')
        page.click('.seg button:has-text("Mapa")')
        page.wait_for_selector('.lyric.mapped')
        check(page.locator('.lyric.m-known').count() == 2 and page.locator('.lyric.m-new').count() == 3, 'mapa: 2 umím, 3 nové')
        check('opakování za' in page.locator('.lyric.m-known .mstate').first.inner_text(), 'mapa ukazuje, kdy je další opakování')
        shot(page, '06d-mapa')
        page.locator('.lyric .text').first.click()
        page.wait_for_selector('.lcard')
        check(want('Jak verš zní?'), 'ťuknutí v mapě = procvičit verš')
        page.click('.tools .chip:has-text("Vždy psát")')
        page.wait_for_selector('.ltype')
        page.fill('.ltype', 'ar lan y mor mae rosys cochion')
        page.press('.ltype', 'Enter')
        page.wait_for_selector('.lverdict')
        check('drobným překlepem' in page.inner_text('.lverdict'), 'psaní zpaměti: uznáno s překlepem')
        check(page.locator('.diff .x-typo').count() == 1 and page.locator('.grade.sug.g3').count() == 1, 'překlep označen, navrženo „Dobře“')
        shot(page, '06e-psani')
        page.click('.grade.g3')
        page.wait_for_selector('.ldone')
        page.click('.tools .chip:has-text("Vždy psát")')
        page.click('.ldone button:has-text("Zpět k písni")')
        page.wait_for_selector('.lyric.mapped')
        page.click('.seg button:has-text("Číst")')

        print('Učení: další cvičení na verš')
        sid, k1 = page.evaluate("""async () => { const S = await import('./js/store.js'); const L = await import('./js/learn.js');
          const s = (await S.listSongs()).find(x => x.title === 'Ar Lan y Môr'); return [s.id, L.songUnits(s)[0].k]; }""")
        L1 = 'Ar lan y môr mae rhosys cochion'
        def drill_ex(ex):
            page.evaluate("""([ex, h]) => { window.__alawForceEx = ex; window.__alawFlashMs = 400;
              history.pushState({ d: 1 }, '', h); dispatchEvent(new PopStateEvent('popstate')); }""", [ex, f'#/learn/{sid}/{k1}'])
            page.wait_for_selector('.lcard .lex')
        def grade_done():
            page.click('.grade.g3')
            page.wait_for_selector('.ldone')
        drill_ex('choiceWord')
        check(page.inner_text('.lcard .lex') == 'Doplň slovo' and page.locator('.choice').count() == 4 and page.locator('.blank').count() == 1, 'doplň slovo: 4 možnosti')
        opts = page.locator('.choice').all_inner_texts()
        right = [o for o in opts if o in L1.split()]
        check(len(right) == 1, f'jen jedna možnost je z verše: {opts}')
        shot(page, '06f-dopln-slovo')
        page.click(f'.choice:text-is("{right[0]}")')
        check('Správně' in page.inner_text('.lverdict') and page.locator('.grade.sug.g3').count() == 1, 'správná volba → návrh „Dobře“')
        grade_done()
        drill_ex('scramble')
        check(page.locator('.sc-pool .sc-word').count() == 7, 'skládání: 7 rozházených slov')
        shot(page, '06g-skladani')
        page.click(f'.sc-pool .sc-word:text-is("cochion")')
        page.click('.sc-placed .sc-word:text-is("cochion")')
        check(page.locator('.sc-pool .sc-word').count() == 7, 'ťuknutí na poskládané slovo ho vrátí')
        for w in L1.split():
            page.click(f'.sc-pool .sc-word:text-is("{w}")')
        page.wait_for_selector('.lverdict')
        check('Správně' in page.inner_text('.lverdict'), 'skládání: správně poskládáno')
        grade_done()
        drill_ex('flash')
        check(page.locator('.lcard .ltext').first.inner_text() == L1, 'bliknutí: verš je chvíli vidět')
        page.wait_for_selector('.lcard .lq')
        page.click('.lcard button:has-text("Odkrýt")')
        grade_done()
        check(True, 'bliknutí: verš zmizel, odkrytí a hodnocení')
        drill_ex('choice3')
        check(page.locator('.choice').count() == 3, 'výběr ze tří')
        page.click(f'.choice:text-is("{L1}")')
        check('Správně' in page.inner_text('.lverdict'), 'výběr ze tří: správně')
        grade_done()
        drill_ex('fromCz')
        check('rudé růže' in page.inner_text('.lprev-text.cz'), 'z češtiny: vidím překlad')
        page.click('.lcard button:has-text("Odkrýt")')
        check(L1 in page.inner_text('.ltarget'), 'z češtiny: odkryje velšský verš')
        grade_done()
        drill_ex('before')
        check('lilis' in page.inner_text('.lprev-text'), 'napřeskáčku: vidím verš za ním')
        page.click('.lcard button:has-text("Odkrýt")')
        check(L1 in page.inner_text('.ltarget'), 'napřeskáčku: odkryje verš před ním')
        grade_done()
        drill_ex('dictation')
        check(page.locator('.lcard button:has-text("Přehrát verš")').count() == 1, 'diktát: přehrát verš')
        page.fill('.ltype', L1)
        page.press('.ltype', 'Enter')
        check('Výborně' in page.inner_text('.lverdict'), 'diktát: správně napsáno')
        grade_done()
        page.evaluate("() => { window.__alawForceEx = null; }")
        r = page.evaluate("""async () => { const L = await import('./js/learn.js');
          const ctx = { words: 5, others: 9, units: 5, hasTr: false, hasNext: true, timed: false };
          const rec = { st: 'review', ivl: 4, step: 0 }, seen = new Set();
          for (let i = 0; i < 200; i++) seen.add(L.pickExercise(rec, ctx, { off: { before: true } }));
          const seenT = new Set();
          for (let i = 0; i < 200; i++) seenT.add(L.pickExercise(rec, { ...ctx, timed: true, hasTr: true }));
          return [[...seen].sort(), [...seenT].sort(), L.pickExercise({ st: 'learn', step: 0 }, ctx, { off: { initials: true, choiceWord: true, scramble: true } })]; }""")
        check(r[0] == ['choice3', 'recall'], f'bez časů a překladu jen cvičení, která je nepotřebují; vypnuté se nenabízí: {r[0]}')
        check(r[1] == ['before', 'choice3', 'dictation', 'fromCz', 'recall'], f's časy a překladem i diktát a z češtiny: {r[1]}')
        check(r[2] == 'recall', 'když je všechno vypnuté, zůstane „Jak verš zní?“')

        print('Procvičování celé písně')
        page.goto(url + f'#/song/{sid}')
        page.wait_for_selector('.learn-box')
        def open_drill(name):
            page.goto(url + f'#/song/{sid}')
            page.wait_for_selector('.learn-box')
            page.click('.learn-box button:has-text("Procvičit")')
            page.click(f'.sheet .menu button:has-text("{name}")')
            page.wait_for_selector('.drill')
        open_drill('Skládání sloky')
        check(page.locator('.drill .chips .chip').count() == 2, 'skládání sloky: výběr ze 2 slok')
        page.click('.ord-pool .ord-line:has-text("rhosys")')
        page.click('.ord-pool .ord-line:has-text("lilis")')
        page.wait_for_selector('.lverdict')
        check('Správně' in page.inner_text('.lverdict'), 'sloka poskládána správně')
        shot(page, '06h-skladani-sloky')
        page.click('button:has-text("Další sloka")')
        check(page.locator('.ord-pool .ord-line').count() == 3, 'další sloka: 3 verše')
        open_drill('Rozmazávání')
        check(page.locator('.blur-line').count() == 2, 'rozmazávání: sloka 1')
        page.click('button:has-text("Další kolo")')
        check(page.evaluate("getComputedStyle(document.querySelector('.blur-text')).getPropertyValue('--blur').trim()") == '1.2px', 'kolo 2: text rozmazaný')
        for _ in range(5): page.click('button:has-text("Další kolo")')
        check(page.locator('.blur-line .lq').count() == 2 and 'bez textu' in page.inner_text('.blur-round'), 'nakonec text zmizí')
        shot(page, '06i-rozmazani')
        open_drill('Tahák pro zpěv')
        check(page.locator('.cheat .text', has_text='…').count() == 5, 'tahák: jen první slovo každého verše')
        page.locator('.cheat .lyric').first.click()
        check(page.locator('.cheat .text').first.inner_text() == L1, 'ťuknutí ukáže celý verš')
        page.click('.chip:has-text("První písmena")')
        check(page.locator('.cheat .w.hide .first').count() > 10, 'tahák: první písmena')
        open_drill('Zkouška celé písně')
        for ok in [True, True, False, True, True]:
            page.click('.lcard button:has-text("Odkrýt")')
            page.click('.lcard button:has-text("' + ('✓' if ok else '✗') + '")')
        page.wait_for_selector('.ldone')
        check('Umíš 4 z 5' in page.inner_text('.ldone') and '1 verš se vrátí' in page.inner_text('.ldone'), 'zkouška: výsledek')
        shot(page, '06j-zkouska')
        st = page.evaluate("""async (sid) => { const S = await import('./js/store.js'); return [...(await S.getProgress(sid)).values()].map(r => r.st).sort(); }""", sid)
        check(st == ['learn', 'review', 'review'], f'nevěděný verš je zpátky v učení, známé beze změny: {st}')
        page.goto(url + f'#/song/{sid}')
        page.wait_for_selector('.learn-box')

        print('Knihovna a hledání')
        page.click('[aria-label="Zpět"]')
        page.wait_for_selector('.song-card')
        check(page.locator('.song-card .badge').count() == 2, 'odznaky ⏱ a ♪')
        check(page.locator('.song-card .lbar .known').count() == 1, 'proužek pokroku na kartě písně')
        shot(page, '07-knihovna')

        print('Import JSON (Lyrics Trainer)')
        page.click('[aria-label="Nastavení"]')
        with page.expect_file_chooser() as fc:
            page.click('text=Načíst soubor')
        fc.value.set_files(str(TMP / 'gemini.json'))
        page.wait_for_selector('text=Načteno: 1 nových')
        shot(page, '08-nastaveni')

        print('Záloha se zvukem a obnova v novém zařízení')
        page.check('label:has-text("Přiložit i zvukové soubory") input')
        with page.expect_download() as dl:
            page.click('text=Stáhnout zálohu')
        backup = TMP / 'zaloha.json'
        dl.value.save_as(backup)
        data = json.loads(backup.read_text())
        check(data['app'] == 'alaw' and len(data['songs']) == 2 and len(data['audio']) == 1, 'záloha: 2 písně, 1 nahrávka')
        check(len([r for r in data['progress'] if r['st'] == 'review']) == 2, 'záloha obsahuje pokrok učení')

        ctx2 = browser.new_context(**p.devices['Pixel 7'], locale='cs-CZ')
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
        check('Umíš 2 z 5' in page2.inner_text('.learn-box'), 'pokrok obnoven ze zálohy')

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
