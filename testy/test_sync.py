# Test synchronizace dvou zařízení přes napodobený GitHub (nikdy proti skutečnému GitHubu).
# Každé zařízení = vlastní kontext prohlížeče. Spuštění: python3 testy/test_sync.py [snímky]
import base64, gzip, hashlib, json, re, subprocess, sys, tempfile, threading, time
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from cryptography.hazmat.primitives import hashes
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
SHOTS = Path(sys.argv[1]) if len(sys.argv) > 1 else None
TMP = Path(tempfile.mkdtemp())
TOKEN = 'github_pat_' + 'TESTTOKEN0123456789abcdef'  # rozdělené, ať to kontrola tokenů v repozitáři nebere jako skutečný token
REPO = 'jana/alaw-sync'

# ---------- napodobený GitHub ----------
class FakeGitHub:
    def __init__(self):
        self.objects = {}      # sha → ('blob', bytes) | ('tree', list) | ('commit', dict)
        self.refs = {}         # branch → sha
        self.contents = {}     # path → bytes
        self.log = []
        self.lock = threading.RLock()  # Playwright volá obsluhy v jednom vlákně (greenlety): obyčejný zámek se občas zablokoval sám

    def sha(self, kind, data):
        return hashlib.sha1(kind.encode() + b'\0' + data).hexdigest()

    def handle(self, route):
        req = route.request
        cors = {'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, content-type, accept',
                'access-control-allow-methods': 'GET, POST, PUT, PATCH, OPTIONS'}
        if req.method == 'OPTIONS':
            return route.fulfill(status=204, headers=cors)
        path = re.sub(r'^https://api\.github\.com', '', req.url)
        with self.lock:
            self.log.append(f'{req.method} {path}')
        if req.headers.get('authorization') != f'Bearer {TOKEN}':
            return route.fulfill(status=401, json={'message': 'Bad credentials'}, headers=cors)
        j = lambda obj, status=200: route.fulfill(status=status, body=json.dumps(obj), headers={**cors, 'content-type': 'application/json'})
        body = json.loads(req.post_data) if req.post_data else None
        with self.lock:
            if path == '/user':
                return j({'login': 'jana'})
            if path == '/repos/jana/verejny':
                return j({'full_name': 'jana/verejny', 'private': False})
            if path == f'/repos/{REPO}':
                return j({'full_name': REPO, 'private': True})
            P = f'/repos/{REPO}'
            if not path.startswith(P):
                return j({'message': 'Not Found'}, 404)
            p = path[len(P):]
            if p.startswith('/contents/'):
                name = p[len('/contents/'):]
                if req.method == 'GET':
                    if name not in self.contents: return j({'message': 'Not Found'}, 404)
                    return j({'content': base64.b64encode(self.contents[name]).decode()})
                if req.method == 'PUT':
                    if name in self.contents: return j({'message': 'sha required'}, 422)
                    self.contents[name] = base64.b64decode(body['content'])
                    return j({'content': {'path': name}}, 201)
            if p.startswith('/git/matching-refs/heads/'):
                pre = p.split('/heads/')[1]
                return j([{'ref': f'refs/heads/{b}', 'object': {'sha': s}} for b, s in self.refs.items() if b.startswith(pre)])
            m = re.match(r'^/git/(blobs|trees|commits)/([a-f0-9]{40})$', p)
            if m and req.method == 'GET':
                kind, sha = m.groups()
                o = self.objects.get(sha)
                if not o: return j({'message': 'Not Found'}, 404)
                if kind == 'blobs':
                    return route.fulfill(status=200, body=o[1], headers={**cors, 'content-type': 'application/octet-stream'})
                if kind == 'trees':
                    return j({'sha': sha, 'tree': o[1]})
                return j({'sha': sha, 'tree': {'sha': o[1]['tree']}})
            if p == '/git/blobs' and req.method == 'POST':
                data = base64.b64decode(body['content'])
                sha = self.sha('blob', data); self.objects[sha] = ('blob', data)
                return j({'sha': sha}, 201)
            if p == '/git/trees' and req.method == 'POST':
                for e in body['tree']:
                    assert e['sha'] in self.objects, 'strom odkazuje na neexistující blob'
                data = json.dumps(body['tree'], sort_keys=True).encode()
                sha = self.sha('tree', data); self.objects[sha] = ('tree', body['tree'])
                return j({'sha': sha}, 201)
            if p == '/git/commits' and req.method == 'POST':
                assert body['parents'] == []
                data = json.dumps(body, sort_keys=True).encode() + str(time.time()).encode()
                sha = self.sha('commit', data); self.objects[sha] = ('commit', body)
                return j({'sha': sha, 'committer': {'date': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}}, 201)
            if p == '/git/refs' and req.method == 'POST':
                br = body['ref'].replace('refs/heads/', '')
                if br in self.refs: return j({'message': 'Reference already exists'}, 422)
                self.refs[br] = body['sha']
                return j({'ref': body['ref']}, 201)
            m = re.match(r'^/git/refs/heads/(.+)$', p)
            if m and req.method == 'PATCH':
                if m.group(1) not in self.refs: return j({'message': 'Not Found'}, 422)
                self.refs[m.group(1)] = body['sha']
                return j({'ref': m.group(1)})
        return j({'message': f'nepodporováno {req.method} {p}'}, 500)

    def state(self, branch, code):
        """Rozšifruje stav větve (jako by to dělalo jiné zařízení) – ověření formátu a šifrování."""
        commit = self.objects[self.refs[branch]][1]
        tree = self.objects[commit['tree']][1]
        e = next(x for x in tree if x['path'] == 'state')
        raw = self.objects[e['sha']][1]
        key = HKDF(algorithm=hashes.SHA256(), length=32, salt=b'Alaw sync v1', info=b'state').derive(code.encode())
        plain = AESGCM(key).decrypt(raw[:12], raw[12:], b'state')
        return json.loads(gzip.decompress(plain)), tree

