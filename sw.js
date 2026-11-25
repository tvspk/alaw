// Offline: vždy nejdřív síť (nová verze hned), bez sítě z mezipaměti. Vytváří scripts/build_sw.py, ručně neupravovat.
const C='alaw-b7006a041d40',F=['index.html', 'manifest.webmanifest', 'css/app.css', 'js/ai.js', 'js/app.js', 'js/audioprep.js', 'js/bip39.js', 'js/book.js', 'js/bulk.js', 'js/compare.js', 'js/db.js', 'js/drill.js', 'js/edit.js', 'js/help.js', 'js/i18n-en.js', 'js/i18n.js', 'js/learn.js', 'js/lesson.js', 'js/loudness.js', 'js/model.js', 'js/net.js', 'js/player.js', 'js/qr.js', 'js/radio.js', 'js/search.js', 'js/song.js', 'js/sources.js', 'js/stage.js', 'js/store.js', 'js/stt.js', 'js/sync.js', 'js/syncui.js', 'js/tapsync.js', 'js/ui.js', 'js/versions.js', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(C).then(c=>c.addAll(['./',...F])));self.skipWaiting()});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!==C).map(x=>caches.delete(x)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',e=>{const r=e.request;if(r.method!=='GET'||new URL(r.url).origin!==location.origin)return;
  e.respondWith(fetch(r).then(x=>{if(x.ok){const y=x.clone();caches.open(C).then(c=>c.put(r,y))}return x})
    .catch(()=>caches.match(r,{ignoreSearch:true}).then(x=>x||caches.match('index.html'))))});
