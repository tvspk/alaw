// Verze textu a sporná místa: porovnání hlavní verze s jinou (z jiného zdroje), rozhodnutí a jejich použití v učení.
// Jen čisté funkce nad písní (bez úložiště a DOM).
//
// Porovnává se celá píseň po slovech (bez ohledu na velikost písmen, interpunkci, apostrofy a stříšky – stejně jako
// psaní zpaměti), takže jinak zalomené řádky rozdíl nedělají. Výsledek:
//   items     – sporná místa: { kind: 'word', li, w, n, a, b, ak, bk, key, oli }
//               li = verš hlavní verze, w = index slova ve verši (slova = text rozdělený mezerami), n = kolik slov
//               hlavní verze místo zabírá (0 = druhá verze má slova navíc), a/b = znění v hlavní / druhé verzi,
//               ak/bk = klíče slov, oli = odpovídající verš druhé verze (kvůli časům její nahrávky)
//             – nebo větší přepsaný úsek přes víc veršů: { kind: 'mixed', li, lines[], oLines[], a, b, ak, bk, key }
//   onlyMain  – verše jen v hlavní verzi:  { lines[], repeat } (repeat = opakovaný refrén, druhá ho napsala méněkrát)
//   onlyOther – verše jen v druhé verzi: { after (verš hlavní verze, za který patří, −1 = na začátek), oLines[], repeat }
//
// Rozhodnutí se ukládají u verše hlavní verze: line.vars = [{ w, a, b, st }]
//   w = index slova (−1 u 'mixed'), a/b = klíče slov (ak/bk), st = 'ok' (platí hlavní, ověřeno) | 'unsure' (nejisté)
//   „Platí druhá“ se neukládá: slova se přepíšou do hlavní verze a rozdíl zmizí.
//   Změní-li se text verše, uložené rozhodnutí přestane sedět a místo je zase nerozhodnuté (prune ho uklidí).
// Při psaní zpaměti se u NEJISTÝCH míst uzná i znění druhé verze (rozhodnutí zadavatele, ověřená místa ne).
import { primaryVersion, newLine } from './model.js';
import { lineKey } from './learn.js';

export const MAX_VERSIONS = 3; // hlavní + nejvýš 2 další (rozhodnutí zadavatele)
export const STATE = { open: 'nerozhodnuto', ok: 'ověřeno', unsure: 'nejisté' };

export const splitWords = text => String(text || '').split(/\s+/).filter(Boolean);
const wkey = w => lineKey(w).replace(/ /g, '');
const varKey = v => (v.w < 0 ? `m|${v.a}|${v.b}` : `${v.w}|${v.a}|${v.b}`);
// prázdný seznam rozhodnutí se neukládá (stejně jako ho vynechá normalizeSong)
const setVars = (line, vars) => { if (vars.length) line.vars = vars; else delete line.vars; };
export const otherVersions = song => song.versions.filter(v => v.id !== primaryVersion(song).id);

function tokens(version) {
  const out = [];
  version.lines.forEach((l, li) => splitWords(l.text).forEach((raw, r) => { const k = wkey(raw); if (k) out.push({ k, raw, li, r }); }));
  return out;
}

// Nejdelší společná posloupnost klíčů slov → kousky rozdílů { A[], B[], prev, next } (prev/next = sousední shodná dvojice).
function hunks(A, B) {
  const n = A.length, m = B.length, W = m + 1;
  const L = new Int32Array((n + 1) * W);
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) {
    L[i * W + j] = A[i].k === B[j].k ? L[(i + 1) * W + j + 1] + 1 : Math.max(L[(i + 1) * W + j], L[i * W + j + 1]);
  }
  const out = [];
  let cur = null, prev = null, i = 0, j = 0;
  const open = () => { if (!cur) cur = { A: [], B: [], prev, next: null }; };
  while (i < n || j < m) {
    if (i < n && j < m && A[i].k === B[j].k) {
      prev = { a: A[i], b: B[j] };
      if (cur) { cur.next = prev; out.push(cur); cur = null; }
      i++; j++;
    } else if (j >= m || (i < n && L[(i + 1) * W + j] >= L[i * W + j + 1])) { open(); cur.A.push(A[i++]); }
    else { open(); cur.B.push(B[j++]); }
  }
  if (cur) out.push(cur);
  return out;
}

const byLine = toks => {
  const g = [];
  for (const t of toks) { if (!g.length || g.at(-1).li !== t.li) g.push({ li: t.li, toks: [] }); g.at(-1).toks.push(t); }
  return g;
};

