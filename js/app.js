// Alaw – texty písní a jejich učení. Vstupní bod: směrování mezi obrazovkami, knihovna, nastavení.
import { el, fill, iconBtn, ICONS, toast, download, pickFile, fileSize, sheet } from './ui.js';
import { t, pl, lang, setLang, collate } from './i18n.js';
import { listSongs, getSong, putAudioBlob, getAudioBlob, getPrefs, setPrefs, getProgress, deleteSong } from './store.js';
import { db, requestPersistence, storageEstimate } from './db.js';
import { primaryVersion, isSynced, langLabel, fold, songsFromJson, looksLikeLrc } from './model.js';
import { renderSong } from './song.js';
import { renderEdit } from './edit.js';
import { renderTapSync } from './tapsync.js';
import { renderLesson } from './lesson.js';
import { renderDrill } from './drill.js';
import { renderCompare } from './compare.js';
import { songUnits, songSummary, normalizeRec, recWins, EXERCISES } from './learn.js';
import { isAndroid, request } from './net.js';
import { aiConfig, setAiConfig, pickModel } from './ai.js';
import { boot as syncBoot, changed as syncChanged } from './sync.js';
import { syncSection } from './syncui.js';
import { renderBulk, renderFindLyrics, songsWithoutText, applyLyrics } from './bulk.js';
import { importFromUrl, showPreview } from './search.js';
import { cleanText } from './sources.js';
import { groqKey, setGroqKey, checkGroq, availableEngines, defaultEngine, ENGINES } from './stt.js';

