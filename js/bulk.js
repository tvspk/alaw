// Hromadné přidání písní z nahrávek (#/bulk) a hledání textů k písním bez textu (#/lyrics).
// Z každé nahrávky vznikne píseň s nahrávkou, zatím bez textu. Název a interpret: z názvu souboru
// „Interpret - Název“, jinak z údajů uložených v souboru (ID3 v mp3, INFO ve wav), jinak název souboru.
// Texty pak hledá v LRCLIB podle názvu, interpreta a délky nahrávky; uloží se jen po potvrzení.
import { el, fill, iconBtn, toast, fileSize, pickFiles, pickFile, sheet } from './ui.js';
import { listSongs, getSong, saveSong, putAudioBlob, getAudioBlob } from './store.js';
import { LANGUAGES, newSong, newLine, newVersion, primaryVersion, parseLyrics, parseTags, fold, uid, attachAlt, isSynced, borrowTimes } from './model.js';
import { ENGINES, availableEngines, defaultEngine, engineName } from './stt.js';
import { MAX_VERSIONS, prune } from './versions.js';
import { SOURCES, similarity, loadFromUrl, cleanText } from './sources.js';
import { openSearch, showPreview } from './search.js';
import { isAndroid } from './net.js';
import { isOn as syncOn } from './sync.js';

export const AUDIO_EXT = /\.(mp3|m4a|aac|ogg|oga|opus|wav|flac|webm)$/i;
const AUDIO_ACCEPT = 'audio/*,.mp3,.m4a,.aac,.ogg,.oga,.opus,.wav,.flac,.webm';

// ---------- název a interpret ----------

// „01 - Interpret - Název.mp3“ → { artist, title }. Interpret jen při oddělovači s mezerami („ - “, „ – “),
// spojovníky uvnitř slov (Pen-y-bont) se nedělí.
export function nameFromFile(fileName) {
  let s = String(fileName || '').replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '').replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
  s = s.replace(/^\(?\d{1,3}\)?(?:\s*[-–—.)]\s*|\s+)(?=\S)/, '').trim(); // číslo stopy
  const m = s.match(/^(.+?)\s+[-–—]\s+(.+)$/);
  return m ? { artist: m[1].trim(), title: m[2].trim() } : { artist: '', title: s };
}

// Co použít: název souboru s interpretem > údaje v souboru > název souboru.
export function pickName(fileName, tags) {
  const f = nameFromFile(fileName);
  if (f.artist && f.title) return { ...f, from: 'file' };
  if (tags && tags.title) return { title: tags.title, artist: tags.artist || '', from: 'tags' };
  if (tags && tags.artist && f.title) return { title: f.title, artist: tags.artist, from: 'tags' };
  return { ...f, from: 'name' };
}

// ---------- údaje uložené v souboru (ID3v2, ID3v1, RIFF INFO) ----------

const syncsafe = (b, i) => ((b[i] & 0x7f) << 21) | ((b[i + 1] & 0x7f) << 14) | ((b[i + 2] & 0x7f) << 7) | (b[i + 3] & 0x7f);
const be32 = (b, i) => ((b[i] << 24) >>> 0) + (b[i + 1] << 16) + (b[i + 2] << 8) + b[i + 3];
const le32 = (b, i) => (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16)) + ((b[i + 3] << 24) >>> 0);
const ascii = (b, i, n) => String.fromCharCode(...b.subarray(i, i + n));
const clean = s => String(s || '').replace(/\0.*$/s, '').replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim();

function decodeText(enc, u8) {
  try {
    if (enc === 0) return new TextDecoder('windows-1252').decode(u8);
    if (enc === 3) return new TextDecoder('utf-8').decode(u8);
    if (enc === 2) return new TextDecoder('utf-16be').decode(u8);
    if (u8[0] === 0xfe && u8[1] === 0xff) return new TextDecoder('utf-16be').decode(u8.subarray(2));
    if (u8[0] === 0xff && u8[1] === 0xfe) return new TextDecoder('utf-16le').decode(u8.subarray(2));
    return new TextDecoder('utf-16le').decode(u8);
  } catch { return ''; }
}

// u8 začíná hlavičkou „ID3“.
export function parseId3v2(u8) {
  if (u8.length < 10 || ascii(u8, 0, 3) !== 'ID3') return null;
  const ver = u8[3], flags = u8[5], end = Math.min(u8.length, 10 + syncsafe(u8, 6));
  let pos = 10;
  if (flags & 0x40) pos += ver === 4 ? syncsafe(u8, 10) : 4 + be32(u8, 10);
  const want = ver === 2 ? { TT2: 'title', TP1: 'artist', TP2: 'band' } : { TIT2: 'title', TPE1: 'artist', TPE2: 'band' };
  const out = {};
  const idLen = ver === 2 ? 3 : 4, hLen = ver === 2 ? 6 : 10;
  while (pos + hLen <= end) {
    const id = ascii(u8, pos, idLen);
    if (!/^[A-Z0-9]+$/.test(id)) break; // výplň
    const size = ver === 2 ? (u8[pos + 3] << 16) | (u8[pos + 4] << 8) | u8[pos + 5] : ver === 4 ? syncsafe(u8, pos + 4) : be32(u8, pos + 4);
    if (size <= 0 || pos + hLen + size > end) break;
    if (want[id]) {
      const data = u8.subarray(pos + hLen, pos + hLen + size);
      out[want[id]] = clean(decodeText(data[0], data.subarray(1)).split('\0').find(Boolean));
    }
    pos += hLen + size;
  }
  const res = { title: out.title || '', artist: out.artist || out.band || '' };
  return res.title || res.artist ? res : null;
}