export function compareVersions(main, other) {
  const A = tokens(main), B = tokens(other);
  if ((A.length + 1) * (B.length + 1) > 4e6) return { items: [], onlyMain: [], onlyOther: [], tooLong: true }; // ~2000 slov
  const keyed = main.lines.map(l => splitWords(l.text).filter(wkey).length);
  const items = [], onlyMain = [], onlyOther = [];
  const word = (li, w, n, bToks, oli) => {
    const a = splitWords(main.lines[li].text).slice(w, w + n).join(' ');
    const ak = splitWords(a).map(wkey).filter(Boolean).join(' ');
    const bk = bToks.map(t => t.k).join(' ');
    items.push({ kind: 'word', li, w, n, a, b: bToks.map(t => t.raw).join(' '), ak, bk, key: `${w}|${ak}|${bk}`, oli });
  };
  const span = toks => [toks[0].r, toks.at(-1).r - toks[0].r + 1];

  for (const h of hunks(A, B)) {
    if (!h.A.length) { // druhá verze má slova navíc
      const rest = [];
      for (const g of byLine(h.B)) {
        if (h.prev && h.prev.b.li === g.li) word(h.prev.a.li, h.prev.a.r + 1, 0, g.toks, g.li);
        else if (h.next && h.next.b.li === g.li) word(h.next.a.li, h.next.a.r, 0, g.toks, g.li);
        else rest.push(g.li);
      }
      if (rest.length) onlyOther.push({ after: h.prev ? h.prev.a.li : -1, oLines: rest });
      continue;
    }
    if (!h.B.length) { // druhé verzi slova chybí
      const rest = [];
      for (const g of byLine(h.A)) {
        if (g.toks.length === keyed[g.li]) { rest.push(g.li); continue; }
        const oli = h.prev && h.prev.a.li === g.li ? h.prev.b.li : h.next && h.next.a.li === g.li ? h.next.b.li : null;
        word(g.li, ...span(g.toks), [], oli);
      }
      if (rest.length) onlyMain.push({ lines: rest });
      continue;
    }
    const aG = byLine(h.A), bG = byLine(h.B);
    if (aG.length === 1 && bG.length <= 2) word(aG[0].li, ...span(aG[0].toks), h.B, h.B[0].li);
    else if (h.A.length === h.B.length) { // stejně slov, jen jinak zalomené: po verších hlavní verze
      let o = 0;
      for (const g of aG) { const bt = h.B.slice(o, o + g.toks.length); o += g.toks.length; word(g.li, ...span(g.toks), bt, bt[0].li); }
    } else {
      const ak = h.A.map(t => t.k).join(' '), bk = h.B.map(t => t.k).join(' ');
      items.push({ kind: 'mixed', li: aG[0].li, lines: aG.map(g => g.li), oLines: bG.map(g => g.li),
        a: aG.map(g => main.lines[g.li].text).join(' / '), b: bG.map(g => other.lines[g.li].text).join(' / '), ak, bk, key: `m|${ak}|${bk}` });
    }
  }
  // opakovaný refrén: verš, který je v hlavní verzi víckrát / který hlavní verze jinde má
  const count = new Map();
  for (const l of main.lines) { const k = lineKey(l.text); if (k) count.set(k, (count.get(k) || 0) + 1); }
  for (const b of onlyMain) b.repeat = b.lines.every(li => count.get(lineKey(main.lines[li].text)) > 1);
  for (const b of onlyOther) b.repeat = b.oLines.every(li => count.has(lineKey(other.lines[li].text)));
  items.sort((x, y) => x.li - y.li || (x.w ?? -1) - (y.w ?? -1));
  return { items, onlyMain, onlyOther };
}

// Stav sporného místa podle rozhodnutí uloženého u verše hlavní verze.
export function spotState(song, spot) {
  const line = primaryVersion(song).lines[spot.li];
  const v = (line?.vars || []).find(x => varKey(x) === spot.key);
  return v ? v.st : 'open';
}

// Porovnání se všemi ostatními verzemi: [{ version, items (se stavem st), onlyMain, onlyOther }]
export function analyze(song) {
  const main = primaryVersion(song);
  return otherVersions(song).map(version => {
    const r = compareVersions(main, version);
    for (const s of r.items) s.st = spotState(song, s);
    return { version, ...r };
  });
}

export function summary(items) {
  const c = { open: 0, ok: 0, unsure: 0, total: items.length };
  for (const s of items) c[s.st]++;
  return c;
}

