# Test přepisu textu z nahrávky (Gemini napodobené přes page.route), výměny hlavní verze a hromadného mazání písní.
# Spuštění: python3 -u testy/test_prepis.py [složka_pro_snímky]
import json, subprocess, tempfile
from pathlib import Path
from playwright.sync_api import sync_playwright
from test_zaklad import serve, wait, check, shot, errors

TMP = Path(tempfile.mkdtemp())

# Vymyšlené verše (ne skutečná píseň).
LINES = ["Mae'r haul yn codi dros y bryn", "A'r gwynt yn chwythu'n ysgafn", "Dewch i ganu gyda ni", "Yn llon ar fore braf"]
calls = {'gen': 0, 'upload': 0, 'delete': 0, 'parts': [], 'upload_rate': None, 'groq': []}

def tone(path, seconds):
    subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', f'sine=frequency=330:duration={seconds}', '-ac', '1', '-ar', '22050', str(path)], check=True)
    return path

def answer(lines, finish='STOP'):
    return {'candidates': [{'content': {'parts': [{'text': json.dumps({'lines': lines})}]}, 'finishReason': finish}]}

def gemini(route):
    req = route.request
    u = req.url
    if '/upload/' in u:
        calls['upload'] += 1
        body = req.post_data_buffer or b''
        assert b'multipart' in req.headers.get('content-type', '').encode() and b'"display_name"' in body and b'RIFF' in body, 'multipart nahrání'
        i = body.index(b'RIFF')
        calls['upload_rate'] = int.from_bytes(body[i + 24:i + 28], 'little')
        return route.fulfill(json={'file': {'name': 'files/abc123', 'uri': 'https://generativelanguage.googleapis.com/v1beta/files/abc123', 'mimeType': 'audio/wav', 'state': 'PROCESSING'}})
    if u.endswith('/files/abc123') and req.method == 'GET':
        return route.fulfill(json={'name': 'files/abc123', 'uri': 'https://generativelanguage.googleapis.com/v1beta/files/abc123', 'mimeType': 'audio/wav', 'state': 'ACTIVE'})
    if req.method == 'DELETE':
        calls['delete'] += 1
        return route.fulfill(json={})
    if ':generateContent' in u:
        calls['gen'] += 1
        b = json.loads(req.post_data)
        parts = b['contents'][0]['parts']
        meta = json.loads(parts[-1]['text'])
        kind = 'file' if 'file_data' in parts[0] else 'inline' if 'inline_data' in parts[0] else '?'
        calls['parts'].append((meta['title'], kind))
        if meta['title'] == 'Cân Tri':
            return route.fulfill(json=answer([], 'RECITATION'))
        if meta['title'] == 'Cân Un' and sum(1 for t, _ in calls['parts'] if t == 'Cân Un') > 1:
            # druhý přepis: jedno slovo jinak (sporné místo) a bez časů u jednoho verše → bez časů vůbec
            return route.fulfill(json=answer([{'start': 1.0, 'text': LINES[0]}, {'start': 4.0, 'text': "A'r gwynt yn chwythu'n gryf"}, {'start': 7, 'text': LINES[2]}, {'start': 10, 'text': LINES[3]}]))
        return route.fulfill(json=answer([{'start': 1.0 + 3 * i, 'text': t, 'new_stanza': i == 2} for i, t in enumerate(LINES)] + [{'start': 20, 'text': '…'}]))
    return route.fulfill(json={'models': [{'name': 'models/gemini-3-flash', 'supportedGenerationMethods': ['generateContent']}]})

