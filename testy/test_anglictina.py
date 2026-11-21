# Test anglické verze rozhraní (Playwright, mobilní Chromium, bez sítě):
#  1) každý text z t(…)/pl(…) v js/ má anglický překlad v js/i18n-en.js (a slovník nemá nic navíc),
#  2) projde obrazovky v angličtině (prohlížeč en-GB) a hlídá, že nikde nezůstala čeština (mimo data písní),
#  3) přepínač CZ | EN na hlavní stránce přepne jazyk a volba vydrží.
# Spuštění: python3 -u testy/test_anglictina.py [složka_pro_snímky]
import json, re, subprocess, sys
from pathlib import Path
from playwright.sync_api import sync_playwright
from test_zaklad import serve, wait, check

ROOT = Path(__file__).resolve().parent.parent
SHOTS = Path(sys.argv[1]) if len(sys.argv) > 1 else None
errors = []

# Tradiční lidová píseň (volné dílo), dvě verze kvůli porovnání.
LRC = """[00:01.00]Ar lan y môr mae rhosys cochion
[00:04.00]Ar lan y môr mae lilis gwynion

[00:07.00]Ar lan y môr mae 'nghariad inne
[00:10.00]Yn cysgu'r nos a chodi'r bore"""
OTHER = """Ar lan y mor mae rhosys cochion
Ar lan y môr mae lili gwynion

Ar lan y môr mae nghariad innau
Yn cysgu'r nos a chodi'r bore
Cytgan"""

CZ_CHARS = re.compile(r'[ěščřžůňťďĚŠČŘŽŮŇŤĎ]|[áíéúý](?=\w)')  # česká diakritika (velština má â ê î ô û ŵ ŷ)
CZ_WORDS = re.compile(r'\b(Hotovo|nebo|Zpět|Uložit|Smazat|Přidat|Hledat|Nastavení|verze|verš|písn\w*|nahrávk\w*|Zrušit|Učit|Procvičit|Poslechnout|Nevim|Zkontrolovat|Odkryt|Vybrat|Zavrit|Pokracovat|Nacist|Stahnout|Prepis\w*|doslovn\w*|Napsal)\b', re.I)

# ---------- 1) slovník ----------
def dictionary_check():
    print('Slovník')
    keys = json.loads(subprocess.check_output([sys.executable, str(ROOT / 'testy' / 'i18n_klice.py'), str(ROOT)]))
    js = "import('" + (ROOT / 'js' / 'i18n-en.js').as_uri() + "').then(m => console.log(JSON.stringify({ t: Object.keys(m.EN), pl: Object.keys(m.EN_PL), v: m.EN, p: m.EN_PL })))"
    d = json.loads(subprocess.check_output(['node', '--input-type=module', '-e', js]))
    have_t, have_pl = set(d['t']), set(d['pl'])
    need_t, need_pl = set(keys['t']), {p[0] for p in keys['pl']}
    missing = sorted(need_t - have_t) + sorted(need_pl - have_pl)
    extra = sorted(have_t - need_t) + sorted(have_pl - need_pl)
    check(not missing, f'všechny texty mají překlad ({len(need_t)} + {len(need_pl)} množných){" – CHYBÍ: " + " | ".join(missing) if missing else ""}')
    check(not extra, f'slovník nemá nepoužité texty{" – NAVÍC: " + " | ".join(extra) if extra else ""}')
    # proměnné {x} musí v překladu zůstat stejné
    bad = [k for k, v in d['v'].items() if sorted(re.findall(r'\{\w+\}', k)) != sorted(re.findall(r'\{\w+\}', v))]
    bad += [k for k, v in d['p'].items() if any(sorted(set(re.findall(r'\{\w+\}', k)) - {'{n}'}) != sorted(set(re.findall(r'\{\w+\}', x)) - {'{n}'}) for x in v)]
    check(not bad, f'proměnné v překladech sedí{" – " + " | ".join(bad) if bad else ""}')
    # anglické texty bez české diakritiky a s britským pravopisem
    vals = list(d['v'].values()) + [x for v in d['p'].values() for x in v]
    cz = [v for v in vals if CZ_CHARS.search(v)]
    check(not cz, f'v anglických textech není čeština{" – " + " | ".join(cz) if cz else ""}')
    us = [v for v in vals if re.search(r'\b(color|favorite|memoriz\w*|recogniz\w*|organiz\w*|analyz\w*|center|license|canceled|practic(e|ing) (the|this|it)\b)', v, re.I)]
    check(not us, f'britský pravopis (žádné color, favorite, -ize…){" – " + " | ".join(us) if us else ""}')

