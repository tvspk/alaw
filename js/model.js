// Formát písně (v:1) a převody z/do textu, LRC a JSONu.
//
// Píseň = { v, id, title, artist, language, tags[], createdAt, updatedAt, primary, versions[] }
// Verze = { id, label, source, sourceUrl, youtubeId, audio, lines[] }
//   audio = { key, name, type, size } | null   (soubor samotný je v IndexedDB pod klíčem key)
// Verš  = { id, start, text, literal, translation, alt, contractions[], note, stanza, en? }
//   alt = překlad převzatý ze zdroje textu (obvykle anglický), translation/literal/contractions = český překlad
//   en = anglický překlad { translation, literal, contractions[] } (nepovinné, 0.11; prázdný se neukládá), viz trOf/setTr
//   start = začátek v ms nebo null (nečasováno); konec verše = začátek dalšího časovaného verše
//   stanza = true, když verš začíná novou sloku (před ním byl v textu prázdný řádek)
//   vars = rozhodnutí sporných míst proti jiným verzím (jen u hlavní verze, nepovinné): [{ w, a, b, st: 'ok'|'unsure' }],
//          viz js/versions.js

import { t } from './i18n.js';

export const SONG_FORMAT = 1;

export function uid(len = 10) {
  const a = new Uint8Array(Math.ceil(len / 2));
  crypto.getRandomValues(a);
  return Array.from(a, b => b.toString(16).padStart(2, '0')).join('').slice(0, len);
}

export const LANGUAGES = [
  ['cy', t('Velština')],
  ['en', t('Angličtina')],
  ['ga', t('Irština')],
  ['gd', t('Skotská gaelština')],
  ['br', t('Bretonština')],
  ['kw', t('Kornština')],
  ['cs', t('Čeština')],
  ['other', t('Jiný jazyk')],
];
export const langLabel = code => (LANGUAGES.find(l => l[0] === code) || [null, code || t('Jiný jazyk')])[1];

export function newLine(text = '', start = null, stanza = false) {
  return { id: uid(8), start, text, literal: '', translation: '', alt: '', contractions: [], note: '', stanza };
}

export function newVersion(lines = [], extra = {}) {
  return { id: uid(8), label: 'Hlavní', source: 'manual', sourceUrl: '', youtubeId: null, audio: null, lines, ...extra };
}

export function newSong({ title, artist, language = 'cy', tags = [], lines = [], versionExtra = {} }) {
  const now = Date.now();
  const version = newVersion(lines, versionExtra);
  return {
    v: SONG_FORMAT, id: uid(12), title: title.trim(), artist: (artist || '').trim(), language, tags,
    createdAt: now, updatedAt: now, primary: version.id, versions: [version],
  };
}

export const primaryVersion = song => song.versions.find(v => v.id === song.primary) || song.versions[0];
export const isSynced = version => version.lines.some(l => l.start != null);

// ---------- LRC a prostý text ----------

const TS_RE = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
const META_RE = /^\[([a-zA-Z#]+):(.*)\]$/;
const WORD_TS_RE = /<\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?>/g; // rozšířené LRC s časy slov

const tsToMs = (m, s, f) => {
  let ms = 0;
  if (f != null) ms = f.length === 1 ? +f * 100 : f.length === 2 ? +f * 10 : +f.slice(0, 3);
  return (+m * 60 + +s) * 1000 + ms;
};

export const looksLikeLrc = text => /\[\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?\]/.test(text);

// Převede vložený text (prostý nebo LRC) na verše. Prázdné řádky oddělují sloky.
export function parseLyrics(raw) {
  const text = (raw || '').replace(/\r\n?/g, '\n').replace(/ /g, ' ');
  if (looksLikeLrc(text)) return parseLrc(text);
  const lines = [];
  let pendingStanza = false;
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line) { if (lines.length) pendingStanza = true; continue; }
    lines.push(newLine(line, null, pendingStanza));
    pendingStanza = false;
  }
  return lines;
}

export function parseLrc(text) {
  let offset = 0;
  const entries = [];
  let order = 0;
  let pendingStanza = false;
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    const meta = line.match(META_RE);
    if (meta && !/^\d/.test(meta[1])) {
      if (meta[1].toLowerCase() === 'offset') offset = parseInt(meta[2], 10) || 0;
      continue;
    }
    const stamps = [...line.matchAll(TS_RE)];
    const lyric = line.replace(TS_RE, '').replace(WORD_TS_RE, '').replace(/\s+/g, ' ').trim();
    if (!stamps.length) {
      if (!lyric) { if (entries.length) pendingStanza = true; continue; }
      entries.push({ start: null, text: lyric, order: order++, stanza: pendingStanza });
      pendingStanza = false;
      continue;
    }
    if (!lyric) { if (entries.length) pendingStanza = true; continue; } // prázdný časovaný řádek = mezihra
    for (const m of stamps) {
      entries.push({ start: Math.max(0, tsToMs(m[1], m[2], m[3]) - offset), text: lyric, order: order++, stanza: pendingStanza });
      pendingStanza = false;
    }
  }
  // Seřadit podle času (víc časů u jednoho řádku = opakovaný refrén); nečasované zůstanou na svém místě.
  const timed = entries.filter(e => e.start != null).sort((a, b) => a.start - b.start || a.order - b.order);
  const result = entries.every(e => e.start != null) ? timed : entries;
  return result.map(e => newLine(e.text, e.start, e.stanza));
}