def groq(route):
    req = route.request
    if req.method == 'OPTIONS':
        return route.fulfill(status=204, headers={'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*'})
    h = {'access-control-allow-origin': '*'}
    if req.headers.get('authorization') != 'Bearer gsk-zkusebni':
        return route.fulfill(status=401, json={'error': {'message': 'Invalid API Key'}}, headers=h)
    if req.url.endswith('/models'):
        return route.fulfill(json={'data': [{'id': 'whisper-large-v3'}, {'id': 'llama'}]}, headers=h)
    body = req.post_data_buffer or b''
    i = body.find(b'RIFF')
    calls['groq'].append({'wav16k': i >= 0 and int.from_bytes(body[i + 24:i + 28], 'little') == 16000,
                          'model': b'whisper-large-v3' in body, 'lang': b'name="language"\r\n\r\ncy' in body, 'verbose': b'verbose_json' in body})
    segs = [{'start': 0.0, 'end': 0.8, 'text': ' ♪ ', 'no_speech_prob': 0.1, 'avg_logprob': -0.2, 'compression_ratio': 1.0},
            {'start': 1.0, 'end': 3.5, 'text': ' ' + LINES[0], 'no_speech_prob': 0.05, 'avg_logprob': -0.3, 'compression_ratio': 1.2},
            {'start': 3.6, 'end': 5.5, 'text': ' ' + LINES[1], 'no_speech_prob': 0.05, 'avg_logprob': -0.3, 'compression_ratio': 1.2},
            {'start': 10.0, 'end': 12.0, 'text': ' ' + LINES[2], 'no_speech_prob': 0.05, 'avg_logprob': -0.3, 'compression_ratio': 1.2},
            {'start': 13.0, 'end': 14.0, 'text': ' Diolch am wylio', 'no_speech_prob': 0.9, 'avg_logprob': -1.5, 'compression_ratio': 1.0},
            {'start': 15.0, 'end': 17.0, 'text': ' la la la la la la la la la la', 'no_speech_prob': 0.1, 'avg_logprob': -0.4, 'compression_ratio': 3.4}]
    return route.fulfill(json={'text': '', 'segments': segs}, headers=h)

def lrclib(route):
    return route.fulfill(json=[])