# ---------- 2) obrazovky ----------
def visible_text(page):
    # text + popisky (placeholder, title, aria-label), bez dat písní (.lyric .text, názvy) a bez přepínače jazyka
    return page.evaluate("""() => {
      const skip = n => n.closest('.lang-switch, .lyric .text, .lyric .tr, .lyric .lit, .ltext, .lprev-text, .choices, .sc-pool, .sc-placed, .blur-text, .vtext, .r-preview, .title, .artist, .bulk-title strong, textarea, .gloss, .song-title');
      const out = [];
      const pseudo = n => ['::before', '::after'].map(p => getComputedStyle(n, p).content).filter(c => c && c !== 'none' && c !== 'normal').map(c => c.replace(/^"|"$/g, ''));
      const walk = n => {
        if (n.nodeType === 1 && n.isConnected && !n.closest('.lang-switch')) out.push(...pseudo(n).filter(c => /[A-Za-z]{3}/.test(c)));
        if (n.nodeType === 3) { if (n.textContent.trim() && !skip(n.parentElement)) out.push(n.textContent.trim()); return; }
        if (n.nodeType !== 1 || n.hidden || getComputedStyle(n).display === 'none') return;
        if (!skip(n)) for (const a of ['placeholder', 'title', 'aria-label']) if (n.getAttribute(a)) out.push(n.getAttribute(a));
        if (n.tagName === 'SELECT') { if (!skip(n)) [...n.options].forEach(o => out.push(o.textContent)); return; }
        if (n.tagName === 'INPUT' && n.type !== 'checkbox' && n.type !== 'range' && n.value && !skip(n)) return; // vstup = data
        n.childNodes.forEach(walk);
      };
      walk(document.body);
      return out;
    }""")

DATA = {'Ar Lan y Môr', 'Lidová', 'Rozárka', 'Jana'}

def no_czech(page, where):
    page.wait_for_timeout(250)
    texts = [t for t in visible_text(page) if t not in DATA]
    bad = [t for t in texts if CZ_CHARS.search(t) or CZ_WORDS.search(t)]
    miss = page.evaluate('() => [...(window.__alawMissing || [])]')
    check(not bad and not miss, f'{where}: anglicky{" – ČESKY: " + " | ".join(bad[:8]) if bad else ""}{" – BEZ PŘEKLADU: " + " | ".join(miss) if miss else ""}')
    if SHOTS:
        SHOTS.mkdir(parents=True, exist_ok=True)
        page.screenshot(path=str(SHOTS / f'en-{re.sub(r"[^a-z0-9]+", "-", where.lower())}.png'))

SEED = """async ([lrc, other]) => {
  const model = await import('./js/model.js'), store = await import('./js/store.js'), versions = await import('./js/versions.js');
  // 3 s ticha jako WAV (8 kHz, 8 bit) – stačí na přehrávač
  const n = 24000, buf = new Uint8Array(44 + n), dv = new DataView(buf.buffer);
  const w = (o, s) => [...s].forEach((c, i) => buf[o + i] = c.charCodeAt(0));
  w(0, 'RIFF'); dv.setUint32(4, 36 + n, true); w(8, 'WAVEfmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
  dv.setUint32(24, 8000, true); dv.setUint32(28, 8000, true); dv.setUint16(32, 1, true); dv.setUint16(34, 8, true); w(36, 'data'); dv.setUint32(40, n, true); buf.fill(128, 44);
  const blob = new Blob([buf], { type: 'audio/wav' });
  await store.putAudioBlob('a-test', blob);
  const lines = model.parseLyrics(lrc);
  lines.forEach((l, i) => { l.translation = 'U moře ' + i; l.literal = 'Na břehu moře ' + i; l.en = { translation: 'By the sea ' + i, literal: 'On shore the sea ' + i, contractions: [] }; });
  const s = model.newSong({ title: 'Ar Lan y Môr', artist: 'Lidová', tags: ['hymns'], lines,
    versionExtra: { audio: { key: 'a-test', name: 'ar-lan-y-mor.wav', type: 'audio/wav', size: blob.size } } });
  s.versions.push(model.newVersion(model.parseLyrics(other), { label: 'Přepis (Whisper)', source: 'přepis' }));
  await store.saveSong(s);
  const empty = model.newSong({ title: 'Calon Lân', artist: '', lines: [], versionExtra: { source: 'nahrávka', audio: { key: 'a-test', name: 'calon-lan.wav', type: 'audio/wav', size: blob.size } } });
  await store.saveSong(empty);
  // verše už „učené“ (ne nové), aby šla vynutit cvičení v lekci; poslední verš zůstane nový (úvodní karta)
  const learn = await import('./js/learn.js');
  const units = learn.songUnits(s);
  await store.saveProgress(...units.slice(0, -1).map(u => ({ ...learn.introduce(learn.freshRec(s.id, u.k), Date.now() - 86400e3), due: Date.now() - 1000 })));
  return [s.id, s.versions[1].id, empty.id];
}"""

