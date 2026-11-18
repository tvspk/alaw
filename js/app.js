// Alaw – texty písní a jejich učení. Vstupní bod: směrování mezi obrazovkami, knihovna, nastavení.
import { el, iconBtn, ICONS, toast, download, pickFile, fileSize } from './ui.js';
import { listSongs, getSong, putAudioBlob, getAudioBlob, getPrefs, setPrefs } from './store.js';
import { db, requestPersistence, storageEstimate } from './db.js';
import { primaryVersion, isSynced, langLabel, fold, songsFromJson, looksLikeLrc } from './model.js';
import { renderSong } from './song.js';
import { renderEdit } from './edit.js';
import { renderTapSync } from './tapsync.js';
import { isAndroid, request } from './net.js';
import { aiConfig, setAiConfig, pickModel } from './ai.js';

export const APP_VERSION = '0.2.1';
const app = document.getElementById('app');
let cleanup = null;
let pendingDraft = null; // text načtený ze souboru pro formulář nové písně

// Hloubka v historii (kolik obrazovek aplikace je za námi) se drží v history.state, aby „Zpět“
// vedlo na předchozí obrazovku a z první obrazovky na knihovnu, nikdy ven z aplikace.
const depth = () => (history.state && history.state.d) || 0;
const nav = {
  go(hash) { history.pushState({ d: depth() + 1 }, '', hash); route(); },
  replace(hash) { history.replaceState({ d: depth() }, '', hash); route(); },
  back() { if (depth() > 0) history.back(); else nav.replace('#/'); },
  home() { if (depth() > 0) history.go(-depth()); else nav.replace('#/'); },
};

