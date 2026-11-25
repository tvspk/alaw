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
      ...(l.ok === true ? { ok: true } : {}),
    })),
    ...(typeof v.review === 'boolean' ? { review: v.review } : {}),
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

// ---------- překlad vložený v textu (střídavé řádky) ----------
// Některé zdroje dávají pod každý verš rovnou překlad. Rozdělení: verše zůstanou, řádky překladu se uloží jako
// překlad předchozího verše (setTr). Podle jazyka (angličtina/čeština poznaná podle běžných slov) nebo prostě každý druhý řádek.
const EN_WORDS = new Set('the and you your my me is are was were be been to of in on it its that this we they them our us he she his her will would for with not but all so what where when who how there their from have has had do does just like love can no never one more than into out now see know want go come day night time heart life world only still song sing'.split(' '));
const CS_WORDS = new Set('je jsem jsi jsme jste jsou se na že to ten ta tak když jak co kde kdo já ty my vy oni můj tvůj náš jen ale nebo by bych byl byla bude není pro při před pod nad mezi až už ještě všechno vždy nikdy srdce píseň zpívat'.split(' '));
const CY_WORDS = new Set("y yr mae yn ac a'r ni fy dy ei ein eich eu o ar am wedi sy sydd yw ydy hen gan dros ond fel hon hwn hyn ydw oedd bydd dim mewn efo gyda i'r o'r yng ym fe mi ti chi nhw".split(' '));