function parseId3v1(u8) {
  if (u8.length !== 128 || ascii(u8, 0, 3) !== 'TAG') return null;
  const d = new TextDecoder('windows-1252');
  const res = { title: clean(d.decode(u8.subarray(3, 33))), artist: clean(d.decode(u8.subarray(33, 63))) };
  return res.title || res.artist ? res : null;
}

// Kousek LIST/INFO z wav.
export function parseRiffInfo(u8) {
  if (ascii(u8, 0, 4) !== 'INFO') return null;
  const out = {};
  let pos = 4;
  while (pos + 8 <= u8.length) {
    const id = ascii(u8, pos, 4), size = le32(u8, pos + 4);
    if (pos + 8 + size > u8.length) break;
    if (id === 'INAM' || id === 'IART') out[id] = clean(new TextDecoder('utf-8').decode(u8.subarray(pos + 8, pos + 8 + size)));
    pos += 8 + size + (size & 1);
  }
  const res = { title: out.INAM || '', artist: out.IART || '' };
  return res.title || res.artist ? res : null;
}

const bytes = async (file, a, b) => new Uint8Array(await file.slice(a, b).arrayBuffer());

export async function readTags(file) {
  try {
    const head = await bytes(file, 0, 12);
    if (ascii(head, 0, 3) === 'ID3') {
      const size = syncsafe(head, 6);
      const t = parseId3v2(await bytes(file, 0, Math.min(10 + size, 2 << 20)));
      if (t) return t;
    }
    if (ascii(head, 0, 4) === 'RIFF' && ascii(head, 8, 4) === 'WAVE') {
      let pos = 12, res = null;
      for (let n = 0; n < 64 && pos + 8 <= file.size; n++) {
        const h = await bytes(file, pos, pos + 8);
        const id = ascii(h, 0, 4), size = le32(h, 4);
        if (size < 1 << 21 && (id === 'LIST' || id === 'id3 ' || id === 'ID3 ')) {
          const body = await bytes(file, pos + 8, pos + 8 + size);
          const t = id === 'LIST' ? parseRiffInfo(body) : parseId3v2(body);
          if (t) res = { title: res?.title || t.title, artist: res?.artist || t.artist };
        }
        pos += 8 + size + (size & 1);
      }
      return res;
    }
    if (file.size > 128) return parseId3v1(await bytes(file, file.size - 128, file.size));
  } catch { /* poškozený soubor – název ze jména souboru */ }
  return null;
}

// Délka nahrávky v sekundách (jen metadata, soubor se nepřehrává).
export function audioDuration(blob, timeout = 10000) {
  return new Promise(resolve => {
    const a = new Audio();
    const url = URL.createObjectURL(blob);
    let done = false;
    const end = v => { if (done) return; done = true; URL.revokeObjectURL(url); a.removeAttribute('src'); resolve(v); };
    a.preload = 'metadata';
    a.onloadedmetadata = () => end(Number.isFinite(a.duration) && a.duration > 0 ? a.duration : null);
    a.onerror = () => end(null);
    setTimeout(() => end(null), timeout);
    a.src = url;
  });
}

const mmss = s => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
const plural = (n, one, few, many) => `${n} ${n === 1 ? one : n >= 2 && n <= 4 ? few : many}`;

// ---------- obrazovka: přidat písně z nahrávek ----------