async function route() {
  if (cleanup) { try { cleanup(); } catch { /* nic */ } cleanup = null; }
  document.querySelectorAll('.sheet-backdrop').forEach(n => n.remove());
  const root = el('div');
  const [, view, id] = (location.hash.replace(/^#\/?/, '').match(/^([^/]*)\/?(.*)$/) || []);
  try {
    if (view === 'song' && id) cleanup = await renderSong(root, decodeURIComponent(id), nav);
    else if (view === 'edit' && id) cleanup = await renderEdit(root, decodeURIComponent(id), nav);
    else if (view === 'new') { cleanup = await renderEdit(root, null, nav, pendingDraft); pendingDraft = null; }
    else if (view === 'sync' && id) cleanup = await renderTapSync(root, decodeURIComponent(id), nav);
    else if (view === 'settings') cleanup = await renderSettings(root);
    else cleanup = await renderLibrary(root);
  } catch (e) {
    console.error(e);
    root.replaceChildren(el('div', { class: 'view' }, el('p', { class: 'empty', text: `Něco se pokazilo: ${e.message || e}` })));
  }
  app.replaceChildren(root);
  scrollTo(0, 0);
}

window.addEventListener('popstate', () => { route(); });
// odkazy uvnitř aplikace (href="#/…") přes nav, ať se drží hloubka historie
document.addEventListener('click', e => {
  const a = e.target.closest('a[href^="#/"]');
  if (!a || e.defaultPrevented) return;
  e.preventDefault();
  nav.go(a.getAttribute('href'));
});

// ---------- knihovna ----------

let libState = { q: '', tag: null };

async function renderLibrary(root) {
  const songs = await listSongs();
  const tags = [...new Set(songs.flatMap(s => s.tags))].sort((a, b) => a.localeCompare(b, 'cs'));
  const langs = [...new Set(songs.map(s => s.language))];
  const filters = [...(langs.length > 1 ? langs.map(l => ({ key: `lang:${l}`, label: langLabel(l) })) : []), ...tags.map(t => ({ key: `tag:${t}`, label: `#${t}` }))];
  if (libState.tag && !filters.some(f => f.key === libState.tag)) libState.tag = null;

  const listEl = el('ul', { class: 'song-list' });
  const chipsEl = el('div', { class: 'chips' });
  const search = el('input', { class: 'search', type: 'search', placeholder: 'Hledat píseň nebo interpreta…', value: libState.q,
    oninput: () => { libState.q = search.value; draw(); } });

  function draw() {
    chipsEl.replaceChildren(
      el('button', { type: 'button', class: 'chip' + (!libState.tag ? ' on' : ''), text: 'Vše', onclick: () => { libState.tag = null; draw(); } }),
      ...filters.map(f => el('button', { type: 'button', class: 'chip' + (libState.tag === f.key ? ' on' : ''), text: f.label,
        onclick: () => { libState.tag = libState.tag === f.key ? null : f.key; draw(); } })));
    chipsEl.hidden = !filters.length;
    const q = fold(libState.q.trim());
    const shown = songs.filter(s => {
      if (libState.tag?.startsWith('lang:') && s.language !== libState.tag.slice(5)) return false;
      if (libState.tag?.startsWith('tag:') && !s.tags.includes(libState.tag.slice(4))) return false;
      if (!q) return true;
      return fold(`${s.title} ${s.artist} ${s.tags.join(' ')}`).includes(q) || fold(primaryVersion(s).lines.map(l => l.text).join(' ')).includes(q);
    });
    listEl.replaceChildren(...shown.map(s => {
      const v = primaryVersion(s);
      return el('li', {}, el('a', { class: 'song-card', href: `#/song/${encodeURIComponent(s.id)}`, onclick: e => { e.preventDefault(); nav.go(`#/song/${encodeURIComponent(s.id)}`); } },
        el('div', { class: 'meta' }, el('div', { class: 'title', text: s.title }), el('div', { class: 'artist', text: s.artist || '—' })),
        el('div', { class: 'badges' },
          isSynced(v) ? el('span', { class: 'badge', title: 'Načasováno', text: '⏱' }) : null,
          v.audio ? el('span', { class: 'badge', title: 'Vlastní nahrávka', text: '♪' }) : null,
          v.youtubeId ? el('span', { class: 'badge', title: 'YouTube', text: '▶' }) : null)));
    }));
    if (!songs.length) {
      listEl.replaceChildren(el('li', { class: 'empty' },
        el('strong', { text: 'Croeso!' }),
        'Zatím tu žádná píseň není. Přidej první tlačítkem dole, nebo načti zálohu či JSON v ',
        el('a', { href: '#/settings', text: 'Nastavení' }), '.'));
    } else if (!shown.length) listEl.replaceChildren(el('li', { class: 'empty', text: 'Nic neodpovídá hledání.' }));
  }

  root.append(el('div', { class: 'view' },
    el('header', { class: 'topbar' }, el('h1', { class: 'brand', text: 'Alaw' }), iconBtn('settings', 'Nastavení', () => nav.go('#/settings'))),
    songs.length > 4 || libState.q ? search : null,
    chipsEl, listEl),
    el('button', { type: 'button', class: 'fab', html: `${ICONS.plus}<span>Přidat píseň</span>`, onclick: () => nav.go('#/new') }));
  root.querySelector('.fab svg').setAttribute('width', '22');
  draw();
}

// ---------- nastavení a záloha ----------

// data: URL → Blob bez fetch (CSP povoluje síť jen na GitHub)
function dataUrlToBlob(dataUrl) {
  const [head, b64] = dataUrl.split(',');
  const type = (head.match(/^data:([^;]+)/) || [])[1] || 'application/octet-stream';
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}

const blobToDataUrl = blob => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(blob); });

async function exportAll(withAudio) {
  const songs = await listSongs();
  const audio = {};
  if (withAudio) {
    for (const s of songs) for (const v of s.versions) if (v.audio) {
      const blob = await getAudioBlob(v.audio.key);
      if (blob) audio[v.audio.key] = await blobToDataUrl(blob);
    }
  }
  const data = { app: 'alaw', v: 1, exportedAt: new Date().toISOString(), songs, audio };
  const date = new Date().toISOString().slice(0, 10);
  download(`alaw-zaloha-${date}.json`, JSON.stringify(data));
  toast(`Záloha: ${songs.length} písní${withAudio ? `, ${Object.keys(audio).length} nahrávek` : ''}`);
}

