# Vytvoří sw.js se seznamem souborů a otiskem verze. Spusť po každé změně souborů aplikace.
import hashlib, sys
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent
FILES = ['index.html', 'manifest.webmanifest', 'css/app.css'] + sorted(f'js/{p.name}' for p in (ROOT / 'js').glob('*.js')) + \
        ['icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png']
h = hashlib.sha256()
for f in FILES:
    h.update(f.encode()); h.update((ROOT / f).read_bytes())
cache = 'alaw-' + h.hexdigest()[:12]
files = ', '.join(f"'{f}'" for f in FILES)
content = f"""// Offline: vždy nejdřív síť (nová verze hned), bez sítě z mezipaměti. Vytváří scripts/build_sw.py, ručně neupravovat.
const C='{cache}',F=[{files}];
self.addEventListener('install',e=>{{e.waitUntil(caches.open(C).then(c=>c.addAll(['./',...F])));self.skipWaiting()}});
self.addEventListener('activate',e=>{{e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!==C).map(x=>caches.delete(x)))).then(()=>self.clients.claim()))}});
self.addEventListener('fetch',e=>{{const r=e.request;if(r.method!=='GET'||new URL(r.url).origin!==location.origin)return;
  e.respondWith(fetch(r).then(x=>{{if(x.ok){{const y=x.clone();caches.open(C).then(c=>c.put(r,y))}}return x}})
    .catch(()=>caches.match(r,{{ignoreSearch:true}}).then(x=>x||caches.match('index.html'))))}});
"""
if '--check' in sys.argv:
    if (ROOT / 'sw.js').read_text(encoding='utf-8') != content:
        sys.exit('Neaktuální sw.js: spusť python3 scripts/build_sw.py')
    print('sw.js aktuální')
else:
    (ROOT / 'sw.js').write_text(content, encoding='utf-8')
    print('sw.js', cache, len(FILES), 'souborů')