export const APP_VERSION = '0.10.0';
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
    else if (view === 'version' && id) { const [sid, vid] = id.split('/'); cleanup = await renderEdit(root, decodeURIComponent(sid), nav, null, decodeURIComponent(vid || 'new')); }
    else if (view === 'compare' && id) { const [sid, vid, li] = id.split('/'); cleanup = await renderCompare(root, decodeURIComponent(sid), vid ? decodeURIComponent(vid) : null, li ? +li : null, nav); }
    else if (view === 'drill' && id) { const [sid, m] = id.split('/'); cleanup = await renderDrill(root, decodeURIComponent(sid), m, nav); }
    else if (view === 'learn' && id) { const [sid, k] = id.split('/'); cleanup = await renderLesson(root, decodeURIComponent(sid), k ? decodeURIComponent(k) : null, nav); }
    else if (view === 'bulk') cleanup = await renderBulk(root, nav);
    else if (view === 'lyrics') cleanup = await renderFindLyrics(root, nav);
    else if (view === 'settings') cleanup = await renderSettings(root);
    else cleanup = await renderLibrary(root);
  } catch (e) {
    console.error(e);
    root.replaceChildren(el('div', { class: 'view' }, el('p', { class: 'empty', text: t('Něco se pokazilo: {e}', { e: e.message || e }) })));
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

let libState = { q: '', tag: null, sel: null }; // sel = Set id písní v režimu výběru (hromadné mazání)

async function renderLibrary(root) {
  const songs = await listSongs();
  const progress = await getProgress();
  const now = Date.now();
  const sums = new Map(songs.map(s => [s.id, songSummary(songUnits(s), progress.get(s.id) || new Map(), now)]));
  const tags = [...new Set(songs.flatMap(s => s.tags))].sort(collate);
  const langs = [...new Set(songs.map(s => s.language))];
  const filters = [...(langs.length > 1 ? langs.map(l => ({ key: `lang:${l}`, label: langLabel(l) })) : []), ...tags.map(t => ({ key: `tag:${t}`, label: `#${t}` }))];
  if (libState.tag && !filters.some(f => f.key === libState.tag)) libState.tag = null;

  const listEl = el('ul', { class: 'song-list' });
  const chipsEl = el('div', { class: 'chips' });
  const search = el('input', { class: 'search', type: 'search', placeholder: t('Hledat píseň nebo interpreta…'), value: libState.q,
    oninput: () => { libState.q = search.value; draw(); } });
  if (libState.sel) libState.sel = new Set([...libState.sel].filter(id => songs.some(s => s.id === id)));
  let shown = [];
  const selBar = el('div', { class: 'bulk-foot sel-bar' });
  const selMode = on => { libState.sel = on ? new Set() : null; route(); };
  function drawSel() {
    const sel = libState.sel;
    selBar.hidden = !sel;
    if (!sel) return;
    const allOn = shown.length && shown.every(s => sel.has(s.id));
    fill(selBar,
      el('div', { class: 'bulk-sum', text: t('Označeno {n} z {m}', { n: sel.size, m: songs.length }) }),
      el('div', { class: 'row end' },
        el('button', { type: 'button', class: 'btn', text: allOn ? t('Zrušit označení') : t('Označit zobrazené ({n})', { n: shown.length }), onclick: () => {
          for (const s of shown) allOn ? sel.delete(s.id) : sel.add(s.id);
          draw();
        } }),
        el('button', { type: 'button', class: 'btn', text: t('Hotovo'), onclick: () => selMode(false) }),
        el('button', { type: 'button', class: 'btn danger', text: t('🗑 Smazat ({n})', { n: sel.size }), disabled: !sel.size, onclick: removeSelected })));
  }
  async function removeSelected() {
    const list = songs.filter(s => libState.sel.has(s.id));
    if (!list.length) return;
    const n = list.length;
    if (!confirm(pl(n, 'Smazat {n} píseň včetně nahrávek a pokroku učení? Smaže se i na ostatních zařízeních a nejde to vrátit.', 'Smazat {n} písně včetně nahrávek a pokroku učení? Smaže se i na ostatních zařízeních a nejde to vrátit.', 'Smazat {n} písní včetně nahrávek a pokroku učení? Smaže se i na ostatních zařízeních a nejde to vrátit.'))) return;
    let done = 0;
    for (const s of list) {
      try { await deleteSong(s); done++; } catch (e) { console.error(e); }
      if (done % 10 === 0) toast(t('Mažu… {d}/{n}', { d: done, n }));
    }
    toast(pl(done, 'Smazáno: {n} píseň', 'Smazáno: {n} písně', 'Smazáno: {n} písní'), 3500);
    libState.sel = null;
    route();
  }

  function draw() {
    chipsEl.replaceChildren(
      el('button', { type: 'button', class: 'chip' + (!libState.tag ? ' on' : ''), text: t('Vše'), onclick: () => { libState.tag = null; draw(); } }),
      ...filters.map(f => el('button', { type: 'button', class: 'chip' + (libState.tag === f.key ? ' on' : ''), text: f.label,
        onclick: () => { libState.tag = libState.tag === f.key ? null : f.key; draw(); } })));
    chipsEl.hidden = !filters.length;
    const q = fold(libState.q.trim());
    shown = songs.filter(s => {
      if (libState.tag?.startsWith('lang:') && s.language !== libState.tag.slice(5)) return false;
      if (libState.tag?.startsWith('tag:') && !s.tags.includes(libState.tag.slice(4))) return false;
      if (!q) return true;
      return fold(`${s.title} ${s.artist} ${s.tags.join(' ')}`).includes(q) || fold(primaryVersion(s).lines.map(l => l.text).join(' ')).includes(q);
    });
    const sel = libState.sel;
    listEl.replaceChildren(...shown.map(s => {
      const v = primaryVersion(s);
      return el('li', {}, el('a', { class: 'song-card' + (sel && sel.has(s.id) ? ' selected' : ''), href: `#/song/${encodeURIComponent(s.id)}`, onclick: e => {
        e.preventDefault();
        if (!sel) { nav.go(`#/song/${encodeURIComponent(s.id)}`); return; }
        sel.has(s.id) ? sel.delete(s.id) : sel.add(s.id);
        draw();
      } },
        sel ? el('input', { type: 'checkbox', class: 'sel-box', checked: sel.has(s.id), tabindex: -1, 'aria-label': t('Označit') }) : null,
        el('div', { class: 'meta' }, el('div', { class: 'title', text: s.title }), el('div', { class: 'artist', text: s.artist || '—' })),
        el('div', { class: 'badges' },
          isSynced(v) ? el('span', { class: 'badge', title: t('Načasováno'), text: '⏱' }) : null,
          v.audio ? el('span', { class: 'badge', title: t('Vlastní nahrávka'), text: '♪' }) : null,
          v.youtubeId ? el('span', { class: 'badge', title: 'YouTube', text: '▶' }) : null),
        learnBar(sums.get(s.id))));
    }));
    if (!songs.length) {
      listEl.replaceChildren(el('li', { class: 'empty' },
        el('strong', { text: 'Croeso!' }),
        t('Zatím tu žádná píseň není. Přidej první tlačítkem dole, '),
        el('a', { href: '#/bulk', text: t('přidej víc písní z nahrávek najednou') }),
        t(', nebo načti zálohu či JSON v '), el('a', { href: '#/settings', text: t('Nastavení') }), '.'));
    } else if (!shown.length) listEl.replaceChildren(el('li', { class: 'empty', text: t('Nic neodpovídá hledání.') }));
    drawSel();
  }

  root.append(el('div', { class: 'view' },
    el('header', { class: 'topbar' }, el('h1', { class: 'brand', text: 'Alaw' }),
      langSwitch(),
      songs.length ? el('button', { type: 'button', class: 'icon-btn sel-toggle' + (libState.sel ? ' on' : ''), title: t('Vybrat víc písní (smazat)'), 'aria-label': t('Vybrat víc písní'), text: '☑', onclick: () => selMode(!libState.sel) }) : null,
      iconBtn('settings', t('Nastavení'), () => nav.go('#/settings'))),
    reminders(songs, progress, sums),
    noTextBar(songs),
    songs.length > 4 || libState.q ? search : null,
    chipsEl, listEl, selBar),
    ...(libState.sel ? [] : [el('button', { type: 'button', class: 'fab', html: `${ICONS.plus}<span>${t('Přidat píseň')}</span>`, onclick: () => nav.go('#/new') })]));
  root.querySelector('.fab svg')?.setAttribute('width', '22');
  draw();
}

// Přepínač jazyka rozhraní na hlavní stránce (CZ | EN), volba jen pro toto zařízení.
function langSwitch() {
  const b = (code, label, name) => el('button', { type: 'button', class: lang === code ? 'on' : '', text: label, lang: code,
    'aria-pressed': String(lang === code), title: name, onclick: () => { if (lang !== code) setLang(code); } });
  return el('div', { class: 'lang-switch', role: 'group', 'aria-label': 'Jazyk / Language' },
    b('cs', 'CZ', 'Čeština'), b('en', 'EN', 'English'));
}

// Písně bez textu (typicky po přidání z nahrávek) → hledání textů.
function noTextBar(songs) {
  const n = songsWithoutText(songs);
  if (!n) return null;
  return el('div', { class: 'reminders' }, el('div', { class: 'reminder' },
    el('a', { href: '#/lyrics', text: pl(n, '{n} píseň nemá text – najít texty', '{n} písně nemají text – najít texty', '{n} písní nemá text – najít texty') })));
}

// Proužek pokroku na kartě písně (jen u písní, které se učím).
function learnBar(sum) {
  if (!sum || !sum.total || sum.new === sum.total) return null;
  const pct = n => `${(100 * n / sum.total).toFixed(1)}%`; // CSS, ne text
  return el('div', { class: 'lbar', title: t('Umíš {n} z {m} veršů', { n: sum.known + sum.due, m: sum.total }) },
    el('i', { class: 'known', style: { width: pct(sum.known) } }),
    el('i', { class: 'due', style: { width: pct(sum.due) } }),
    el('i', { class: 'learn', style: { width: pct(sum.learn) } }));
}

// Nenápadná připomínka (rozhodnutí zadavatele: učí se vždy jednu píseň, ostatní jen občas připomenout):
// písně kromě té, kterou se teď učím (naposledy procvičovaná), kde verše začínají slábnout. Jde skrýt na týden.
function reminders(songs, progress, sums) {
  const last = id => Math.max(0, ...[...(progress.get(id) || new Map()).values()].map(r => r.last || 0));
  const current = songs.map(s => s.id).sort((a, b) => last(b) - last(a))[0];
  const hidden = getPrefs().remindHidden || {};
  const now = Date.now();
  const list = songs.filter(s => s.id !== current && sums.get(s.id).due > 0 && !(hidden[s.id] > now)).slice(0, 2);
  if (!list.length) return null;
  return el('div', { class: 'reminders' }, list.map(s => {
    const n = sums.get(s.id).due;
    const box = el('div', { class: 'reminder' },
      el('a', { href: `#/learn/${encodeURIComponent(s.id)}`, text: pl(n, '„{t}“ by chtěla zopakovat ({n} verš)', '„{t}“ by chtěla zopakovat ({n} verše)', '„{t}“ by chtěla zopakovat ({n} veršů)', { t: s.title }) }),
      el('button', { type: 'button', class: 'icon-btn', 'aria-label': t('Skrýt na týden'), title: t('Skrýt na týden'), text: '✕', onclick: () => {
        setPrefs({ remindHidden: { ...Object.fromEntries(Object.entries(getPrefs().remindHidden || {}).filter(([, t]) => t > Date.now())), [s.id]: Date.now() + 7 * 86400e3 } });
        box.remove();
      } }));
    return box;
  }));
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

const AUDIO_BACKUP_MAX = 300 * 1048576; // záloha je jeden JSON v paměti: se stovkami MB zvuku by prohlížeč spadl

async function exportAll(withAudio) {
  const songs = await listSongs();
  const audio = {};
  if (withAudio) {
    const total = songs.reduce((a, s) => a + s.versions.reduce((b, v) => b + (v.audio ? v.audio.size || 0 : 0), 0), 0);
    if (total > AUDIO_BACKUP_MAX) {
      if (!confirm(t('Nahrávky mají dohromady {s} – záloha s nimi by byla moc velká a aplikace by ji nezvládla. Stáhnout zálohu bez nahrávek? (Nahrávky máš v původních souborech a synchronizace je přenáší sama.)', { s: fileSize(total) }))) return;
      withAudio = false;
    }
  }
  if (withAudio) {
    for (const s of songs) for (const v of s.versions) if (v.audio) {
      const blob = await getAudioBlob(v.audio.key);
      if (blob) audio[v.audio.key] = await blobToDataUrl(blob);
    }
  }
  const progress = (await db.allProgress()).filter(r => songs.some(s => s.id === r.s));
  const data = { app: 'alaw', v: 1, exportedAt: new Date().toISOString(), songs, progress, audio };
  const date = new Date().toISOString().slice(0, 10);
  download(`alaw-${t('zaloha')}-${date}.json`, JSON.stringify(data));
  toast(pl(songs.length, 'Záloha: {n} píseň', 'Záloha: {n} písně', 'Záloha: {n} písní') + (withAudio ? ', ' + pl(Object.keys(audio).length, '{n} nahrávka', '{n} nahrávky', '{n} nahrávek') : ''));
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
  try { parsed = songsFromJson(JSON.parse(text)); } catch { toast(t('Soubor nejde přečíst jako JSON.')); return; }
  if (!parsed.songs.length) { toast(t('V souboru jsem nenašel žádnou píseň.')); return; }
  let added = 0, updated = 0, skipped = 0, audioCount = 0;
  for (const s of parsed.songs) {
    const old = await getSong(s.id);
    if (old && old.updatedAt >= s.updatedAt) { skipped++; continue; }
    await db.putSong(s); // čas změny zůstane ze zálohy
    old ? updated++ : added++;
  }
  // pokrok učení ze zálohy: po záznamech, naposledy změněný vyhrává
  const raw = JSON.parse(text);
  let progressCount = 0;
  if (raw && Array.isArray(raw.progress)) {
    const cur = new Map((await db.allProgress()).map(r => [r.id, r]));
    const take = raw.progress.map(normalizeRec).filter(r => r && recWins(r, cur.get(r.id)));
    if (take.length) { await db.putProgressMany(take); progressCount = take.length; }
  }
  syncChanged();
  for (const [key, dataUrl] of Object.entries(parsed.audio)) {
    try { await putAudioBlob(key, dataUrlToBlob(dataUrl)); audioCount++; } catch { /* poškozená nahrávka */ }
  }
  const parts = [added && t('{n} nových', { n: added }), updated && t('{n} aktualizovaných', { n: updated }), skipped && t('{n} beze změny', { n: skipped }), audioCount && pl(audioCount, '{n} nahrávka', '{n} nahrávky', '{n} nahrávek'), progressCount && t('pokrok {n} veršů', { n: progressCount })].filter(Boolean);
  toast(t('Načteno: {p}', { p: parts.join(', ') }), 4000);
  route();
}

async function renderSettings(root) {
  const prefs = getPrefs();
  const [syncEl, syncOff] = syncSection();
  const withAudio = el('input', { type: 'checkbox', checked: false });
  const est = await storageEstimate();
  const sizeOut = el('span', { text: `${Math.round(prefs.lyricSize * 100)} %` });
  const sizeIn = el('input', { type: 'range', min: 0.9, max: 1.8, step: 0.05, value: prefs.lyricSize, 'aria-label': t('Velikost textu písní'),
    oninput: () => { setPrefs({ lyricSize: +sizeIn.value }); sizeOut.textContent = `${Math.round(+sizeIn.value * 100)} %`; document.documentElement.style.setProperty('--lyric-size', `${sizeIn.value}rem`); preview.style.fontSize = `${sizeIn.value}rem`; } });
  const preview = el('div', { class: 'lyric' }, el('div', { class: 'body' }, el('div', { class: 'text', style: { fontSize: `${prefs.lyricSize}rem` }, text: 'Ar lan y môr mae rhosys cochion' })));
  const autoScroll = el('input', { type: 'checkbox', checked: prefs.autoScroll, onchange: () => setPrefs({ autoScroll: autoScroll.checked }) });

  root.append(el('div', { class: 'view' },
    el('header', { class: 'topbar' }, iconBtn('back', t('Zpět'), () => nav.back()), el('h1', { text: t('Nastavení') })),
    el('section', { class: 'section' },
      el('h2', { text: t('Zobrazení') }),
      el('label', { class: 'range' }, t('Velikost textu'), sizeIn, sizeOut),
      preview,
      el('label', { class: 'check', style: { marginTop: '10px' } }, autoScroll, el('span', { text: t('Při přehrávání posouvat text na aktuální verš') }))),
    learnSection(),
    el('section', { class: 'section' },
      el('h2', { text: t('Záloha a import') }),
      el('p', { text: t('Záloha obsahuje všechny písně, překlady, poznámky, časy a pokrok učení. Import přijme zálohu, píseň v JSON (i z projektu Lyrics Trainer), nebo text či .lrc soubor.') }),
      el('label', { class: 'check', style: { marginBottom: '12px' } }, withAudio, el('span', { text: t('Přiložit i zvukové soubory (záloha bude velká)') })),
      el('div', { class: 'row' },
        el('button', { type: 'button', class: 'btn', text: t('⇩ Stáhnout zálohu'), onclick: () => exportAll(withAudio.checked) }),
        el('button', { type: 'button', class: 'btn', text: t('⇧ Načíst soubor'), onclick: importFile })),
      el('p', { style: { marginTop: '14px' }, text: t('Máš nahrávky písní ve složce? Přidej je všechny najednou, texty pak dohledáš.') }),
      el('div', { class: 'row' }, el('button', { type: 'button', class: 'btn', text: t('♪ Přidat písně z nahrávek'), onclick: () => nav.go('#/bulk') }))),
    searchSection(),
    aiSection(),
    sttSection(),
    syncEl,
    el('section', { class: 'section' },
      el('h2', { text: t('Úložiště') }),
      el('p', { text: est ? t('Využito {u} z dostupných {q}.', { u: fileSize(est.usage || 0), q: fileSize(est.quota || 0) }) : t('Prohlížeč velikost úložiště neuvádí.') })),
    el('p', { class: 'empty', style: { padding: '12px' }, text: `Alaw ${APP_VERSION}` })));
  if (location.hash.includes('sync')) setTimeout(() => syncEl.scrollIntoView({ block: 'start' }), 50);
  return syncOff;
}

function learnSection() {
  const p = getPrefs();
  const out = el('span', { text: String(p.newPerDay) });
  const perDay = el('input', { type: 'range', min: 2, max: 20, step: 1, value: p.newPerDay, 'aria-label': t('Nových veršů denně'),
    oninput: () => { setPrefs({ newPerDay: +perDay.value }); out.textContent = perDay.value; } });
  const auto = el('input', { type: 'checkbox', checked: p.autoPlayLine, onchange: () => setPrefs({ autoPlayLine: auto.checked }) });
  const type = el('input', { type: 'checkbox', checked: p.alwaysType, onchange: () => setPrefs({ alwaysType: type.checked }) });
  return el('section', { class: 'section' },
    el('h2', { text: t('Učení') }),
    el('p', { text: t('Pokrok se ukládá po verších a synchronizuje se. Tato nastavení platí jen v tomto zařízení.') }),
    el('label', { class: 'range' }, t('Nových veršů denně'), perDay, out),
    el('label', { class: 'check', style: { marginTop: '10px' } }, auto, el('span', { text: t('Při učení přehrát verš (když je načasovaný)') })),
    el('label', { class: 'check', style: { marginTop: '8px' } }, type, el('span', { text: t('Vždy psát zpaměti (i u veršů, které se teprve učím)') })),
    el('h2', { text: t('Cvičení v lekci'), style: { marginTop: '16px' } }),
    el('p', { text: t('Aplikace je střídá sama podle toho, jak verš umíš. Která ti nevyhovují, vypni.') }),
    el('div', { class: 'ex-list' }, EXERCISES.map(([k, label]) => {
      const box = el('input', { type: 'checkbox', checked: !(getPrefs().exOff || {})[k], onchange: () => setPrefs({ exOff: { ...(getPrefs().exOff || {}), [k]: !box.checked } }) });
      return el('label', { class: 'check' }, box, el('span', { text: label }));
    })));
}

function searchSection() {
  if (isAndroid()) {
    return el('section', { class: 'section' }, el('h2', { text: t('Hledání textů') }),
      el('p', { text: t('V aplikaci pro Android hledá Alaw ve všech zdrojích přímo, prostředník není potřeba.') }));
  }
  const input = el('input', { type: 'url', value: getPrefs().proxyUrl || '', placeholder: 'https://alaw-proxy.….workers.dev', autocomplete: 'off' });
  const status = el('div', { class: 'ai-status' });
  return el('section', { class: 'section' },
    el('h2', { text: t('Hledání textů (prostředník)') }),
    el('p', { text: t('LRCLIB, Welsh Lyrics wiki, Wicidestun a We Learn Welsh fungují i bez něj. Pro ostatní weby (LyricsTranslate, Bandcamp, Genius, AZLyrics) potřebuje prohlížeč na počítači prostředníka na Cloudflare Workers. V telefonu (APK) potřeba není.') }),
    el('label', { class: 'field' }, el('span', { text: t('Adresa prostředníka') }), input),
    el('div', { class: 'row', style: { marginTop: '8px' } },
      el('button', { type: 'button', class: 'btn small', text: t('Uložit a vyzkoušet'), onclick: async () => {
        const url = input.value.trim().replace(/\/+$/, '');
        if (url && !/^https:\/\/[\w.-]+\.workers\.dev$/.test(url) && !/^https:\/\//.test(url)) { status.textContent = t('Adresa musí začínat https://'); return; }
        setPrefs({ proxyUrl: url });
        if (!url) { status.textContent = t('Prostředník vypnutý.'); return; }
        status.textContent = t('Zkouším…');
        try { await request('https://lyricstranslate.com/en/language/welsh', { timeout: 15000 }); status.textContent = t('✓ Funguje.'); }
        catch (e) { status.textContent = t('Nefunguje: {e}', { e: e.message }); }
      } })),
    status);
}

function aiSection() {
  const cfg = aiConfig();
  const input = el('input', { type: 'password', value: cfg.key || '', placeholder: t('AQ.… nebo AIza…'), autocomplete: 'off', spellcheck: false });
  const status = el('div', { class: 'ai-status', text: cfg.key ? t('Model: {m}', { m: cfg.model }) : '' });
  return el('section', { class: 'section' },
    el('h2', { text: t('Překlady pomocí AI (Gemini)') }),
    el('p', {}, t('Klíč získáš zdarma v '), el('a', { href: 'https://aistudio.google.com/apikey', target: '_blank', rel: 'noopener', text: t('Google AI Studiu') }),
      t('. Uloží se jen v tomto zařízení – nezálohuje se a nesynchronizuje.')),
    el('label', { class: 'field' }, el('span', { text: t('Klíč API') }), input),
    el('div', { class: 'row', style: { marginTop: '8px' } },
      el('button', { type: 'button', class: 'btn small', text: t('Uložit a ověřit'), onclick: async () => {
        const key = input.value.replace(/\s+/g, '');
        if (!key) { setAiConfig(null); status.textContent = t('Klíč smazán.'); return; }
        status.textContent = t('Ověřuji…');
        try { const picked = await pickModel(key); setAiConfig({ key, ...picked }); status.textContent = t('✓ Funguje. Model: {m}', { m: picked.model }); }
        catch (e) { status.textContent = e.message; }
      } }),
      cfg.key ? el('button', { type: 'button', class: 'btn small danger', text: t('Smazat klíč'), onclick: () => { setAiConfig(null); input.value = ''; status.textContent = t('Klíč smazán.'); } }) : null),
    status);
}

function sttSection() {
  const input = el('input', { type: 'password', value: groqKey(), placeholder: 'gsk_…', autocomplete: 'off', spellcheck: false });
  const status = el('div', { class: 'ai-status' });
  const choice = el('div', {});
  function drawChoice() {
    const av = availableEngines();
    if (av.length < 2) { fill(choice, el('p', { class: 'hint', text: av.length ? t('Přepisuje: {e}.', { e: ENGINES[av[0]].label }) : t('Zatím není nastavená žádná služba: vlož klíč Groq níže, nebo klíč Gemini výše.') })); return; }
    const sel = el('select', { onchange: () => setPrefs({ stt: sel.value }) }, av.map(k => el('option', { value: k, text: ENGINES[k].label })));
    sel.value = defaultEngine();
    fill(choice, el('label', { class: 'field' }, el('span', { text: t('Předvybraná služba (při přepisu se stejně zeptám)') }), sel));
  }
  drawChoice();
  return el('section', { class: 'section' },
    el('h2', { text: t('Přepis z nahrávky') }),
    el('p', {}, t('Text písně přepíše z vlastní nahrávky Gemini (klíč výše) nebo Whisper přes Groq – zdarma, bez platební karty. Klíč Groq získáš na '),
      el('a', { href: 'https://console.groq.com/keys', target: '_blank', rel: 'noopener', text: 'console.groq.com' }),
      t('. Uloží se jen v tomto zařízení. Přepis zpěvu nebývá přesný – obě služby můžeš porovnat.')),
    choice,
    el('label', { class: 'field' }, el('span', { text: t('Klíč Groq') }), input),
    el('div', { class: 'row', style: { marginTop: '8px' } },
      el('button', { type: 'button', class: 'btn small', text: t('Uložit a ověřit'), onclick: async () => {
        const key = input.value.replace(/\s+/g, '');
        if (!key) { setGroqKey(''); status.textContent = t('Klíč smazán.'); drawChoice(); return; }
        status.textContent = t('Ověřuji…');
        try { await checkGroq(key); setGroqKey(key); status.textContent = t('✓ Funguje.'); }
        catch (e) { status.textContent = e.message; }
        drawChoice();
      } }),
      groqKey() ? el('button', { type: 'button', class: 'btn small danger', text: t('Smazat klíč'), onclick: () => { setGroqKey(''); input.value = ''; status.textContent = t('Klíč smazán.'); drawChoice(); } }) : null),
    status);
}

// Sdílení z jiné aplikace (Android: „Sdílet → Alaw“): ?share-url=…&share-text=…&share-title=…
// Když se text k písni hledal na Googlu (search.js → prefs.shareTarget), nabídne se sdílená stránka k té písni.
const shareTarget = () => { const t = getPrefs().shareTarget; return t && t.id && Date.now() - t.t < 3 * 3600e3 ? t : null; };
let startShare = null;
function takeShare() {
  const p = new URLSearchParams(location.search);
  if (!p.has('share-url') && !p.has('share-text')) return;
  const text = p.get('share-text') || '';
  const url = p.get('share-url') || (text.match(/https?:\/\/\S+/) || [])[0] || '';
  const share = { url, text, title: p.get('share-title') || '' };
  if (shareTarget()) { history.replaceState(null, '', location.pathname + '#/'); startShare = share; return; }
  history.replaceState(null, '', location.pathname + '#/new');
  pendingDraft = url ? { shareUrl: url, title: '' } : { shareText: text, title: share.title };
}
function offerShare(share) {
  const tg = shareTarget();
  const asNew = () => {
    pendingDraft = share.url ? { shareUrl: share.url } : { shareText: share.text || '', title: share.title || '' };
    if (location.hash === '#/new') route(); else nav.go('#/new');
  };
  if (!tg) { asNew(); return; }
  const toSong = async () => {
    const target = await getSong(tg.id);
    if (!target) { toast(t('Píseň už neexistuje.')); setPrefs({ shareTarget: null }); asNew(); return; }
    if (primaryVersion(target).lines.length && !confirm(t('„{t}“ už text má. Nahradit ho (překlady a poznámky u veršů se ztratí)? Pro porovnání radši přidej verzi textu.', { t: target.title }))) return;
    const done = async d => {
      try { await applyLyrics(tg.id, d, true); setPrefs({ shareTarget: null }); toast(t('Text uložen')); nav.go(`#/song/${encodeURIComponent(tg.id)}`); }
      catch (e) { toast(e.message || t('Uložení se nepovedlo.')); }
    };
    if (share.url) importFromUrl(share.url, done);
    else showPreview({ text: cleanText(share.text || ''), source: 'sdílení' }, [], done);
  };
  sheet(close => el('div', {},
    el('h3', { text: t('Kam s textem?') }),
    el('div', { class: 'sub', text: share.url || t('Sdílený text') }),
    el('div', { class: 'row end' },
      el('button', { type: 'button', class: 'btn', text: t('Nová píseň'), onclick: () => { close(); setPrefs({ shareTarget: null }); asNew(); } }),
      el('button', { type: 'button', class: 'btn primary', text: t('K písni „{t}“', { t: tg.title }), onclick: () => { close(); toSong(); } }))));
}
window.alawShare = (url, text) => { // volá APK, když aplikace už běží
  const u = url || (String(text || '').match(/https?:\/\/\S+/) || [])[0] || '';
  offerShare({ url: u, text: u ? '' : text || '' });
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
window.alawSaved = ok => toast(ok ? t('Soubor uložen') : t('Soubor se nepodařilo uložit'));

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
  const bar = el('div', { class: 'update-bar' }, el('span', { text: t('Nová verze Alaw {v}', { v: latest }) }),
    el('button', { type: 'button', class: 'btn small primary', text: t('Stáhnout'), onclick: () => window.AlawAndroid.open('https://github.com/tvspk/alaw/releases/latest/download/alaw.apk') }),
    el('button', { type: 'button', class: 'btn small', text: t('Později'), onclick: () => { setPrefs({ update: { ...getPrefs().update, later: Date.now() + 24 * 3600e3 } }); bar.remove(); } }));
  document.body.append(bar);
}

// Po synchronizaci překreslit, co je na obrazovce – ale ne pod rukama (otevřená nabídka, formulář, časování, hledání).
window.addEventListener('alaw-synced', () => {
  const view = location.hash.replace(/^#\/?/, '').split('/')[0];
  if (document.querySelector('.sheet-backdrop, .overlay')) return;
  if (!view || view === 'song') { const y = scrollY; route().then(() => scrollTo(0, y)); }
});

// ---------- start ----------
syncBoot();
syncBars();
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', syncBars);
setTimeout(checkUpdate, 2000);
takeShare();

if ('serviceWorker' in navigator && location.protocol !== 'file:' && !isAndroid()) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
requestPersistence();
document.documentElement.style.setProperty('--lyric-size', `${getPrefs().lyricSize}rem`);
route().then(() => { if (startShare) { offerShare(startShare); startShare = null; } });
