# Ruční kontrola zdrojů textů proti skutečným webům (ne součást běžných testů – weby se mění a omezují přístup).
# Stránka dostane napodobený most Androidu, který stahuje přes Python. Spuštění: python3 testy/zdroje_naostro.py
import json, sys, threading, urllib.request, urllib.error
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
UA = 'AlawLyrics/0.2 (+https://github.com/tvspk/alaw)'

def py_fetch(req_json):
    req = json.loads(req_json)
    body = req.get('body')
    r = urllib.request.Request(req['url'], data=body.encode() if body else None, method=req.get('method', 'GET'),
                               headers={'User-Agent': UA, **(req.get('headers') or {})})
    try:
        with urllib.request.urlopen(r, timeout=25) as resp:
            return json.dumps({'status': resp.status, 'text': resp.read().decode('utf-8', 'replace'), 'url': resp.geturl()})
    except urllib.error.HTTPError as e:
        return json.dumps({'status': e.code, 'text': e.read().decode('utf-8', 'replace'), 'url': req['url']})
    except Exception as e:
        return json.dumps({'error': str(e)})

QUERIES = [
    {'title': 'Calon Lân'},
    {'title': 'Ar Lan y Môr'},
    {'title': 'Delilah', 'artist': 'Tom Jones'},
    {'title': 'Yma o Hyd', 'artist': 'Dafydd Iwan'},
]

def main():
    class Q(SimpleHTTPRequestHandler):
        def log_message(self, *a): pass
    srv = ThreadingHTTPServer(('127.0.0.1', 0), partial(Q, directory=str(ROOT)))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    only = sys.argv[1:] or None
    with sync_playwright() as p:
        b = p.chromium.launch()
        page = b.new_page()
        page.on('pageerror', lambda e: print('PAGEERROR', e))
        page.expose_function('pyFetch', py_fetch)
        page.add_init_script("window.AlawAndroid={fetch:(id,j)=>window.pyFetch(j).then(r=>window.__alawNet(id,r))}")
        page.goto(f'http://127.0.0.1:{srv.server_address[1]}/#/settings')
        page.wait_for_selector('.section')
        for q in QUERIES:
            print('\n===', q)
            res = page.evaluate("""async ([q, only]) => {
              const { SOURCES, searchAll } = await import('./js/sources.js');
              const out = {}; const got = {};
              await searchAll(q, (id, st) => { if (st.status !== 'loading') got[id] = st; }, SOURCES.filter(s => !only || only.includes(s.id)));
              await Promise.all(Object.entries(got).map(async ([id, st]) => {
                try {
                  if (st.status === 'error') throw Object.assign(new Error(st.error), { kind: st.kind });
                  const r = st.results;
                  let first = null;
                  if (r[0]) { const l = await r[0].load(); first = { title: r[0].title, artist: r[0].artist, lines: l.text.split('\\n').length, head: l.text.slice(0, 90), alt: (l.altText||'').slice(0, 40), yt: l.youtubeId || null, synced: !!l.synced }; }
                  out[id] = { n: r.length, first };
                } catch (e) { out[id] = { error: (e.kind ? e.kind + ': ' : '') + e.message }; }
              }));
              return out;
            }""", [q, only])
            for k, v in res.items():
                print(f'  {k:16} {json.dumps(v, ensure_ascii=False)}')
        b.close()
    srv.shutdown()

if __name__ == '__main__':
    main()