export function trLineLang(text) {
  const raw = String(text || '').toLowerCase();
  const ws = raw.split(/[^\p{L}']+/u).filter(Boolean);
  let en = 0, cs = 0, cy = 0;
  for (const w of ws) { if (EN_WORDS.has(w)) en++; if (CS_WORDS.has(w)) cs++; if (CY_WORDS.has(w)) cy++; }
  if (/[ěščřžůťďň]/.test(raw)) cs += 2;
  if (/[ŵŷ]|dd|ll|\bch|wy/.test(raw)) cy += 1;
  if (cs > cy && cs >= en && cs > 0) return 'cs';
  if (en > cy && en > 0) return 'en';
  return null;
}

// Kolik řádků vypadá jako překlad (pro nabídku písně).
export function interleavedLang(lines) {
  const c = { en: 0, cs: 0 };
  for (const l of lines) { const g = trLineLang(l.text); if (g) c[g]++; }
  const lang = c.cs > c.en ? 'cs' : 'en';
  return c[lang] >= 2 && c[lang] >= lines.length / 5 ? lang : null;
}

// mode 'auto' = podle jazyka řádku, 'alt' = každý druhý řádek (první je verš). Vrací { lines, pairs }.
export function splitInterleaved(lines, mode = 'auto', lang = 'en') {
  const out = [];
  let pairs = 0, prevMain = null;
  const got = new WeakSet();
  lines.forEach((l, i) => {
    const isTr = mode === 'alt' ? i % 2 === 1 : trLineLang(l.text) === lang;
    if (isTr && prevMain) {
      const cur = trOf(prevMain, lang), again = got.has(prevMain); // dřívější překlad verše se nahradí, další řádky se připojí
      if (!again) { pairs++; got.add(prevMain); }
      setTr(prevMain, lang, { ...cur, translation: again ? `${cur.translation} / ${l.text}` : l.text });
      if (l.stanza && out.length) prevMain.pendingStanza = true; // prázdný řádek před překladem → sloka u dalšího verše
      return;
    }
    const m = { ...l, en: l.en ? { ...l.en } : undefined, contractions: [...(l.contractions || [])] };
    if (!m.en) delete m.en;
    if (prevMain && prevMain.pendingStanza) { m.stanza = true; delete prevMain.pendingStanza; }
    out.push(m); prevMain = m;
  });
  if (prevMain) delete prevMain.pendingStanza;
  return { lines: out, pairs };
}

// ---------- časy veršů z přepisu se slovy (Bangor) ----------
// Přepsaná slova s časy se přiřadí ke slovům textu popořadě podle podobnosti (přepis zpěvu má chyby, proto ne doslova).
// Verš, kde se shoduje aspoň třetina slov, dostane čas podle prvních shodných slov; ostatní verše se dopočítají
// mezi sousedy podle počtu slov (rozhodnutí zadavatele). Verše, které čas už mají, se nemění. words = [{ w, s, e }] (ms).
// Vrací { lines (kopie s časy), anchored, total, ok } – ok = shoda stačí na použití.
const wordKeys = text => String(text || '').split(/[\s\-–—/]+/).map(w => fold(w).replace(/[^\p{L}\p{N}]/gu, '')).filter(Boolean);

function lev(a, b) {
  if (a === b) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

// Podobnost dvou slov 0–1 (u velštiny i bez první hlásky – mutace: cath/gath/nghath).
export function wordSim(a, b) {
  if (a === b) return 1;
  const m = Math.max(a.length, b.length);
  if (Math.min(a.length, b.length) <= 2) return 0; // krátká slova jen přesně
  let s = 1 - lev(a, b) / m;
  if (a.length >= 4 && b.length >= 4) s = Math.max(s, 0.9 * (1 - lev(a.slice(1), b.slice(1)) / (m - 1)));
  return s;
}

const MAX_CELLS = 6e6;

export function alignTimes(lines, words) {
  const out = lines.map(l => ({ ...l }));
  const total = out.length;
  // verše, které čas už mají (ťukání, LRCLIB, oprava textu), zůstanou beze změny a slouží jako pevné body
  const fixed = out.map(l => l.start != null && Number.isFinite(+l.start));
  const nFixed = fixed.filter(Boolean).length;
  const fail = (anchored = 0) => ({ lines: out, anchored, fixed: nFixed, filled: 0, total, ok: false });
  const W = (Array.isArray(words) ? words : []).map(w => ({ k: fold(w.w).replace(/[^\p{L}\p{N}]/gu, ''), s: +w.s, e: +(w.e ?? w.s) }))
    .filter(w => w.k && Number.isFinite(w.s));
  if (!total || !W.length) return fail();
  // slova textu s číslem verše
  const T = [];
  const lineTok = out.map((l, i) => { const ks = wordKeys(l.text); ks.forEach((k, p) => T.push({ k, line: i, p })); return ks.length; });
  const n = T.length, m = W.length;
  if (!n || (n + 1) * (m + 1) > MAX_CELLS) return fail();
  // nejlepší popořadé párování (vážené LCS): skóre shody = podobnost, krátká slova méně
  const score = (a, b) => {
    const s = wordSim(a.k, b.k);
    if (s < 0.6) return 0;
    return s * (0.4 + 0.6 * Math.min(1, Math.min(a.k.length, b.k.length) / 4));
  };
  const cols = m + 1;
  const dp = new Float32Array((n + 1) * cols);
  const sc = new Float32Array((n + 1) * cols);
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const v = score(T[i - 1], W[j - 1]);
      sc[i * cols + j] = v;
      const best = Math.max(dp[(i - 1) * cols + j], dp[i * cols + j - 1]);
      dp[i * cols + j] = v > 0 ? Math.max(best, dp[(i - 1) * cols + j - 1] + v) : best;
    }
  }
  const match = new Int32Array(n).fill(-1);
  for (let i = n, j = m; i > 0 && j > 0;) {
    const v = sc[i * cols + j], here = dp[i * cols + j];
    if (v > 0 && Math.abs(here - (dp[(i - 1) * cols + j - 1] + v)) < 1e-4) { match[i - 1] = j - 1; i--; j--; }
    else if (dp[(i - 1) * cols + j] >= dp[i * cols + j - 1]) i--;
    else j--;
  }
  // typická délka slova (medián rozestupů mezi slovy přepisu)
  const gaps = W.slice(1).map((w, i) => w.s - W[i].s).filter(g => g > 0).sort((a, b) => a - b);
  const wd = Math.min(700, Math.max(150, gaps.length ? gaps[gaps.length >> 1] : 350));
  // kotvy: verše s dost shodnými slovy
  const starts = out.map((l, i) => fixed[i] ? +l.start : null);
  const nextFixed = new Array(total).fill(Infinity);
  for (let i = total - 2; i >= 0; i--) nextFixed[i] = fixed[i + 1] ? starts[i + 1] : nextFixed[i + 1];
  let last = -Infinity, anchored = 0;
  for (let i = 0, ti = 0; i < total; ti += lineTok[i], i++) {
    if (fixed[i]) { last = Math.max(last, starts[i]); continue; }
    const cnt = lineTok[i];
    if (!cnt) continue;
    const hit = [];
    for (let k = ti; k < ti + cnt; k++) if (match[k] >= 0) hit.push(k);
    if (!hit.length || hit.length < Math.max(1, Math.ceil(cnt / 3))) continue;
    // odhad začátku z prvních (nejvýš 3) shodných slov – medián; Whisper krátké slovo po pauze často přilepí dřív
    const est = hit.slice(0, 3).map(k => W[match[k]].s - T[k].p * wd).sort((a, b) => a - b);
    const wt = W[match[hit[0]]].s;
    let st = Math.max(0, est[est.length >> 1]);
    if (st <= last) st = wt > last ? wt : null; // pořadí veršů musí sedět (i vůči pevným časům)
    if (st == null || st >= nextFixed[i]) continue;
    starts[i] = Math.round(st); last = st; anchored++;
  }
  const textLines = lineTok.filter(Boolean).length;
  if (nFixed ? anchored + nFixed < 2 : anchored < 2 || anchored < 0.3 * textLines) return fail(anchored);
  // dopočet ostatních veršů podle počtu slov
  const wgt = lineTok.map(c => Math.max(1, c));
  const idx = starts.map((s, i) => s == null ? -1 : i).filter(i => i >= 0);
  const a0 = idx[0], aN = idx[idx.length - 1];
  let rate = 0, tok = 0;
  for (let i = a0; i < aN; i++) tok += wgt[i];
  rate = tok ? (starts[aN] - starts[a0]) / tok : wd;
  rate = Math.min(2000, Math.max(150, rate));
  for (let q = 0; q + 1 < idx.length; q++) {
    const a = idx[q], b = idx[q + 1];
    if (b - a < 2) continue;
    let sum = 0; for (let i = a; i < b; i++) sum += wgt[i];
    let acc = 0;
    for (let i = a + 1; i < b; i++) { acc += wgt[i - 1]; starts[i] = Math.round(starts[a] + (starts[b] - starts[a]) * acc / sum); }
  }
  if (a0 > 0) { // před první kotvou
    let before = 0; for (let i = 0; i < a0; i++) before += wgt[i];
    const lo = Math.max(0, Math.min(W[0].s, starts[a0]));
    const span = Math.min(starts[a0] - lo, rate * before);
    let acc = before;
    for (let i = 0; i < a0; i++) { starts[i] = Math.round(starts[a0] - span * acc / before); acc -= wgt[i]; }
  }
  if (aN < total - 1) { // po poslední kotvě
    let after = 0; for (let i = aN; i < total - 1; i++) after += wgt[i];
    const hi = Math.max(starts[aN], W[m - 1].s);
    const span = Math.min(hi - starts[aN], rate * after);
    let acc = 0;
    for (let i = aN + 1; i < total; i++) { acc += wgt[i - 1]; starts[i] = Math.round(starts[aN] + span * acc / after); }
  }
  for (let i = 0; i < total; i++) {
    if (fixed[i]) continue;
    if (i && starts[i] < starts[i - 1]) starts[i] = starts[i - 1];
    out[i].start = starts[i];
  }
  return { lines: out, anchored, fixed: nFixed, filled: total - nFixed, total, ok: true };
}

// Přiřadí řádky překladu ze zdroje k veršům (jen když počet řádků sedí).
export function attachAlt(lines, altText) {
  const alt = String(altText || '').split('\n').map(s => s.trim()).filter(Boolean);
  if (!alt.length || alt.length !== lines.length) return false;
  lines.forEach((l, i) => { l.alt = alt[i]; });
  return true;
}

// ---------- vlastní překlad vložený z jiné aplikace (0.17) ----------
// Text pro AI: očíslované verše (prázdné řádky = jen oddělení slok, nečíslují se).
export function numberedText(lines) {
  return lines.map((l, i) => `${i + 1}. ${l.text}`).join('\n');
}

// Vložený překlad → pole textů po verších (index = verš, '' = nepřiřazeno).
// Očíslované řádky („3. …“, „3) …“, „[3] …“) se párují podle čísla; jinak po řádcích v pořadí.
// Časy LRC a odrážky pryč; řádky, které jen opakují původní verš, se vynechají; „původní — překlad“ → překlad.
export function parsePastedTr(lines, text) {
  const k = s => fold(s).replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const orig = new Set(lines.map(l => k(l.text)).filter(Boolean));
  const NUM = /^\s*[[(]?(\d{1,3})\s*[.):\]]\s*/;
  const rows = String(text || '').replace(/\r\n?/g, '\n').split('\n')
    .map(s => s.replace(/^\s*(\[\d{1,3}:\d{1,2}(?:[.,]\d{1,3})?\]\s*)+/, '').replace(/^\s*[-•*]\s+/, '').trim())
    .filter(Boolean);
  const numbered = rows.length > 0 && rows.filter(r => NUM.test(r)).length >= rows.length * 0.6;
  const clean = s => {
    s = s.replace(/^["“„'‘]+|["”“'’]+$/g, '').trim();
    // „původní verš — překlad“ / „původní verš = překlad“
    const m = s.match(/^(.+?)\s+(?:—|–|-|=|→|\|)\s+(.+)$/);
    if (m && orig.has(k(m[1]))) return m[2].trim();
    return s;
  };
  const out = lines.map(() => '');
  let extra = 0;
  if (numbered) {
    let last = -1;
    for (const r of rows) {
      const m = r.match(NUM);
      let i = m ? +m[1] - 1 : last;
      let v = clean(m ? r.slice(m[0].length) : r);
      if (!v || orig.has(k(v))) { last = i; continue; }
      if (i < 0 || i >= lines.length) { extra++; continue; }
      out[i] = out[i] ? `${out[i]} / ${v}` : v;
      last = i;
    }
  } else {
    const vals = rows.map(r => clean(r.replace(NUM, ''))).filter(v => v && !orig.has(k(v)));
    vals.forEach((v, i) => { if (i < lines.length) out[i] = v; else extra++; });
  }
  const filled = out.filter(Boolean).length;
  return { tr: out, filled, missing: lines.filter((l, i) => l.text.trim() && !out[i]).length, extra, numbered };
}

// ---------- ověřování textu (0.17) ----------
// Verze se ověřuje verš po verši: přepis z nahrávky automaticky (dokud se ověřování neukončí), jiná verze když se zapne.
// Verš: ok = true (ověřený). Verze: review = true (ověřovat) / false (ukončeno).
export const inReview = v => !!v && (v.review === true || (v.source === 'přepis' && v.review !== false));
export function reviewCount(v) {
  const lines = v.lines.filter(l => l.text.trim());
  return { total: lines.length, ok: lines.filter(l => l.ok).length };
}
// Píseň s neověřenými verši hlavní verze
export function needsReview(song) {
  const v = primaryVersion(song);
  if (!inReview(v)) return false;
  const c = reviewCount(v);
  return c.ok < c.total;
}