export function formatMs(ms, withHundredths = true) {
  if (ms == null || !isFinite(ms)) return '--:--';
  const total = Math.max(0, Math.round(ms));
  const m = Math.floor(total / 60000);
  const s = Math.floor((total % 60000) / 1000);
  const h = Math.floor((total % 1000) / 10);
  const base = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return withHundredths ? `${base}.${String(h).padStart(2, '0')}` : base;
}

export function toLrc(song, version) {
  const out = [`[ti:${song.title}]`];
  if (song.artist) out.push(`[ar:${song.artist}]`);
  for (const l of version.lines) {
    if (l.stanza) out.push('');
    out.push(l.start != null ? `[${formatMs(l.start)}]${l.text}` : l.text);
  }
  return out.join('\n') + '\n';
}

// ---------- překlady po jazycích (cs = pole verše, en = line.en) ----------

export const TR_LANGS = ['cs', 'en'];
export const otherLang = lang => (lang === 'en' ? 'cs' : 'en');

export function trOf(line, lang) {
  const src = lang === 'en' ? line.en || {} : line;
  return { translation: src.translation || '', literal: src.literal || '', contractions: src.contractions || [] };
}

export function setTr(line, lang, { translation = '', literal = '', contractions = [] }) {
  if (lang !== 'en') { Object.assign(line, { translation, literal, contractions }); return; }
  if (translation || literal || contractions.length) line.en = { translation, literal, contractions };
  else delete line.en;
}

// Překlad verše k zobrazení v jazyce lang; anglicky jinak překlad ze zdroje (alt, src: true). Nic → null.
export function trText(line, lang) {
  const tr = trOf(line, lang).translation;
  if (tr) return { text: tr, src: false };
  if (lang === 'en' && line.alt) return { text: line.alt, src: true };
  return null;
}

// Pro učení: překlad v jazyce lang, jinak v druhém jazyce (cokoli je lepší než nic).
export const anyTr = (line, lang) => (trText(line, lang) || trText(line, otherLang(lang)) || { text: '' }).text;

// Které jazyky překladu verze má (cs, en; en i jen ze zdroje).
export const trLangs = version => TR_LANGS.filter(lang => version.lines.some(l => trText(l, lang)));

// Export do .txt: what = 'text' (jen text bez časů), 'tr' (jen překlad), 'both' (verš a pod ním překlad).
export function toTxt(song, version, what = 'text', lang = 'cs') {
  const out = [song.artist ? `${song.title} – ${song.artist}` : song.title, ''];
  version.lines.forEach((l, i) => {
    const tr = trText(l, lang);
    if (l.stanza && i) out.push('');
    if (what === 'text') out.push(l.text);
    else if (what === 'tr') out.push(tr ? tr.text : '…');
    else { out.push(l.text); if (tr) out.push(tr.text); out.push(''); }
  });
  while (out.length && out[out.length - 1] === '') out.pop();
  return out.join('\n') + '\n';
}

export const toPlainText = version =>
  version.lines.map(l => (l.stanza ? '\n' : '') + l.text).join('\n').trim() + '\n';

// ---------- YouTube ----------

export function extractYoutubeId(input) {
  if (!input) return null;
  const s = input.trim();
  if (/^[\w-]{11}$/.test(s)) return s;
  try {
    const u = new URL(s.startsWith('http') ? s : `https://${s}`);
    const host = u.hostname.replace(/^(www|m|music)\./, '');
    if (host === 'youtu.be') return u.pathname.slice(1, 12) || null;
    if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
      if (u.searchParams.get('v')) return u.searchParams.get('v').slice(0, 11);
      const m = u.pathname.match(/^\/(?:embed|shorts|live|v)\/([\w-]{11})/);
      if (m) return m[1];
    }
  } catch { /* neplatná adresa */ }
  return null;
}

// ---------- Import JSONu ----------

// Přijme: zálohu této aplikace, jednu píseň v našem formátu, nebo JSON z projektu „Lyrics Trainer“ (Gemini).
export function songsFromJson(data) {
  if (data && data.app === 'alaw' && Array.isArray(data.songs)) {
    return { songs: data.songs.map(normalizeSong).filter(Boolean), audio: data.audio || {} };
  }
  const list = Array.isArray(data) ? data : [data];
  const songs = list.map(item => (item && item.versions ? normalizeSong(item) : fromLyricsTrainer(item))).filter(Boolean);
  return { songs, audio: {} };
}