// Rozhodnutí: 'main' (platí hlavní) | 'unsure' | 'open' (zrušit) | 'other' (platí druhá → přepíše hlavní verzi).
// Vrací { from, to } (klíče verše pro převod pokroku učení), když se změnil text verše, jinak null.
export function decide(song, spot, choice) {
  const line = primaryVersion(song).lines[spot.li];
  const vars = (line.vars || []).filter(x => varKey(x) !== spot.key);
  if (choice === 'main' || choice === 'unsure') {
    vars.push({ w: spot.kind === 'mixed' ? -1 : spot.w, a: spot.ak, b: spot.bk, st: choice === 'main' ? 'ok' : 'unsure' });
  }
  setVars(line, vars);
  if (choice !== 'other' || spot.kind !== 'word') return null;
  const from = lineKey(line.text);
  const words = splitWords(line.text);
  const add = splitWords(spot.b);
  words.splice(spot.w, spot.n, ...add);
  line.text = words.join(' ');
  // rozhodnutí za přepsaným místem se posunou s textem
  const shift = add.length - spot.n;
  if (shift) for (const v of line.vars || []) if (v.w > spot.w) v.w += shift;
  const to = lineKey(line.text);
  return from !== to ? { from, to } : null;
}

// Verše jen v druhé verzi → přidat do hlavní (za verš block.after).
export function addOtherLines(song, other, block) {
  const lines = primaryVersion(song).lines;
  const add = block.oLines.map(li => newLine(other.lines[li].text, null, !!other.lines[li].stanza));
  lines.splice(block.after + 1, 0, ...add);
  return add.length;
}

// Uklidit rozhodnutí, která už nesedí na žádné sporné místo (změněný text, smazaná verze).
export function prune(song) {
  const keys = new Map();
  for (const r of analyze(song)) for (const s of r.items) {
    if (!keys.has(s.li)) keys.set(s.li, new Set());
    keys.get(s.li).add(s.key);
  }
  primaryVersion(song).lines.forEach((l, li) => {
    if (!l.vars || !l.vars.length) return;
    setVars(l, l.vars.filter(v => keys.get(li)?.has(varKey(v))));
  });
}

// ---------- učení ----------
// Nejistá místa ve verších (refrén = víc veršů): [{ li, w, n, a, b }]
export function unsureSpots(song, lis, res = analyze(song)) {
  const set = new Set(lis), out = [], seen = new Set();
  for (const r of res) for (const s of r.items) {
    if (s.kind !== 'word' || s.st !== 'unsure' || !set.has(s.li)) continue;
    const id = `${s.li}|${s.key}`;
    if (!seen.has(id)) { seen.add(id); out.push(s); }
  }
  return out;
}

// Znění verše podle druhých verzí u nejistých míst: [{ text, spots[] }] (bez hlavního znění, nejvýš 8).
export function variantTexts(song, lis, res = analyze(song)) {
  const lines = primaryVersion(song).lines;
  const out = [], seen = new Set();
  for (const li of lis) {
    seen.add(lineKey(lines[li].text));
    const spots = unsureSpots(song, [li], res).sort((x, y) => y.w - x.w); // zprava, ať indexy platí
    const combos = Math.min(1 << spots.length, 16);
    for (let mask = 1; mask < combos && out.length < 8; mask++) {
      const words = splitWords(lines[li].text);
      const used = [];
      let last = Infinity;
      let ok = true;
      for (let b = 0; b < spots.length; b++) {
        if (!(mask & (1 << b))) continue;
        const s = spots[b];
        if (s.w + s.n > last) { ok = false; break; } // dvě místa přes sebe (z různých verzí) nejde použít naráz
        words.splice(s.w, s.n, ...splitWords(s.b));
        last = s.w;
        used.push(s);
      }
      if (!ok) continue;
      const text = words.join(' ');
      const k = lineKey(text);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({ text, spots: used.reverse() });
    }
  }
  return out;
}

// Slova verše, která nejsou jistá (nerozhodnutá nebo nejistá místa) – cvičení s výběrem je nemají hádat.
export function shakyWords(song, li, res = analyze(song)) {
  const out = new Set();
  for (const r of res) for (const s of r.items) {
    if (s.st === 'ok') continue;
    if (s.kind === 'mixed') { if (s.lines.includes(li)) splitWords(primaryVersion(song).lines[li].text).forEach((_, i) => out.add(i)); continue; }
    if (s.li === li) for (let i = s.w; i < s.w + s.n; i++) out.add(i);
  }
  return out;
}