export async function renderBulk(root, nav) {
  const songs = await listSongs();
  const known = new Set(songs.map(s => fold(`${s.artist}|${s.title}`)));
  const knownAudio = new Set(songs.flatMap(s => s.versions.filter(v => v.audio).map(v => `${v.audio.name}|${v.audio.size}`)));
  let rows = [];        // { file, title, artist, from, on, dup }
  let busy = false;

  const lang = el('select', {}, LANGUAGES.map(([code, label]) => el('option', { value: code, text: label })));
  lang.value = 'cy';
  const tags = el('input', { autocomplete: 'off', placeholder: 'např. import, sbor' });
  const list = el('div', { class: 'bulk-list' });
  const summary = el('div', { class: 'bulk-sum' });
  const status = el('div', { class: 'hint', role: 'status' });
  const addBtn = el('button', { type: 'button', class: 'btn primary', text: 'Přidat', onclick: save });
  const footer = el('div', { class: 'bulk-foot', hidden: true }, summary, status, el('div', { class: 'row end' }, addBtn));

  async function take(files) {
    files = files.filter(f => AUDIO_EXT.test(f.name) || (f.type || '').startsWith('audio/'));
    if (!files.length) { toast('Nevybral jsi žádnou nahrávku.'); return; }
    const have = new Set(rows.map(r => `${r.file.name}|${r.file.size}`));
    files = files.filter(f => !have.has(`${f.name}|${f.size}`)).sort((a, b) => (a.webkitRelativePath || a.name).localeCompare(b.webkitRelativePath || b.name, 'cs'));
    status.textContent = 'Čtu názvy…';
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      if (i % 10 === 0) status.textContent = `Čtu názvy… ${i + 1}/${files.length}`;
      const n = pickName(f.name, await readTags(f));
      const dup = known.has(fold(`${n.artist}|${n.title}`)) || knownAudio.has(`${f.name}|${f.size}`);
      rows.push({ file: f, title: n.title, artist: n.artist, from: n.from, on: !dup, dup });
    }
    status.textContent = '';
    draw();
  }

  function draw() {
    list.replaceChildren(...rows.map(r => {
      const box = el('input', { type: 'checkbox', checked: r.on, 'aria-label': 'Přidat', onchange: () => { r.on = box.checked; sum(); } });
      const artist = el('input', { value: r.artist, placeholder: 'Interpret', 'aria-label': 'Interpret', oninput: () => { r.artist = artist.value; } });
      const title = el('input', { value: r.title, placeholder: 'Název', 'aria-label': 'Název', oninput: () => { r.title = title.value; } });
      const note = [r.file.webkitRelativePath || r.file.name, fileSize(r.file.size),
        r.dup ? 'už v knihovně' : r.from === 'tags' ? 'název z údajů v souboru' : !r.artist ? 'bez interpreta' : ''].filter(Boolean).join(' · ');
      return el('div', { class: 'bulk-row' + (r.dup ? ' dup' : '') + (!r.artist ? ' noartist' : '') }, box,
        el('div', { class: 'bulk-names' }, artist, title, el('div', { class: 'hint', text: note })));
    }));
    footer.hidden = !rows.length;
    sum();
  }

  function sum() {
    const on = rows.filter(r => r.on);
    const size = on.reduce((a, r) => a + r.file.size, 0);
    const noArtist = on.filter(r => !r.artist.trim()).length;
    fill(summary, 
      el('div', { text: `Vybráno ${on.length} z ${rows.length} · ${fileSize(size)}${noArtist ? ` · ${noArtist} bez interpreta (doplníš i později)` : ''}` }),
      syncOn() && size > 100 * 1048576 ? el('div', { class: 'hint', text: `Synchronizace pak nahraje ${fileSize(size)} do schránky na GitHubu a ostatní zařízení si nahrávky stáhnou celé. Poprvé to bude trvat dlouho, nech aplikaci otevřenou (na telefonu ideálně na Wi‑Fi).` }) : null);
    addBtn.textContent = on.length ? `Přidat ${plural(on.length, 'píseň', 'písně', 'písní')}` : 'Přidat';
    addBtn.disabled = !on.length || busy;
  }

  async function save() {
    const on = rows.filter(r => r.on);
    if (on.some(r => !r.title.trim())) { toast('Některá píseň nemá název.'); return; }
    busy = true; sum();
    const tagList = parseTags(tags.value);
    let done = 0;
    try {
      for (const r of on) {
        status.textContent = `Ukládám ${done + 1}/${on.length}: ${r.title}`;
        const key = uid(16);
        await putAudioBlob(key, r.file);
        const song = newSong({ title: r.title.trim(), artist: r.artist.trim(), language: lang.value, tags: tagList,
          versionExtra: { source: 'nahrávka', audio: { key, name: r.file.name, type: r.file.type || '', size: r.file.size } } });
        await saveSong(song);
        rows = rows.filter(x => x !== r);
        done++;
      }
    } catch (e) {
      busy = false;
      status.textContent = '';
      draw();
      toast(e && e.name === 'QuotaExceededError' ? `Došlo místo v úložišti. Přidáno ${done}, zbytek zůstal v seznamu.` : `Uložení se nepovedlo (přidáno ${done}).`, 5000);
      return;
    }
    busy = false;
    status.textContent = '';
    toast(`Přidáno: ${plural(done, 'píseň', 'písně', 'písní')}`, 3500);
    nav.replace('#/lyrics');
  }

  const pickBtns = [
    el('button', { type: 'button', class: 'btn primary', text: '♪ Vybrat nahrávky', onclick: async () => take(await pickFiles(AUDIO_ACCEPT)) }),
    !isAndroid() ? el('button', { type: 'button', class: 'btn', text: '📁 Vybrat celou složku', onclick: async () => take(await pickFiles(AUDIO_ACCEPT, { folder: true })) }) : null,
  ];

  root.append(el('div', { class: 'view' },
    el('header', { class: 'topbar' }, iconBtn('back', 'Zpět', () => nav.back()), el('h1', { text: 'Písně z nahrávek' })),
    el('section', { class: 'section' },
      el('p', { text: 'Z každé nahrávky vznikne píseň, zatím bez textu. Název a interpreta vezmu z názvu souboru ve tvaru „Interpret - Název“, jinak z údajů uložených v souboru. Před přidáním je můžeš opravit. Texty pak pomůžu najít.' }),
      el('div', { class: 'row' }, ...pickBtns),
      el('div', { class: 'row', style: { marginTop: '12px' } },
        el('label', { class: 'field grow' }, el('span', { text: 'Jazyk všech' }), lang),
        el('label', { class: 'field grow' }, el('span', { text: 'Štítky všech' }), tags))),
    list, footer));
  return () => { rows = []; };
}