function fromLyricsTrainer(d) {
  if (!d || !Array.isArray(d.lines) || !d.title) return null;
  const lines = d.lines.map(l => {
    const line = newLine(String(l.original || '').trim(), Number.isFinite(l.start_ms) ? l.start_ms : null);
    line.literal = l.literal || '';
    line.translation = l.translation || '';
    line.contractions = Array.isArray(l.contractions) ? l.contractions.map(c => ({ short: c.short || '', full: c.full || '', note: c.note || '' })) : [];
    line.note = Array.isArray(l.user_notes) ? l.user_notes.map(n => `${n.word}: ${n.mnemonic}`).join('\n') : '';
    return line;
  }).filter(l => l.text);
  return newSong({
    title: String(d.title).replace(/\s*\(Ukázka\)\s*$/i, ''),
    artist: d.artist || '',
    language: d.language || 'cy',
    lines,
    versionExtra: { source: d.lyrics_source || 'import', youtubeId: extractYoutubeId(d.youtube_id) },
  });
}

function normEn(en, str) {
  if (!en || typeof en !== 'object') return {};
  const out = { translation: str(en.translation, 1000), literal: str(en.literal, 1000), contractions: normContr(en.contractions, str) };
  return out.translation || out.literal || out.contractions.length ? { en: out } : {};
}
function normContr(list, str) {
  return Array.isArray(list)
    ? list.filter(c => c && typeof c.short === 'string').map(c => ({ short: str(c.short, 200), full: str(c.full, 200), note: str(c.note, 300) })) : [];
}

function normVars(vars) {
  if (!Array.isArray(vars)) return {};
  const out = vars.filter(v => v && Number.isInteger(v.w) && v.w >= -1 && typeof v.a === 'string' && typeof v.b === 'string' && (v.st === 'ok' || v.st === 'unsure'))
    .slice(0, 50).map(v => ({ w: v.w, a: v.a.slice(0, 1000), b: v.b.slice(0, 1000), st: v.st }));
  return out.length ? { vars: out } : {};
}

// Ověří a doplní píseň z cizího zdroje (záloha, později synchronizace). Neplatná data zahodí.
export function normalizeSong(s) {
  if (!s || typeof s !== 'object' || typeof s.title !== 'string' || !Array.isArray(s.versions) || !s.versions.length) return null;
  const str = (v, max = 5000) => (typeof v === 'string' ? v.slice(0, max) : '');
  const versions = s.versions.filter(v => v && Array.isArray(v.lines)).map(v => ({
    id: str(v.id, 40) || uid(8),
    label: str(v.label, 80) || 'Verze',
    source: str(v.source, 80) || 'manual',
    sourceUrl: str(v.sourceUrl, 2000),
    youtubeId: extractYoutubeId(str(v.youtubeId, 100)),
    audio: v.audio && typeof v.audio.key === 'string'
      ? { key: v.audio.key, name: str(v.audio.name, 300), type: str(v.audio.type, 100), size: +v.audio.size || 0 } : null,
    lines: v.lines.filter(l => l && typeof l.text === 'string').map(l => ({
      id: str(l.id, 40) || uid(8),
      start: Number.isFinite(l.start) && l.start >= 0 ? Math.round(l.start) : null,
      text: str(l.text, 1000),
      literal: str(l.literal, 1000),
      translation: str(l.translation, 1000),
      alt: str(l.alt, 1000),
      contractions: normContr(l.contractions, str),
      note: str(l.note, 3000),
      stanza: !!l.stanza,
      ...normVars(l.vars),
      ...normEn(l.en, str),
    })),
  }));
  if (!versions.length) return null;
  const primary = versions.some(v => v.id === s.primary) ? s.primary : versions[0].id;
  return {
    v: SONG_FORMAT,
    id: str(s.id, 40) || uid(12),
    title: s.title.slice(0, 300),
    artist: str(s.artist, 300),
    language: str(s.language, 20) || 'cy',
    tags: Array.isArray(s.tags) ? s.tags.filter(t => typeof t === 'string').map(t => t.slice(0, 40)).slice(0, 30) : [],
    createdAt: +s.createdAt || Date.now(),
    updatedAt: +s.updatedAt || Date.now(),
    primary,
    versions,
  };
}

export const parseTags = text => [...new Set(String(text || '').split(/[,;#]/).map(t => t.trim()).filter(Boolean))];

// Hledání bez ohledu na diakritiku a stříšky (ŵ → w, â → a).
export const fold = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// Doplní verše časy z jiného (časovaného) textu stejné písně: páruje verše podle znění, popořadě.
export function borrowTimes(lines, timedLines) {
  const src = timedLines.filter(l => l.start != null);
  let from = 0, matched = 0;
  const out = lines.map(l => ({ ...l }));
  for (const l of out) {
    const key = fold(l.text).replace(/[^\p{L}\p{N}]/gu, '');
    if (!key) continue;
    const idx = src.findIndex((t, j) => j >= from && fold(t.text).replace(/[^\p{L}\p{N}]/gu, '') === key);
    if (idx === -1) continue;
    l.start = src[idx].start;
    from = idx + 1;
    matched++;
  }
  return { lines: out, matched, total: out.length };
}

// Přiřadí řádky překladu ze zdroje k veršům (jen když počet řádků sedí).
export function attachAlt(lines, altText) {
  const alt = String(altText || '').split('\n').map(s => s.trim()).filter(Boolean);
  if (!alt.length || alt.length !== lines.length) return false;
  lines.forEach((l, i) => { l.alt = alt[i]; });
  return true;
}