def screens(page, url):
    print('Obrazovky v angličtině')
    page.goto(url)
    page.wait_for_selector('text=Croeso!')
    check(page.evaluate('() => document.documentElement.lang') == 'en-GB', 'html lang = en-GB (podle prohlížeče)')
    check(page.locator('.lang-switch button.on').inner_text() == 'EN', 'přepínač ukazuje EN')
    no_czech(page, 'prázdná knihovna')

    sid, vid, eid = page.evaluate(SEED, [LRC, OTHER])
    page.goto(url + '#/'); page.reload()
    page.wait_for_selector('.song-card')
    no_czech(page, 'knihovna')
    page.click('.sel-toggle'); page.wait_for_selector('.sel-bar:not([hidden])')
    no_czech(page, 'knihovna – výběr')
    page.click('.sel-bar button:has-text("Done")')

    page.goto(f'{url}#/song/{sid}'); page.wait_for_selector('.lyric')
    no_czech(page, 'píseň')
    for i, name in enumerate(['cloze', 'initials', 'map']):
        page.click(f'.seg button >> nth={i + 1}'); no_czech(page, f'píseň – režim {name}')
    page.click('.seg button >> nth=0')
    page.click('.topbar .icon-btn >> nth=-1'); page.wait_for_selector('.sheet'); no_czech(page, 'nabídka písně')
    page.click('.sheet .menu button:has-text("Download lyrics…")'); page.wait_for_selector('.sheet h3:has-text("Download lyrics")')
    no_czech(page, 'stáhnout text'); page.keyboard.press('Escape')
    page.click('.tr-switch button:has-text("CZ")'); no_czech(page, 'píseň – překlad CZ'); page.click('.tr-switch button:has-text("EN")')
    page.click('.lyric .more >> nth=0'); page.wait_for_selector('.sheet'); no_czech(page, 'nabídka verše')
    page.click('.sheet .menu button:has-text("Edit line")'); page.wait_for_selector('.sheet .form'); no_czech(page, 'úprava verše'); page.keyboard.press('Escape')
    page.click('.learn-box button >> nth=0'); page.wait_for_selector('.sheet'); no_czech(page, 'procvičit – výběr'); page.keyboard.press('Escape')

    for path, sel, name in [(f'#/edit/{sid}', 'form', 'úprava písně'), ('#/new', 'form', 'nová píseň'),
                            (f'#/version/{sid}/{vid}', 'form', 'úprava verze'), (f'#/compare/{sid}', '.spot, .empty, .spots-h', 'porovnání verzí'),
                            (f'#/sync/{sid}', '.tap-btn', 'časování'), ('#/bulk', '.view', 'písně z nahrávek'), ('#/lyrics', '.view', 'najít texty'), ('#/times', '.view', 'doplnit časy'),
                            ('#/settings', '.section', 'nastavení')]:
        page.goto(url + path); page.wait_for_selector(sel); no_czech(page, name)
    # nápověda „?“ u klíčů a přístupů (na počítači všech pět)
    page.goto(url + '#/settings'); page.wait_for_selector('.help-btn')
    topics = page.evaluate("() => [...document.querySelectorAll('.help-btn')].map(b => b.dataset.help)")
    check(sorted(topics) == ['bangor', 'gemini', 'groq', 'proxy', 'sync'], f'otazníky v Nastavení: {topics}')
    for tp in topics:
        page.click(f'.help-btn[data-help="{tp}"]'); page.wait_for_selector(f'.sheet .help[data-topic="{tp}"]')
        n = page.locator('.sheet .help-steps li').count()
        check(3 <= n <= 6, f'nápověda {tp}: {n} kroků')
        no_czech(page, f'nápověda {tp}'); page.click('.sheet button:has-text("Close")'); page.wait_for_selector('.sheet', state='detached')
    page.goto(f'{url}#/compare/{sid}'); page.wait_for_selector('.topbar .icon-btn >> nth=-1')
    page.click('.topbar .icon-btn >> nth=-1'); page.wait_for_selector('.sheet'); no_czech(page, 'nabídka verze'); page.keyboard.press('Escape')

    for m in ['order', 'blur', 'cheat', 'exam']:
        page.goto(f'{url}#/drill/{sid}/{m}'); page.wait_for_selector('.view'); page.wait_for_timeout(300); no_czech(page, f'procvičování {m}')
    page.click('button:has-text("Reveal")'); no_czech(page, 'zkouška – odkryto')

    for ex in ['initials', 'choiceWord', 'scramble', 'flash', 'recall', 'choice3', 'fromCz', 'before', 'type']:
        page.goto(url + '#/'); page.wait_for_selector('.song-card')
        page.evaluate(f"() => {{ window.__alawForceEx = '{ex}'; window.__alawFlashMs = 300; }}")
        page.goto(f'{url}#/learn/{sid}'); page.wait_for_selector('.lcard')
        page.wait_for_timeout(500)
        no_czech(page, f'lekce – {ex}')
        if ex == 'scramble':
            for _ in range(12):
                if not page.locator('.sc-pool .sc-word').count(): break
                page.click('.sc-pool .sc-word >> nth=0'); page.wait_for_timeout(50)
        elif ex in ('choiceWord', 'choice3'):
            page.click('.choices button >> nth=0')
        else:
            for b in ["I don't know", 'Reveal']:
                if page.locator(f'button:has-text("{b}")').count():
                    page.click(f'button:has-text("{b}") >> nth=0'); break
        page.wait_for_timeout(400)
        no_czech(page, f'lekce – {ex} – vyhodnocení')
        check(page.locator('.lcard button:has-text("Again")').count() == 1, f'lekce – {ex}: hodnocení Again/Hard/Good/Easy')
    page.evaluate("() => { window.__alawForceEx = null; }")
    page.goto(url + '#/'); page.wait_for_selector('.song-card')
    page.goto(f'{url}#/learn/{sid}'); page.wait_for_selector('.lcard'); no_czech(page, 'lekce – nový verš')

    page.goto(f'{url}#/song/{eid}'); page.wait_for_selector('text=This song has no lyrics yet.')
    no_czech(page, 'píseň bez textu')
    page.click('button:has-text("Find lyrics")'); page.wait_for_timeout(1500)
    no_czech(page, 'hledání textu (offline)')