errors = []
def check(cond, msg):
    if not cond: raise AssertionError(msg)
    print('  ✓', msg)

def wait(page, js, timeout=10000):
    end = time.time() + timeout / 1000
    while time.time() < end:
        if page.evaluate(f'() => !!({js})'): return
        page.wait_for_timeout(100)
    raise AssertionError(f'Nedočkal jsem se: {js}')

def shot(page, name):
    if SHOTS:
        SHOTS.mkdir(parents=True, exist_ok=True)
        page.screenshot(path=str(SHOTS / f'{name}.png'))

def device(browser, url, gh, label):
    ctx = browser.new_context(**PIXEL)
    page = ctx.new_page()
    page.on('pageerror', lambda e: errors.append(f'{label}: {e}'))
    page.route('https://api.github.com/**', gh.handle)
    page.add_init_script('window.__alawSyncPart = 300000')   # malé kousky zvuku, ať se testuje dělení
    page.goto(url)
    page.wait_for_selector('.fab')
    return ctx, page

def sync_now(page):
    page.goto(page.url.split('#')[0] + '#/settings')
    page.wait_for_selector('#sync >> text=Synchronizovat teď')
    page.click('#sync >> text=Synchronizovat teď')
    wait(page, 'document.querySelector("#sync") && !document.querySelector("#sync").textContent.includes("Synchronizuji") && document.querySelector("#sync").textContent.includes("Naposledy")', 20000)
    page.wait_for_timeout(300)

PIXEL = None