async function importFile() {
  const file = await pickFile('.json,.lrc,.txt,application/json,text/plain');
  if (!file) return;
  const text = await file.text();
  if (!/\.json$/i.test(file.name) && !text.trim().startsWith('{') && !text.trim().startsWith('[')) {
    // prostý text nebo LRC → formulář nové písně s předvyplněným textem
    const ti = text.match(/^\[ti:(.*)\]$/mi), ar = text.match(/^\[ar:(.*)\]$/mi);
    pendingDraft = { text: looksLikeLrc(text) ? text.split('\n').filter(l => !/^\[(ti|ar|al|by|length|offset|re|ve):/i.test(l.trim())).join('\n').trim() : text.trim(),
      title: ti ? ti[1].trim() : file.name.replace(/\.[^.]+$/, ''), artist: ar ? ar[1].trim() : '' };
    nav.go('#/new');
    return;
  }
  let parsed;
  try { parsed = songsFromJson(JSON.parse(text)); } catch { toast('Soubor nejde přečíst jako JSON.'); return; }
  if (!parsed.songs.length) { toast('V souboru jsem nenašel žádnou píseň.'); return; }
  let added = 0, updated = 0, skipped = 0, audioCount = 0;
  for (const s of parsed.songs) {
    const old = await getSong(s.id);
    if (old && old.updatedAt >= s.updatedAt) { skipped++; continue; }
    await db.putSong(s); // čas změny zůstane ze zálohy
    old ? updated++ : added++;
  }
  for (const [key, dataUrl] of Object.entries(parsed.audio)) {
    try { await putAudioBlob(key, dataUrlToBlob(dataUrl)); audioCount++; } catch { /* poškozená nahrávka */ }
  }
  const parts = [added && `${added} nových`, updated && `${updated} aktualizovaných`, skipped && `${skipped} beze změny`, audioCount && `${audioCount} nahrávek`].filter(Boolean);
  toast(`Načteno: ${parts.join(', ')}`, 4000);
  route();
}

async function renderSettings(root) {
  const prefs = getPrefs();
  const withAudio = el('input', { type: 'checkbox', checked: false });
  const est = await storageEstimate();
  const sizeOut = el('span', { text: `${Math.round(prefs.lyricSize * 100)} %` });
  const sizeIn = el('input', { type: 'range', min: 0.9, max: 1.8, step: 0.05, value: prefs.lyricSize, 'aria-label': 'Velikost textu písní',
    oninput: () => { setPrefs({ lyricSize: +sizeIn.value }); sizeOut.textContent = `${Math.round(+sizeIn.value * 100)} %`; document.documentElement.style.setProperty('--lyric-size', `${sizeIn.value}rem`); preview.style.fontSize = `${sizeIn.value}rem`; } });
  const preview = el('div', { class: 'lyric' }, el('div', { class: 'body' }, el('div', { class: 'text', style: { fontSize: `${prefs.lyricSize}rem` }, text: 'Ar lan y môr mae rhosys cochion' })));
  const autoScroll = el('input', { type: 'checkbox', checked: prefs.autoScroll, onchange: () => setPrefs({ autoScroll: autoScroll.checked }) });

  root.append(el('div', { class: 'view' },
    el('header', { class: 'topbar' }, iconBtn('back', 'Zpět', () => nav.back()), el('h1', { text: 'Nastavení' })),
    el('section', { class: 'section' },
      el('h2', { text: 'Zobrazení' }),
      el('label', { class: 'range' }, 'Velikost textu', sizeIn, sizeOut),
      preview,
      el('label', { class: 'check', style: { marginTop: '10px' } }, autoScroll, el('span', { text: 'Při přehrávání posouvat text na aktuální verš' }))),
    el('section', { class: 'section' },
      el('h2', { text: 'Záloha a import' }),
      el('p', { text: 'Záloha obsahuje všechny písně, překlady, poznámky a časy. Import přijme zálohu, píseň v JSON (i z projektu Lyrics Trainer), nebo text či .lrc soubor.' }),
      el('label', { class: 'check', style: { marginBottom: '12px' } }, withAudio, el('span', { text: 'Přiložit i zvukové soubory (záloha bude velká)' })),
      el('div', { class: 'row' },
        el('button', { type: 'button', class: 'btn', text: '⇩ Stáhnout zálohu', onclick: () => exportAll(withAudio.checked) }),
        el('button', { type: 'button', class: 'btn', text: '⇧ Načíst soubor', onclick: importFile }))),
    searchSection(),
    aiSection(),
    el('section', { class: 'section' },
      el('h2', { text: 'Synchronizace' }),
      el('p', { text: 'Šifrovaná synchronizace přes GitHub mezi telefonem a počítačem přijde v další verzi. Zatím se vše ukládá jen v tomto zařízení.' })),
    el('section', { class: 'section' },
      el('h2', { text: 'Úložiště' }),
      el('p', { text: est ? `Využito ${fileSize(est.usage || 0)} z dostupných ${fileSize(est.quota || 0)}.` : 'Prohlížeč velikost úložiště neuvádí.' })),
    el('p', { class: 'empty', style: { padding: '12px' }, text: `Alaw ${APP_VERSION}` })));
}

function searchSection() {
  if (isAndroid()) {
    return el('section', { class: 'section' }, el('h2', { text: 'Hledání textů' }),
      el('p', { text: 'V aplikaci pro Android hledá Alaw ve všech zdrojích přímo, prostředník není potřeba.' }));
  }
  const input = el('input', { type: 'url', value: getPrefs().proxyUrl || '', placeholder: 'https://alaw-proxy.….workers.dev', autocomplete: 'off' });
  const status = el('div', { class: 'ai-status' });
  return el('section', { class: 'section' },
    el('h2', { text: 'Hledání textů (prostředník)' }),
    el('p', { text: 'LRCLIB, Welsh Lyrics wiki, Wicidestun a We Learn Welsh fungují i bez něj. Pro ostatní weby (LyricsTranslate, Bandcamp, Genius, AZLyrics) potřebuje prohlížeč na počítači prostředníka na Cloudflare Workers. V telefonu (APK) potřeba není.' }),
    el('label', { class: 'field' }, el('span', { text: 'Adresa prostředníka' }), input),
    el('div', { class: 'row', style: { marginTop: '8px' } },
      el('button', { type: 'button', class: 'btn small', text: 'Uložit a vyzkoušet', onclick: async () => {
        const url = input.value.trim().replace(/\/+$/, '');
        if (url && !/^https:\/\/[\w.-]+\.workers\.dev$/.test(url) && !/^https:\/\//.test(url)) { status.textContent = 'Adresa musí začínat https://'; return; }
        setPrefs({ proxyUrl: url });
        if (!url) { status.textContent = 'Prostředník vypnutý.'; return; }
        status.textContent = 'Zkouším…';
        try { await request('https://lyricstranslate.com/en/language/welsh', { timeout: 15000 }); status.textContent = '✓ Funguje.'; }
        catch (e) { status.textContent = `Nefunguje: ${e.message}`; }
      } })),
    status);
}

function aiSection() {
  const cfg = aiConfig();
  const input = el('input', { type: 'password', value: cfg.key || '', placeholder: 'AQ.… nebo AIza…', autocomplete: 'off', spellcheck: false });
  const status = el('div', { class: 'ai-status', text: cfg.key ? `Model: ${cfg.model}` : '' });
  return el('section', { class: 'section' },
    el('h2', { text: 'Překlady pomocí AI (Gemini)' }),
    el('p', {}, 'Klíč získáš zdarma v ', el('a', { href: 'https://aistudio.google.com/apikey', target: '_blank', rel: 'noopener', text: 'Google AI Studiu' }),
      '. Uloží se jen v tomto zařízení – nezálohuje se a nesynchronizuje.'),
    el('label', { class: 'field' }, el('span', { text: 'Klíč API' }), input),
    el('div', { class: 'row', style: { marginTop: '8px' } },
      el('button', { type: 'button', class: 'btn small', text: 'Uložit a ověřit', onclick: async () => {
        const key = input.value.replace(/\s+/g, '');
        if (!key) { setAiConfig(null); status.textContent = 'Klíč smazán.'; return; }
        status.textContent = 'Ověřuji…';
        try { const model = await pickModel(key); setAiConfig({ key, model }); status.textContent = `✓ Funguje. Model: ${model}`; }
        catch (e) { status.textContent = e.message; }
      } }),
      cfg.key ? el('button', { type: 'button', class: 'btn small danger', text: 'Smazat klíč', onclick: () => { setAiConfig(null); input.value = ''; status.textContent = 'Klíč smazán.'; } }) : null),
    status);
}

// Sdílení z jiné aplikace (Android: „Sdílet → Alaw“): ?share-url=…&share-text=…&share-title=…
function takeShare() {
  const p = new URLSearchParams(location.search);
  if (!p.has('share-url') && !p.has('share-text')) return;
  const text = p.get('share-text') || '';
  const url = p.get('share-url') || (text.match(/https?:\/\/\S+/) || [])[0] || '';
  history.replaceState(null, '', location.pathname + '#/new');
  pendingDraft = url ? { shareUrl: url, title: '' } : { shareText: text, title: p.get('share-title') || '' };
}
window.alawShare = (url, text) => { // volá APK, když aplikace už běží
  const u = url || (String(text || '').match(/https?:\/\/\S+/) || [])[0] || '';
  pendingDraft = u ? { shareUrl: u } : { shareText: text || '' };
  if (location.hash === '#/new') route(); else nav.go('#/new');
};

// ---------- Android: tlačítko Zpět, barvy lišt, uložení souboru, nová verze ----------
window.alawBack = () => {
  const sheetEl = document.querySelector('.sheet-backdrop');
  if (sheetEl) { sheetEl.remove(); return true; }
  const overlay = document.querySelector('.overlay');
  if (overlay) { overlay.remove(); return true; }
  const view = location.hash.replace(/^#\/?/, '').split('/')[0];
  if (!view) return false;
  nav.back();
  return true;
};
window.alawSaved = ok => toast(ok ? 'Soubor uložen' : 'Soubor se nepodařilo uložit');

function syncBars() {
  if (!isAndroid() || !window.AlawAndroid.setBars) return;
  const dark = matchMedia('(prefers-color-scheme: dark)').matches;
  window.AlawAndroid.setBars(dark ? '#121614' : '#f5f2ea', !dark);
}

const newer = (a, b) => { // je verze a novější než b?
  const pa = String(a).split('.').map(n => parseInt(n, 10) || 0), pb = String(b).split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  return false;
};
async function checkUpdate() {
  if (!isAndroid() || !window.AlawAndroid.version) return;
  const st = getPrefs().update || {};
  const now = Date.now();
  let latest = st.latest;
  if (!st.checked || now - st.checked > 20 * 3600e3) {
    try {
      const r = await fetch('https://api.github.com/repos/tvspk/alaw/releases/latest', { headers: { Accept: 'application/vnd.github+json' } });
      if (r.ok) latest = ((await r.json()).tag_name || '').replace(/^v/, '');
    } catch { /* offline */ }
    setPrefs({ update: { ...st, checked: now, latest } });
  }
  const mine = window.AlawAndroid.version();
  if (!latest || !mine || !newer(latest, mine) || (st.later && now < st.later)) return;
  const bar = el('div', { class: 'update-bar' }, el('span', { text: `Nová verze Alaw ${latest}` }),
    el('button', { type: 'button', class: 'btn small primary', text: 'Stáhnout', onclick: () => window.AlawAndroid.open('https://github.com/tvspk/alaw/releases/latest/download/alaw.apk') }),
    el('button', { type: 'button', class: 'btn small', text: 'Později', onclick: () => { setPrefs({ update: { ...getPrefs().update, later: Date.now() + 24 * 3600e3 } }); bar.remove(); } }));
  document.body.append(bar);
}

// ---------- start ----------
syncBars();
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', syncBars);
setTimeout(checkUpdate, 2000);
takeShare();

if ('serviceWorker' in navigator && location.protocol !== 'file:' && !isAndroid()) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
requestPersistence();
document.documentElement.style.setProperty('--lyric-size', `${getPrefs().lyricSize}rem`);
route();