// ---------- hledání textů v LRCLIB ----------

// Seřadí výsledky LRCLIB podle shody názvu, interpreta a délky nahrávky (dur v sekundách, nepovinné).
export function rankLyrics(results, q, dur) {
  return results.map(r => {
    const t = similarity(r.title, q.title);
    const a = q.artist ? similarity(r.artist || '', q.artist) : null;
    const dd = dur && r.dur ? Math.abs(r.dur - dur) : null;
    const durOk = dd != null && dd <= 3;
    const s = t * 0.6 + (a == null ? 0.1 : a * 0.25) + (durOk ? 0.15 : dd == null ? 0.05 : dd <= 10 ? 0.03 : 0) + (r.synced ? 0.02 : 0);
    return { ...r, t, a, dd, durOk, s };
  }).filter(r => r.t >= 0.5).sort((x, y) => y.s - x.s);
}

// Jistá shoda: název sedí a buď sedí délka nahrávky, nebo (bez nahrávky) i interpret.
export const isSure = c => !!c && c.t >= 0.8 && (c.a == null || c.a >= 0.5) && (c.dd != null ? c.durOk : c.a != null && c.a >= 0.8);

// Uloží nalezený text do hlavní verze písně (jen když ještě text nemá, nebo force).
export async function applyLyrics(songId, d, force = false) {
  const song = await getSong(songId);
  if (!song) throw new Error('Píseň nenalezena.');
  const v = primaryVersion(song);
  if (v.lines.length && !force) return null;
  const lines = d.timedLines || parseLyrics(d.text);
  if (!lines.length) throw new Error('Text je prázdný.');
  if (d.altText) attachAlt(lines, d.altText);
  v.lines = lines;
  v.source = d.source || 'web';
  v.sourceUrl = d.sourceUrl || '';
  if (!v.youtubeId && d.youtubeId) v.youtubeId = d.youtubeId;
  if (!song.artist && d.artist) song.artist = d.artist;
  await saveSong(song);
  return song;
}