def main():
    global PIXEL
    wav = TMP / 'nahravka.wav'
    subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=330:duration=20', '-ac', '1', '-ar', '22050', str(wav)], check=True)
    class Q(SimpleHTTPRequestHandler):
        def log_message(self, *a): pass
    srv = ThreadingHTTPServer(('127.0.0.1', 0), partial(Q, directory=str(ROOT)))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    url = f'http://127.0.0.1:{srv.server_address[1]}/'
    gh = FakeGitHub()
    with sync_playwright() as p:
        PIXEL = p.devices['Pixel 7']
        b = p.chromium.launch(args=['--autoplay-policy=no-user-gesture-required'])
        ctxA, A = device(b, url, gh, 'A')

        print('Zařízení A: píseň se zvukem')
        A.click('.fab')
        A.fill('input[placeholder="Calon Lân"]', 'Ar Lan y Môr')
        A.fill('input[placeholder="Interpret (nepovinné)"]', 'Rozárka')
        A.fill('textarea', '[00:01.00]Ar lan y môr mae rhosys cochion\n[00:04.00]Ar lan y môr mae lilis gwynion')
        with A.expect_file_chooser() as fc:
            A.click('text=Vybrat soubor')
        fc.value.set_files(str(wav))
        A.click('button[type=submit]')
        A.wait_for_selector('.lyric')

        print('Zařízení A: nastavení synchronizace')
        A.goto(url + '#/settings')
        A.click('text=Nastavit synchronizaci')
        A.fill('input[placeholder="github_pat_…"]', 'spatny_token_0123456789abcdef')
        A.click('.sheet >> text=Připojit')
        A.wait_for_selector('.sheet .sy-err:not([hidden])')
        check('Token je neplatný' in A.inner_text('.sheet .sy-err'), 'neplatný token odmítnut')
        A.fill('input[placeholder="github_pat_…"]', TOKEN)
        A.fill('.sheet input:not([type=password])', 'verejny')
        A.click('.sheet >> text=Připojit')
        A.wait_for_selector('.sheet >> text=veřejný')
        check(True, 'veřejný repozitář odmítnut')
        A.fill('.sheet input:not([type=password])', 'alaw-sync')
        A.click('.sheet >> text=Připojit')
        A.wait_for_selector('.sy-words li')
        words = A.locator('.sy-words li').all_inner_texts()
        check(len(words) == 8, f'nový párovací kód: 8 slov')
        A.click('text=Zobrazit QR kód')
        A.wait_for_selector('.sy-qrimg svg')
        check(True, 'QR kód se zobrazí')
        shot(A, '01-kod')
        A.click('text=Mám je zapsaná')
        wait(A, 'document.querySelector("#sync").textContent.includes("Naposledy")', 20000)
        check('alaw-sync.json' in gh.contents, 'schránka založena (alaw-sync.json)')
        brA = next(iter(gh.refs))
        check(re.match(r'^al-[a-f0-9]{12}$', brA), f'vlastní větev {brA}')
        code = ' '.join(words)
        st, tree = gh.state(brA, code)
        check(st['app'] == 'Alaw' and st['songs'][0]['title'] == 'Ar Lan y Môr', 'stav jde rozšifrovat párovacím kódem')
        audio = [e for e in tree if e['path'].startswith('a/')]
        check(len(audio) >= 3, f'zvuk nahraný po kouscích ({len(audio)} kousků)')
        every = b''.join(o[1] for o in gh.objects.values() if o[0] == 'blob')
        check(b'Ar Lan' not in every and b'Rozarka' not in every and b'RIFF' not in every, 'na GitHubu jen šifrovaná data (žádný text ani WAV)')
        shot(A, '02-zapnuto')

        print('Zařízení B: připojení kódem')
        ctxB, B = device(b, url, gh, 'B')
        B.goto(url + '#/settings')
        B.click('text=Nastavit synchronizaci')
        B.fill('input[placeholder="github_pat_…"]', TOKEN)
        B.click('.sheet >> text=Připojit')
        B.wait_for_selector('.sheet textarea')
        B.fill('.sheet textarea', 'abandon ability able about above absent absorb abstract')
        B.click('.sheet >> text=Pokračovat')
        B.wait_for_selector('.sheet >> text=Kód nesedí')
        check(True, 'špatný kód odmítnut')
        B.fill('.sheet textarea', ' '.join(w[:4].upper() for w in words))
        B.click('.sheet >> text=Pokračovat')
        wait(B, 'document.querySelector("#sync") && document.querySelector("#sync").textContent.includes("Naposledy")', 20000)
        check(True, 'připojeno (stačí první 4 písmena, velikost nevadí)')
        check('Spárovaných zařízení: 2' in B.inner_text('#sync'), 'B vidí 2 zařízení')
        B.goto(url)
        B.wait_for_selector('.song-card')
        check('Ar Lan y Môr' in B.inner_text('.song-card') and B.locator('.song-card .badge:has-text("♪")').count() == 1, 'píseň i se zvukem dorazila na B')
        B.click('.song-card')
        wait(B, '+document.querySelector(".progress")?.max > 15000')
        check(True, 'nahrávka na B hraje (stažená a složená z kousků)')

        print('Úprava na B → A')
        B.click('[aria-label="Další možnosti"]')
        B.click('text=Upravit píseň')
        B.fill('input[placeholder="Calon Lân"]', 'Ar Lan y Môr (trad.)')
        B.click('button[type=submit]')
        B.wait_for_selector('.lyric')
        sync_now(B)
        sync_now(A)
        A.goto(url)
        A.wait_for_selector('.song-card')
        check('(trad.)' in A.inner_text('.song-card'), 'změna názvu z B dorazila na A')

        print('Souběžná úprava: novější vyhrává')
        A.click('.song-card'); A.click('[aria-label="Další možnosti"]'); A.click('text=Upravit píseň')
        A.fill('input[placeholder="Calon Lân"]', 'Verze z A')
        A.click('button[type=submit]'); A.wait_for_selector('.lyric')
        A.wait_for_timeout(1200)
        B.goto(url); B.click('.song-card'); B.click('[aria-label="Další možnosti"]'); B.click('text=Upravit píseň')
        B.fill('input[placeholder="Calon Lân"]', 'Verze z B')
        B.click('button[type=submit]'); B.wait_for_selector('.lyric')
        sync_now(A); sync_now(B); sync_now(A)
        A.goto(url); B.goto(url)
        A.wait_for_selector('.song-card'); B.wait_for_selector('.song-card')
        check(A.inner_text('.song-card .title') == 'Verze z B' and B.inner_text('.song-card .title') == 'Verze z B', 'obě zařízení mají novější úpravu (z B)')

        print('Pokrok učení: po verších, naposledy změněný vyhrává')
        GRADE = """async ([i, gs]) => { const S = await import('./js/store.js'); const L = await import('./js/learn.js');
          const song = (await S.listSongs())[0], k = L.songUnits(song)[i].k;
          let r = (await S.getProgress(song.id)).get(k) || L.introduce(L.freshRec(song.id, k));
          for (const g of gs) r = L.grade(r, g);
          await S.saveProgress(r); }"""
        PROG = "async () => (await (await import('./js/db.js')).db.allProgress()).sort((a, b) => a.k < b.k ? -1 : 1).map(r => [r.k.slice(0, 20), r.st, r.lapses])"
        A.evaluate(GRADE, [0, [4]])          # A: verš 1 umím
        B.evaluate(GRADE, [1, [3]])          # B: verš 2 se učím
        sync_now(A); sync_now(B); sync_now(A)
        pa, pb = A.evaluate(PROG), B.evaluate(PROG)
        check(len(pa) == 2 and pa == pb, f'oba verše na obou zařízeních: {pa}')
        A.wait_for_timeout(1100)
        A.evaluate(GRADE, [0, [1]])          # A později: verš 1 zapomenut
        sync_now(A); sync_now(B)
        check({x[0][17:]: x[1:] for x in B.evaluate(PROG)}['rho'] == ['learn', 1], 'novější hodnocení z A vyhrálo i na B')
        B.evaluate("""async () => { const S = await import('./js/store.js'); const L = await import('./js/learn.js');
          const song = (await S.listSongs())[0]; await S.resetProgress(song.id, [L.songUnits(song)[1].k]); }""")
        sync_now(B); sync_now(A)
        check({x[0][17:]: x[1] for x in A.evaluate(PROG)}['lil'] == 'new', 'vynulování verše na B se dostalo na A')
        st, _ = gh.state(brA, code)
        check(len(st['prog']) == 2 and st['v'] == 1, 'pokrok je v šifrovaném stavu (formát v:1)')
        A.goto(url); A.wait_for_selector('.song-card'); A.click('.song-card')
        A.wait_for_selector('.learn-box')
        check('1 se učíš' in A.inner_text('.learn-box'), 'souhrn v písni ukazuje synchronizovaný pokrok')
        A.goto(url); A.wait_for_selector('.song-card')

        print('Rychlé nahrání při odchodu z aplikace')
        A.click('.song-card'); A.click('[aria-label="Další možnosti"]'); A.click('text=Upravit píseň')
        A.fill('input[placeholder="Interpret (nepovinné)"]', 'Jana')
        A.click('button[type=submit]'); A.wait_for_selector('.lyric')
        n0 = len(gh.log)
        A.evaluate("""() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
          Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
          document.dispatchEvent(new Event('visibilitychange')); }""")
        A.wait_for_timeout(2500)
        new = gh.log[n0:n0 + 4]   # (B mezitím může synchronizovat po svém)
        check([x.split(' ')[0] + ' ' + x.split('/')[-1] if 'refs/heads' in x else x.split(' ')[0] + ' ' + x.split('/git/')[1] for x in new] == ['POST blobs', 'POST trees', 'POST commits', 'PATCH ' + brA],
              'při odchodu hned nahrání vlastního stavu (4 požadavky, nic nestahuje)')
        A.evaluate("""() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
          Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' }); }""")

        print('Beze změny se nic nenahrává')
        sync_now(A)
        n0 = len(gh.log)
        sync_now(A)
        check(not any('POST' in x for x in gh.log[n0:]), 'druhá synchronizace beze změn nic nenahrála')

        print('Smazání na A → B')
        A.goto(url); A.click('.song-card'); A.click('[aria-label="Další možnosti"]')
        A.once('dialog', lambda d: d.accept())
        A.click('text=Smazat píseň')
        A.wait_for_selector('text=Croeso!')
        sync_now(A); sync_now(B)
        B.goto(url)
        B.wait_for_selector('text=Croeso!')
        check(True, 'smazaná píseň zmizela i na B')
        check(B.evaluate("async () => (await (await import('./js/db.js')).db.audioKeys()).length") == 0, 'zvuk smazané písně uklizen i na B')
        check(gh.state(brA, code)[0]['prog'] == [], 'pokrok smazané písně se už nesynchronizuje')

        print('Hodně nahrávek: průběžný zápis stavu, čerstvá nahrávka se nemaže')
        A.goto(url)
        A.wait_for_selector('text=Croeso!')
        A.evaluate("""async () => {
          window.__alawSyncCommitEvery = 1;
          const st = await import('./js/store.js'), m = await import('./js/model.js');
          for (const t of ['Un', 'Dau']) {
            const key = m.uid(16), blob = new Blob([new Uint8Array(400000).fill(t.length)], { type: 'audio/wav' });
            await st.putAudioBlob(key, blob);
            await st.saveSong(m.newSong({ title: 'Cân ' + t, versionExtra: { audio: { key, name: t + '.wav', type: 'audio/wav', size: blob.size } } }));
          }
          await st.putAudioBlob('cerstvanahravka01', new Blob([new Uint8Array(10)]));   // píseň se k ní teprve ukládá
        }""")
        n0 = len(gh.log)
        sync_now(A)
        commits = [x for x in gh.log[n0:] if x.startswith('POST') and x.endswith('/git/commits')]
        check(len(commits) == 2, f'po každé nahrávce zapsán stav ({len(commits)} zápisy), poslední beze změny se neopakuje')
        st = gh.state(brA, code)[0]
        check(len(st['files']) == 2 and len(st['songs']) == 2, 've stavu obě písně i jejich nahrávky')
        check('cerstvanahravka01' in A.evaluate("async () => (await (await import('./js/db.js')).db.audioKeys())"), 'nahrávka bez uložené písně se synchronizací nesmazala')
        sync_now(B)
        check(B.evaluate("async () => (await (await import('./js/db.js')).db.audioKeys()).length") == 2, 'B si stáhla obě nahrávky')

        print('Vypnutí')
        B.goto(url + '#/settings')
        B.once('dialog', lambda d: d.accept())
        B.click('text=Vypnout v tomto zařízení')
        B.wait_for_selector('text=Nastavit synchronizaci')
        check(B.evaluate("() => localStorage.getItem('alaw-sync')") is None, 'token a kód z B odstraněny')
        shot(A, '03-nastaveni')
        b.close()
    srv.shutdown()
    if errors:
        raise AssertionError('Chyby na stránce: ' + ' | '.join(errors))
    print('\nSynchronizace: všechny testy prošly.')

if __name__ == '__main__':
    main()