def main():
    files = [tone(TMP / 'Jana - Cân Un.mp3', 12), tone(TMP / 'Jana - Cân Dau.wav', 360), tone(TMP / 'Jana - Cân Tri.wav', 6)]
    check(files[1].stat().st_size > 14 * 1048576, f'velký wav ({files[1].stat().st_size // 1048576} MB) půjde přes Files API')
    srv = serve()
    url = f'http://127.0.0.1:{srv.server_address[1]}/'
    with sync_playwright() as p:
        browser = p.chromium.launch(args=['--autoplay-policy=no-user-gesture-required'])
        ctx = browser.new_context(**p.devices['Pixel 7'])
        page = ctx.new_page()
        page.on('console', lambda m: m.type == 'error' and errors.append(m.text))
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.on('dialog', lambda d: d.accept())
        page.route('https://generativelanguage.googleapis.com/**', gemini)
        page.route('https://lrclib.net/**', lrclib)
        page.route('https://api.groq.com/**', groq)
        page.add_init_script("""if (!localStorage.getItem('alaw-ai')) localStorage.setItem('alaw-ai', JSON.stringify({ key: 'zkusebni-klic', model: 'gemini-3-flash', models: ['gemini-3-flash'] }));
          window.__alawAiPoll = 50; window.__alawBulkDelay = 0; window.__alawInlineMax = 1048576; window.__alawGroqMax = 200000;""")
        page.goto(url)
        page.wait_for_selector('text=Croeso!')

        print('Čisté funkce')
        r = page.evaluate("""async () => {
          const a = await import('./js/ai.js');
          return {
            ok: a.cleanTranscript([{ start: 1.2, text: ' Un  dau ' }, { start: 2, text: '…' }, { start: 3.5, text: 'tri', new_stanza: true }]),
            back: a.cleanTranscript([{ start: 5, text: 'a' }, { start: 2, text: 'b' }]).map(l => l.start),
            mime: [a.audioMime('audio/mpeg'), a.audioMime('', 'x.WAV'), a.audioMime('audio/ogg'), a.audioMime('', 'x')],
          };
        }""")
        check(r['ok'] == [{'text': 'Un dau', 'start': 1200, 'stanza': False}, {'text': 'tri', 'start': 3500, 'stanza': True}], 'úklid přepisu: mezery, „…“ pryč, časy v ms')
        check(r['back'] == [None, None], 'časy jdoucí zpět → bez časů')
        check(r['mime'] == ['audio/mp3', 'audio/wav', 'audio/ogg', 'audio/mp3'], 'typ zvuku pro Gemini')

        print('Přidání a hromadný přepis')
        page.goto(url + '#/bulk')
        with page.expect_file_chooser() as fc:
            page.click('text=♪ Vybrat nahrávky')
        fc.value.set_files([str(f) for f in files])
        wait(page, "document.querySelectorAll('.bulk-row').length === 3")
        page.click('.bulk-foot button.primary')
        page.wait_for_selector('text=Najít texty')
        page.click('text=🔍 Hledat texty')
        page.wait_for_selector('text=🎧 Přepsat nenalezené z nahrávek (3)', timeout=20000)
        check(page.locator('text=🎧 Přepsat z nahrávky').count() == 3, 'u každé nenalezené tlačítko přepisu')
        page.click('text=🎧 Přepsat nenalezené z nahrávek (3)')
        wait(page, "document.body.textContent.includes('Hledat znovu nenalezené') && !document.body.textContent.includes('Přepisuji')", 60000)
        shot(page, 'p1-prepis')
        check(page.locator('text=✓ Přepsáno z nahrávky (zkontroluj)').count() == 2, 'dvě písně přepsané')
        check(page.locator('.bulk-row', has_text='Cân Tri').locator('text=/odmítl/').count() == 1, 'odmítnutí (autorská práva) ukázané u písně')
        check(('Cân Dau', 'file') in calls['parts'] and ('Cân Un', 'inline') in calls['parts'], 'malý soubor přímo, velký přes Files API')
        check(calls['upload'] == 1 and calls['delete'] == 1, 'nahraný soubor po přepisu smazán z Gemini')
        check(calls['upload_rate'] == 16000, 'do Gemini šla zmenšená kopie (mono 16 kHz), ne původní WAV')
        s = page.evaluate("async () => Object.fromEntries((await (await import('./js/store.js')).listSongs()).map(s => [s.title, s.versions.map(v => [v.label, v.lines.map(l => [l.text, l.start, l.stanza])])]))")
        check(s['Cân Un'] == [['Přepis (Gemini)', [[LINES[0], 1000, False], [LINES[1], 4000, False], [LINES[2], 7000, True], [LINES[3], 10000, False]]]], 'přepis = hlavní verze s časy a slokami')
        check(s['Cân Tri'][0][1] == [], 'odmítnutá píseň zůstala bez textu')

        print('Přepis písně s textem → druhá verze')
        sid = page.evaluate("async () => (await (await import('./js/store.js')).listSongs()).find(s => s.title === 'Cân Un').id")
        # pokrok u verše, který se ve druhém přepisu liší (kvůli převodu při výměně hlavní verze)
        page.evaluate("""async id => {
          const st = await import('./js/store.js'), L = await import('./js/learn.js');
          await st.saveProgress({ ...L.freshRec(id, L.lineKey("A'r gwynt yn chwythu'n ysgafn")), st: 'review', reps: 4, ivl: 9, due: Date.now() + 9 * 864e5, t: 1 });
        }""", sid)
        page.goto(url + '#/song/' + sid)
        page.click('button[aria-label="Další možnosti"]')
        page.click('text=Přepsat z nahrávky jako další verzi (AI)')
        wait(page, "location.hash.startsWith('#/compare/')", 30000)
        shot(page, 'p2-porovnani')
        v = page.evaluate("async id => (await (await import('./js/store.js')).getSong(id)).versions.map(v => [v.label, v.lines.length, !!v.audio])", sid)
        check(v == [['Přepis (Gemini)', 4, True], ['Přepis (Gemini) 2', 4, False]], 'přepis přidán jako druhá verze (bez vlastní nahrávky)')

        print('Výměna hlavní verze')
        page.click('button[aria-label="Možnosti verze"]')
        page.click('text=Udělat hlavní verzí')
        wait(page, "location.hash.startsWith('#/song/')", 10000)
        r = page.evaluate("""async id => {
          const st = await import('./js/store.js'), L = await import('./js/learn.js');
          const s = await st.getSong(id), main = s.versions.find(v => v.id === s.primary), old = s.versions.find(v => v.id !== s.primary);
          const p = await st.getProgress(id);
          return { main: main.lines[1].text, audio: !!main.audio, oldAudio: !!old.audio, oldLabel: old.label,
                   moved: p.get(L.lineKey("A'r gwynt yn chwythu'n gryf"))?.reps, kept: p.get(L.lineKey("A'r gwynt yn chwythu'n ysgafn"))?.reps };
        }""", sid)
        print('   ', r)
        check(r['main'] == "A'r gwynt yn chwythu'n gryf", 'hlavní je teď druhý přepis')
        check(r['audio'] and not r['oldAudio'], 'nahrávka přešla na novou hlavní verzi')
        check(r['moved'] == 4 and r['kept'] == 4, 'pokrok verše převeden na nové znění (starý zůstal)')

        print('Groq (Whisper): nastavení a přepis')
        page.goto(url + '#/settings')
        page.wait_for_selector('text=Přepis z nahrávky')
        page.fill('input[placeholder="gsk_…"]', 'spatny')
        page.locator('section', has_text='Klíč Groq').locator('text=Uložit a ověřit').click()
        page.wait_for_selector('text=/Klíč pro Groq není platný/')
        page.fill('input[placeholder="gsk_…"]', 'gsk-zkusebni')
        page.locator('section', has_text='Klíč Groq').locator('text=Uložit a ověřit').click()
        page.wait_for_selector('text=✓ Funguje.')
        check(page.locator('text=Předvybraná služba').count() == 1, 'ověřený klíč Groq, dvě služby → výběr předvybrané')
        tri = page.evaluate("async () => (await (await import('./js/store.js')).listSongs()).find(s => s.title === 'Cân Tri').id")
        page.goto(url + '#/song/' + tri)
        page.click('text=🎧 Přepsat z nahrávky')
        page.wait_for_selector('text=Čím přepsat?')
        page.click('.sheet >> text=Whisper (Groq)')
        page.wait_for_selector('.lyric', timeout=30000)
        g = calls['groq'][-1]
        check(g['wav16k'] and g['model'] and g['lang'] and g['verbose'], 'Groq: zmenšená kopie WAV 16 kHz, whisper-large-v3, velština, časy úseků')
        r = page.evaluate("async id => { const s = await (await import('./js/store.js')).getSong(id); const v = s.versions[0]; return [v.label, v.lines.map(l => [l.text, l.start, l.stanza])]; }", tri)
        print('   ', r)
        check(r[0] == 'Přepis (Whisper)' and [l[0] for l in r[1]] == LINES[:3], 'Whisper: verše bez hudby (♪), halucinací a opakování')
        check([l[1] for l in r[1]] == [1000, 3600, 10000] and [l[2] for l in r[1]] == [False, False, True], 'časy úseků a nová sloka po pauze')

        print('Hromadné mazání')
        page.goto(url + '#/')
        page.wait_for_selector('.song-card')
        keys0 = page.evaluate("async () => (await (await import('./js/db.js')).db.audioKeys()).length")
        page.click('button[aria-label="Vybrat víc písní"]')
        page.wait_for_selector('.sel-bar')
        check(page.locator('.fab').count() == 0, 'v režimu výběru bez tlačítka Přidat')
        page.click('.song-card:has-text("Cân Dau")')
        page.click('.song-card:has-text("Cân Tri")')
        check(page.locator('.song-card.selected').count() == 2, 'označeny dvě písně')
        shot(page, 'p3-vyber')
        page.click('text=🗑 Smazat (2)')
        wait(page, "document.querySelectorAll('.song-card').length === 1")
        r = page.evaluate("async () => [(await (await import('./js/store.js')).listSongs()).map(s => s.title), (await (await import('./js/db.js')).db.audioKeys()).length, Object.keys(await (await import('./js/db.js')).db.getMeta('tombs') || {}).length]")
        check(r[0] == ['Cân Un'] and r[1] == keys0 - 2, 'smazány 2 písně i s nahrávkami')
        check(r[2] == 2, 'náhrobky pro synchronizaci')
        page.wait_for_selector('.fab')
        check(page.locator('.fab').count() == 1, 'po smazání zpět normální knihovna')
        browser.close()
    real = [e for e in errors if 'favicon' not in e and '401 (Unauthorized)' not in e]  # 401 = schválně špatný klíč Groq
    check(not real, f'bez chyb v konzoli {real}')
    print('HOTOVO')

if __name__ == '__main__':
    main()