def switching(page, url):
    print('Přepínač CZ | EN')
    page.goto(url + '#/'); page.reload(); page.wait_for_selector('.lang-switch')
    with page.expect_navigation():
        page.click('.lang-switch button:has-text("CZ")')
    page.wait_for_selector('.fab')
    check('Přidat píseň' in page.locator('.fab').inner_text(), 'po CZ česky')
    check(page.evaluate('() => document.documentElement.lang') == 'cs', 'html lang = cs')
    page.reload(); page.wait_for_selector('.fab')
    check('Přidat píseň' in page.locator('.fab').inner_text(), 'volba vydrží po načtení znovu')
    page.goto(url + '#/settings'); page.wait_for_selector('.section')
    check(page.locator('h1').inner_text() == 'Nastavení', 'nastavení česky')
    page.goto(url + '#/')
    with page.expect_navigation():
        page.click('.lang-switch button:has-text("EN")')
    page.wait_for_selector('.fab')
    check('Add song' in page.locator('.fab').inner_text(), 'po EN anglicky')

def main():
    dictionary_check()
    srv = serve()
    url = f'http://127.0.0.1:{srv.server_address[1]}/'
    with sync_playwright() as p:
        browser = p.chromium.launch(args=['--autoplay-policy=no-user-gesture-required'])
        ctx = browser.new_context(**p.devices['Pixel 7'], locale='en-GB')
        page = ctx.new_page()
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.on('dialog', lambda d: (errors.append('dialog: ' + d.message) if CZ_CHARS.search(d.message) else None, d.dismiss()))
        screens(page, url)
        switching(page, url)
        # český prohlížeč bez volby → česky
        ctx2 = browser.new_context(**p.devices['Pixel 7'], locale='cs-CZ')
        p2 = ctx2.new_page(); p2.goto(url); p2.wait_for_selector('.fab')
        check('Přidat píseň' in p2.locator('.fab').inner_text(), 'český prohlížeč bez volby → česky')
        browser.close()
    srv.shutdown()
    if errors:
        raise AssertionError('Chyby: ' + ' | '.join(errors))
    print('\nAngličtina: všechny testy prošly.')

if __name__ == '__main__':
    main()