// ---------- soubor s odkazy ----------
// Odkazy na stránky s texty (připraví je třeba Claude): JSON [{ artist, title, url | urls[] }] (i { links: […] }),
// nebo text: na řádku „Interpret - Název“ a adresa (oddělovač libovolný: tab, |, :, mezera). # = poznámka.
export function parseLinkFile(text) {
  const out = [];
  const add = (artist, title, urls) => {
    urls = [...new Set(urls.map(u => String(u || '').trim()).filter(u => /^https?:\/\/\S+$/i.test(u)))];
    if (title && urls.length) out.push({ artist: String(artist || '').trim(), title: String(title).trim(), urls });
  };
  const t = String(text || '').trim();
  if (t.startsWith('[') || t.startsWith('{')) {
    let d;
    try { d = JSON.parse(t); } catch { throw new Error('Soubor nejde přečíst jako JSON.'); }
    const list = Array.isArray(d) ? d : Array.isArray(d && d.links) ? d.links : [];
    for (const x of list) if (x && typeof x === 'object') add(x.artist, x.title, Array.isArray(x.urls) ? x.urls : [x.url]);
    return out;
  }
  for (const line of t.split(/\r?\n/)) {
    if (/^\s*#/.test(line)) continue;
    const urls = line.match(/https?:\/\/[^\s|<>"]+/gi);
    if (!urls) continue;
    const label = line.slice(0, line.search(/https?:\/\//i)).replace(/[\s|:;,\t]+$/, '').trim();
    const n = nameFromFile(label + '.x');
    add(n.artist, n.title, urls);
  }
  return out;
}

// Spáruje odkazy s písněmi: interpret + název, jinak jen název (když je jednoznačný). → { map: id → urls[], unmatched: [] }
export function matchLinks(links, songs) {
  const byFull = new Map(), byTitle = new Map();
  for (const s of songs) {
    byFull.set(fold(`${s.artist}|${s.title}`).trim(), s);
    const k = fold(s.title).trim();
    byTitle.set(k, byTitle.has(k) ? null : s);
  }
  const map = new Map(), unmatched = [];
  for (const l of links) {
    const s = (l.artist && byFull.get(fold(`${l.artist}|${l.title}`).trim())) || byTitle.get(fold(l.title).trim());
    if (!s) { unmatched.push(l); continue; }
    map.set(s.id, [...new Set([...(map.get(s.id) || []), ...l.urls])]);
  }
  return { map, unmatched };
}

const host = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };

// Text k převzetí z výsledku LRCLIB: časy jen když sedí délka nahrávky (jinak by verše utíkaly).
async function lyricsFrom(c) {
  if (c.link) return { text: c.data.text, altText: c.data.altText || '', youtubeId: c.data.youtubeId || null, source: c.data.source || host(c.url), sourceUrl: c.data.url || c.url };
  const l = await c.load();
  const timed = l.synced && c.durOk;
  return { text: timed ? l.text : (l.plain || l.text.replace(/^\[[^\]]*\]\s*/gm, '')), source: 'lrclib', sourceUrl: l.url, title: c.title, artist: c.artist, timed };
}

export async function renderFindLyrics(root, nav) {
  const lrclib = SOURCES.find(s => s.id === 'lrclib');
  const all = await listSongs();
  const todo = all.filter(s => !primaryVersion(s).lines.length);
  let stop = false, running = false;
  const st = new Map(todo.map(s => [s.id, { state: 'wait', cands: [], i: 0 }]));

  const list = el('div', { class: 'bulk-list' });
  const info = el('div', { class: 'hint', role: 'status' });
  const startBtn = el('button', { type: 'button', class: 'btn primary', text: '🔍 Hledat texty', onclick: run });
  const takeAllBtn = el('button', { type: 'button', class: 'btn', hidden: true, onclick: takeAllSure });
  const trAllBtn = el('button', { type: 'button', class: 'btn', hidden: true, onclick: () => transcribeAll() });
  const linksBtn = el('button', { type: 'button', class: 'btn', text: '📄 Načíst odkazy ze souboru', onclick: () => { if (!running) loadLinks(); } });
  const linkInfo = el('div', { class: 'hint' });
  const good = c => !!c && (c.link || isSure(c)); // doporučené: jistá shoda z LRCLIB nebo text z odkazu

  function row(s) {
    const r = st.get(s.id);
    const head = el('div', { class: 'bulk-title' }, el('strong', { text: s.title }), s.artist ? el('span', { text: ` – ${s.artist}` }) : el('span', { class: 'hint', text: ' – bez interpreta' }));
    const other = el('button', { type: 'button', class: 'btn small', text: '🔍 Hledat jinde', onclick: () => openSearch({ title: s.title, artist: s.artist, language: s.language }, async d => {
      try { await applyLyrics(s.id, d, true); r.state = 'taken'; toast('Text uložen'); draw(); sumUp(); } catch (e) { toast(e.message); }
    }, { songId: s.id }) });
    const trBtn = availableEngines().length && transcribable(s) ? el('button', { type: 'button', class: 'btn small', text: '🎧 Přepsat z nahrávky', onclick: async () => { if (running) return; const e = await pickEngine(); if (e) transcribeOne(s, e).catch(() => {}); } }) : null;
    let body;
    if (r.state === 'tr') body = el('div', { class: 'hint tr-msg', text: r.msg || 'Přepisuji z nahrávky…' });
    else if (r.state === 'wait') body = el('div', { class: 'hint', text: r.links ? `Čeká: ${r.links.length === 1 ? 'odkaz' : `${r.links.length} odkazy`} (${r.links.map(host).join(', ')})` : 'Čeká na hledání' });
    else if (r.state === 'busy') body = el('div', { class: 'hint', text: 'Hledám…' });
    else if (r.state === 'taken') body = el('div', { class: 'ok', text: r.transcribed ? '✓ Přepsáno z nahrávky (zkontroluj)' : '✓ Text uložen' });
    else if (r.state === 'error') body = el('div', { class: 'row' }, el('span', { class: 'hint', text: `Chyba: ${r.error}` }), other, trBtn);
    else if (!r.cands.length) body = el('div', { class: 'row' }, el('span', { class: 'hint', text: r.linkErr ? `Z odkazu nic (${r.linkErr.replace(/\.$/, "")}), v LRCLIB nenalezeno` : 'V LRCLIB nenalezeno' }), other, trBtn);
    else {
      const c = r.cands[r.i];
      const bits = c.link ? [host(c.url), `${c.n} veršů`, c.data.altText ? 's překladem' : ''].filter(Boolean) : [c.artist, c.dur && (c.dd == null || c.durOk) ? mmss(c.dur) : '', c.synced ? (c.durOk ? '⏱ s časy' : 's časy (délka nesedí, převezmu bez nich)') : 'bez časů',
        c.dd == null ? '' : c.durOk ? '✓ délka sedí' : `délka ${mmss(c.dur)} × nahrávka ${mmss(r.dur)}`].filter(Boolean);
      body = el('div', {},
        el('div', { class: 'bulk-cand' + (good(c) ? ' sure' : '') }, el('div', { text: `${c.link ? '🔗 ' : isSure(c) ? '✓ ' : '? '}${c.title}` }), el('div', { class: 'hint', text: bits.join(' · ') }),
          c.preview ? el('div', { class: 'r-preview', text: c.preview }) : null),
        el('div', { class: 'row' },
          el('button', { type: 'button', class: 'btn small primary', text: 'Převzít', onclick: () => takeOne(s, c) }),
          el('button', { type: 'button', class: 'btn small', text: 'Náhled', onclick: async () => {
            try {
              const d = await lyricsFrom(c);
              showPreview({ ...d, title: c.link ? s.title : c.title, artist: c.link ? s.artist : c.artist }, [], async dd => { try { await applyLyrics(s.id, dd, true); r.state = 'taken'; draw(); sumUp(); } catch (e) { toast(e.message); } });
            } catch (e) { toast(`Nepodařilo se načíst: ${e.message}`); }
          } }),
          r.cands.length > 1 ? el('button', { type: 'button', class: 'btn small', text: `Jiný (${r.i + 1}/${r.cands.length})`, onclick: () => { r.i = (r.i + 1) % r.cands.length; draw(); } }) : null,
          other));
    }
    return el('div', { class: 'bulk-row lyr', dataset: { id: s.id } }, el('div', { class: 'bulk-names' }, head, body));
  }

  function draw() { list.replaceChildren(...todo.map(row)); }

  // ---------- přepis z nahrávky (Gemini) ----------
  const notFound = () => todo.filter(s => { const r = st.get(s.id); return transcribable(s) && (r.state === 'error' || (r.state === 'done' && !r.cands.length)); });
  async function transcribeOne(s, engine) {
    const r = st.get(s.id);
    r.state = 'tr'; r.msg = 'Přepisuji z nahrávky…'; draw();
    try {
      await transcribeToSong(s.id, m => { r.msg = m; const n = list.querySelector(`[data-id="${CSS.escape(s.id)}"] .tr-msg`); if (n) n.textContent = m; }, engine);
      r.state = 'taken'; r.transcribed = true;
    } catch (e) { r.state = 'error'; r.error = e.message || String(e); draw(); sumUp(); throw e; }
    draw(); sumUp();
  }
  async function transcribeAll() {
    const list0 = notFound();
    if (!list0.length) return;
    const engine = await pickEngine();
    if (!engine) return;
    if (!confirm(`Přepsat ${plural(list0.length, 'píseň', 'písně', 'písní')} z nahrávek (${ENGINES[engine].label})? Nahrávky se pošlou ${engine === 'groq' ? 'do Groq' : 'do Googlu'}. Přepis zpěvu nebývá přesný, texty pak zkontroluj poslechem.`)) return;
    running = true; stop = false;
    startBtn.textContent = '■ Zastavit'; trAllBtn.hidden = true; takeAllBtn.hidden = true;
    let waits = 0;
    for (let i = 0; i < list0.length && !stop; i++) {
      info.textContent = `Přepisuji ${i + 1}/${list0.length}: ${list0[i].title}`;
      try { await transcribeOne(list0[i], engine); waits = 0; }
      catch (e) {
        if (e.limit && engine === 'groq' && waits < 3) { // Groq: limit za minutu/hodinu – chvíli počkat a zkusit znovu
          waits++;
          info.textContent = 'Groq hlásí limit, čekám minutu…';
          await new Promise(res => setTimeout(res, window.__alawLimitWait ?? 60000));
          if (!stop) { i--; continue; }
        }
        if (e.limit || /denní limit|nemá přístup|není platný|klíč/i.test(e.message || '')) { toast(`${e.message} Přepis zastaven.`, 6000); break; }
      }
    }
    running = false;
    startBtn.textContent = '🔍 Hledat znovu nenalezené';
    sumUp();
  }

  function sumUp() {
    const vals = [...st.values()];
    const found = vals.filter(r => r.state === 'done' && r.cands.length).length;
    const sure = todo.filter(s => { const r = st.get(s.id); return r.state === 'done' && good(r.cands[0]); });
    const taken = vals.filter(r => r.state === 'taken').length;
    if (!running && vals.some(r => r.state !== 'wait')) info.textContent = `Nalezeno ${found}, doporučených ${sure.length}, uloženo ${taken} z ${todo.length}.`;
    takeAllBtn.hidden = running || !sure.length;
    const nf = notFound().length;
    trAllBtn.hidden = running || !nf || !availableEngines().length;
    trAllBtn.textContent = `🎧 Přepsat nenalezené z nahrávek (${nf})`;
    takeAllBtn.textContent = `✓ Převzít všechny doporučené (${sure.length})`;
  }

  async function takeOne(s, c) {
    try {
      await applyLyrics(s.id, await lyricsFrom(c));
      st.get(s.id).state = 'taken';
    } catch (e) { toast(`Nepodařilo se: ${e.message}`); }
    draw(); sumUp();
  }

  async function takeAllSure() {
    const sure = todo.filter(s => { const r = st.get(s.id); return r.state === 'done' && good(r.cands[0]); });
    if (!confirm(`Převzít ${plural(sure.length, 'text', 'texty', 'textů')} (jisté shody z LRCLIB a texty z odkazů)? Každý pak můžeš v písni upravit.`)) return;
    takeAllBtn.disabled = true;
    for (const s of sure) { info.textContent = `Ukládám ${s.title}…`; await takeOne(s, st.get(s.id).cands[0]); }
    takeAllBtn.disabled = false;
    sumUp();
  }

  // Načte texty ze stránek v souboru odkazů (stahování přes net.js: APK přímo, na počítači přes prostředníka).
  async function fromLinks(r) {
    const out = [], errs = [];
    for (const url of r.links) {
      try {
        const d = await loadFromUrl(url);
        const text = cleanText(d.text || '');
        const n = parseLyrics(text).length;
        if (n < 2) throw new Error('na stránce není text písně');
        out.push({ link: true, url, title: d.title || host(url), data: { ...d, text }, n, preview: text.split('\n').filter(Boolean).slice(0, 2).join(' / ') });
      } catch (e) { errs.push(e.kind === 'proxy' ? 'na počítači je potřeba prostředník (Nastavení → Hledání textů)' : e.message || String(e)); }
    }
    r.linkErr = out.length ? null : errs[0] || null;
    return out;
  }

  async function loadLinks() {
    const file = await pickFile('.json,.txt,.csv,.tsv,text/plain,application/json');
    if (!file) return;
    let links;
    try { links = parseLinkFile(await file.text()); } catch (e) { toast(e.message); return; }
    if (!links.length) { toast('V souboru jsem nenašel žádné odkazy.'); return; }
    const { map, unmatched } = matchLinks(links, todo);
    for (const [id, urls] of map) { const r = st.get(id); if (r.state !== 'taken') Object.assign(r, { links: urls, state: 'wait', cands: [], i: 0, linkErr: null }); }
    fill(linkInfo, el('div', { text: `Odkazy: ${map.size} ${map.size === 1 ? 'píseň' : map.size < 5 ? 'písně' : 'písní'} spárováno${unmatched.length ? `, ${unmatched.length} bez shody` : ''}. Spusť hledání.` }),
      unmatched.length ? el('div', { class: 'hint', text: `Bez shody (název nesedí nebo píseň už text má): ${unmatched.slice(0, 12).map(l => [l.artist, l.title].filter(Boolean).join(' - ')).join('; ')}${unmatched.length > 12 ? '…' : ''}` }) : null);
    // písně s odkazy nahoru
    todo.sort((a, b) => (st.get(b.id).links ? 1 : 0) - (st.get(a.id).links ? 1 : 0));
    startBtn.textContent = '🔍 Hledat texty';
    draw();
  }

  async function run() {
    if (running) { stop = true; return; }
    running = true; stop = false;
    startBtn.textContent = '■ Zastavit';
    takeAllBtn.hidden = true;
    const queue = todo.filter(s => { const r = st.get(s.id); return ['wait', 'error'].includes(r.state) || (r.state === 'done' && !r.cands.length); });
    for (let i = 0; i < queue.length && !stop; i++) {
      const s = queue[i], r = st.get(s.id);
      info.textContent = `Hledám ${i + 1}/${queue.length}: ${s.title}`;
      r.state = 'busy'; draw();
      try {
        r.cands = r.links ? await fromLinks(r) : [];
        if (!r.cands.length) { // bez odkazů, nebo z žádného nešel načíst text → LRCLIB
          const v = primaryVersion(s);
          if (r.dur === undefined) {
            const blob = v.audio ? await getAudioBlob(v.audio.key) : null;
            r.dur = blob ? await audioDuration(blob) : null;
          }
          const res = await lrclib.search({ title: s.title, artist: s.artist });
          r.cands = rankLyrics(res, s, r.dur).slice(0, 5);
        }
        r.i = 0;
        r.state = 'done';
      } catch (e) { r.state = 'error'; r.error = e.message || String(e); }
      draw();
      await new Promise(res => setTimeout(res, window.__alawBulkDelay ?? 250)); // šetrně k LRCLIB
    }
    running = false;
    startBtn.textContent = stop ? '🔍 Hledat dál' : '🔍 Hledat znovu nenalezené';
    sumUp();
  }

  root.append(el('div', { class: 'view' },
    el('header', { class: 'topbar' }, iconBtn('back', 'Zpět', () => nav.back()), el('h1', { text: 'Najít texty' })),
    el('section', { class: 'section' },
      todo.length
        ? el('p', { text: `${plural(todo.length, 'píseň nemá', 'písně nemají', 'písní nemá')} text. Hledám v LRCLIB podle názvu, interpreta a délky nahrávky; ✓ = jistá shoda. Nic se neuloží, dokud to nepotvrdíš. Co tu nenajdu, zkus „Hledat jinde“ (ostatní zdroje).` })
        : el('p', { text: 'Všechny písně už mají text.' }),
      todo.length ? el('div', { class: 'row' }, startBtn, takeAllBtn, trAllBtn) : null,
      info,
      todo.length ? el('p', { style: { marginTop: '12px' }, text: 'Máš seznam odkazů na stránky s texty (třeba od Clauda)? Načti ho a texty se vezmou z nich; co z odkazu nepůjde, hledá se dál v LRCLIB.' }) : null,
      todo.length ? el('div', { class: 'row' }, linksBtn) : null,
      linkInfo),
    list));
  draw();
  return () => { stop = true; };
}

// ---------- přepis z nahrávky (Gemini) ----------

export const transcribable = song => song.versions.some(v => v.audio);

// Přepíše text z nahrávky písně. Bez textu → hlavní verze; s textem → další verze k porovnání (rozhodnutí zadavatele),
// a když hlavní verze nemá časy, převezme je z přepisu u shodných veršů. Vrací { song, as: 'main'|'version', version }.
export async function transcribeToSong(songId, onWait = () => {}, engine = defaultEngine()) {
  if (!engine || !ENGINES[engine]) throw new Error('Nejdřív vlož klíč pro Gemini nebo Groq v Nastavení.');
  let song = await getSong(songId);
  if (!song) throw new Error('Píseň nenalezena.');
  const src = [primaryVersion(song), ...song.versions].find(v => v.audio);
  if (!src) throw new Error('Píseň nemá vlastní nahrávku (z YouTube přepsat nejde).');
  const main = primaryVersion(song);
  if (main.lines.length && song.versions.length >= MAX_VERSIONS) throw new Error(`Píseň už má ${MAX_VERSIONS} verze textu. Nejdřív některou smaž.`);
  const blob = await getAudioBlob(src.audio.key);
  if (!blob) throw new Error('Nahrávka v tomto zařízení není (ještě se nestáhla synchronizací?).');
  const res = await ENGINES[engine].run(blob, { title: song.title, artist: song.artist, language: song.language, name: src.audio.name }, onWait);
  if (!res.length) throw new Error(`${engineName(engine)} v nahrávce žádný zpěv nerozpoznal.`);
  const base = `Přepis (${engineName(engine)})`;
  // časy platí pro nahrávku, ze které se přepisovalo: u druhé verze bez vlastní nahrávky jen když je to nahrávka hlavní verze
  const timed = src === main || !main.lines.length;
  const lines = res.map(l => newLine(l.text, timed ? l.start : null, l.stanza));
  song = await getSong(songId); // mezitím se mohla změnit (synchronizace)
  const m = primaryVersion(song);
  let as, version;
  if (!m.lines.length) {
    m.lines = lines;
    m.source = 'přepis';
    m.label = base;
    as = 'main'; version = m;
  } else {
    if (song.versions.length >= MAX_VERSIONS) throw new Error(`Píseň už má ${MAX_VERSIONS} verze textu.`);
    const labels = new Set(song.versions.map(v => v.label));
    let label = base;
    for (let n = 2; labels.has(label); n++) label = `${base} ${n}`;
    version = newVersion(lines, { label, source: 'přepis' });
    song.versions.push(version);
    if (!isSynced(m) && timed) { const b = borrowTimes(m.lines, lines); if (b.matched) m.lines = b.lines; }
    prune(song);
    as = 'version';
  }
  await saveSong(song);
  return { song, as, version };
}

// Přepis jedné písně s okénkem průběhu; pak otevře píseň (hlavní verze) nebo porovnání (další verze).
// Kterou službou přepisovat: jediná dostupná rovnou, dvě → zeptat se (null = zrušeno / žádná).
export function pickEngine() {
  const av = availableEngines();
  if (!av.length) { toast('Přepis dělá Gemini nebo Whisper (Groq): nejdřív vlož klíč v Nastavení → Přepis z nahrávky.', 5000); return Promise.resolve(null); }
  if (av.length === 1) return Promise.resolve(av[0]);
  return new Promise(resolve => {
    let picked = null;
    sheet(c => el('div', {},
      el('h3', { text: 'Čím přepsat?' }),
      el('div', { class: 'sub', text: 'Pro porovnání můžeš píseň přepsat oběma – rozdíly ukážou nejistá místa.' }),
      el('div', { class: 'row end' }, av.map(k => el('button', { type: 'button', class: 'btn' + (k === defaultEngine() ? ' primary' : ''), text: ENGINES[k].label,
        onclick: () => { picked = k; c(); resolve(k); } })))));
    const obs = new MutationObserver(() => { if (!document.body.contains(document.querySelector('.sheet'))) { obs.disconnect(); if (!picked) resolve(null); } });
    obs.observe(document.body, { childList: true });
  });
}

export async function runTranscribe(songId, nav, engine) {
  engine = engine || await pickEngine();
  if (!engine) return null;
  const status = el('div', { class: 'sub', text: 'Připravuji nahrávku…' });
  const close = sheet(() => el('div', {}, el('h3', { text: `🎧 Přepis z nahrávky – ${ENGINES[engine].label}` }), status,
    el('div', { class: 'hint', text: 'Může to trvat i pár minut, nech aplikaci otevřenou. Přepis zpěvu nebývá přesný – zkontroluj ho poslechem.' })));
  try {
    const r = await transcribeToSong(songId, m => { status.textContent = m; }, engine);
    close();
    const id = encodeURIComponent(songId);
    if (r.as === 'main') { toast('Text přepsán. Zkontroluj ho poslechem.', 4000); nav.replace(`#/song/${id}`); }
    else { toast('Přepis přidán jako další verze. Porovnej ji s textem.', 4000); nav.go(`#/compare/${id}/${encodeURIComponent(r.version.id)}`); }
    return r;
  } catch (e) { close(); toast(e.message || String(e), 6000); return null; }
}

export const songsWithoutText = songs => songs.filter(s => !primaryVersion(s).lines.length).length;
