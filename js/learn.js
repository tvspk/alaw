// Učení naostro: pokrok po verších, opakování v intervalech (SRS), porovnání verše psaného zpaměti.
// Jen čisté funkce (bez úložiště a DOM), ať je může používat lekce, mapa písně, záloha i synchronizace.
//
// Jednotka učení = verš podle ZNĚNÍ: klíč = text bez velikosti písmen, interpunkce a znamének (stříšek).
//   → refrén (stejný text víckrát) má jeden společný pokrok,
//   → drobná oprava (čárka, stříška) pokrok zachová, přepsaný verš začíná znovu.
// Záznam pokroku (IndexedDB 'progress', synchronizuje se po záznamech, naposledy změněný vyhrává):
//   { id: 'idPísně|klíč', s: idPísně, k: klíč, st: 'learn'|'review', step, due, ivl, ease, reps, lapses, intro, last, t }
//   st 'learn' = učím se (krátké kroky v minutách), 'review' = umím (opakování po dnech, ivl = interval ve dnech)
//   intro = kdy byl verš poprvé ukázán, t = razítko změny (sync.stamp, hodiny GitHubu)
// Hodnocení 1–4: Znovu / Těžké / Dobře / Snadno (rozhodnutí zadavatele: hodnotí vždy sám).
import { fold, primaryVersion } from './model.js';

const MIN = 60e3, DAY = 86400e3;
export const STEPS = [1 * MIN, 10 * MIN];   // kroky učení
export const GRADES = [[1, 'Znovu'], [2, 'Těžké'], [3, 'Dobře'], [4, 'Snadno']];
const MAX_IVL = 365, EASE = 2.5;

export const lineKey = text => fold(text).replace(/[^\p{L}\p{N}]+/gu, ' ').trim().slice(0, 300);
export const recId = (songId, k) => `${songId}|${k}`;

// Jednotky učení písně v pořadí prvního výskytu: { k, text, first, lines[] (indexy veršů) }
export function songUnits(song) {
  const units = new Map();
  primaryVersion(song).lines.forEach((l, i) => {
    const k = lineKey(l.text);
    if (!k) return;
    if (!units.has(k)) units.set(k, { k, text: l.text, first: i, lines: [] });
    units.get(k).lines.push(i);
  });
  return [...units.values()];
}

export function freshRec(songId, k) {
  return { id: recId(songId, k), s: songId, k, st: 'new', step: 0, due: 0, ivl: 0, ease: EASE, reps: 0, lapses: 0, intro: 0, last: 0, t: 0 };
}

// Verš poprvé ukázán (úvodní karta): začíná se učit.
export function introduce(rec, now = Date.now()) {
  return { ...rec, st: 'learn', step: 0, due: now, intro: rec.intro || now, last: now };
}

// Hodnocení g (1–4) → nový záznam. Kroky učení v minutách, pak intervaly ve dnech (podle SM-2 / Anki).
export function grade(rec, g, now = Date.now()) {
  const r = { ...rec, reps: rec.reps + 1, last: now, intro: rec.intro || now };
  const graduate = ivl => { r.st = 'review'; r.step = 0; r.ivl = Math.min(MAX_IVL, ivl); r.due = now + r.ivl * DAY - 4 * 3600e3; };
  if (rec.st !== 'review') {
    r.st = 'learn';
    const relearn = rec.lapses > 0 && rec.ivl > 0;
    if (g === 1) { r.step = 0; r.due = now + STEPS[0]; }
    else if (g === 2) { r.step = rec.step; r.due = now + STEPS[Math.min(rec.step, STEPS.length - 1)]; }
    else if (g === 3) {
      r.step = rec.step + 1;
      if (r.step >= STEPS.length) graduate(relearn ? Math.max(1, rec.ivl) : 1);
      else r.due = now + STEPS[r.step];
    } else graduate(relearn ? Math.max(2, rec.ivl + 1) : 4);
    return r;
  }
  const ivl = Math.max(1, rec.ivl);
  if (g === 1) {
    r.lapses = rec.lapses + 1;
    r.ease = Math.max(1.3, rec.ease - 0.2);
    r.ivl = Math.max(1, Math.round(ivl * 0.5));
    r.st = 'learn'; r.step = 0; r.due = now + STEPS[0];
    return r;
  }
  // Těžké < Dobře < Snadno vždy (i u krátkých intervalů, kde by zaokrouhlení dalo stejné číslo)
  const good = Math.max(ivl + 1, Math.round(ivl * rec.ease));
  if (g === 2) { r.ease = Math.max(1.3, rec.ease - 0.15); graduate(Math.min(good - 1, Math.max(ivl + 1, Math.round(ivl * 1.2))) || 1); }
  else if (g === 3) graduate(good);
  else { r.ease = rec.ease + 0.15; graduate(Math.max(good + 1, Math.round(ivl * rec.ease * 1.3))); }
  return r;
}

// Kam se verš posune při jednotlivých hodnoceních (popisky tlačítek).
export function previews(rec, now = Date.now()) {
  return GRADES.map(([g]) => {
    const r = grade(rec, g, now);
    return r.st === 'review' ? fmtIvl(r.ivl) : `${Math.round((r.due - now) / MIN)} min`;
  });
}

export const fmtIvl = d => d <= 1 ? '1 den' : d < 5 ? `${d} dny` : d < 30 ? `${d} dní` : d < 365 ? `${Math.round(d / 30)} měs.` : '1 rok';

// Stav verše pro mapu písně.
export function unitState(rec, now = Date.now()) {
  if (!rec || rec.st === 'new') return 'new';
  if (rec.st === 'learn') return 'learn';
  return rec.due <= now ? 'due' : 'known';
}
export const STATE_LABEL = { new: 'nový', learn: 'učím se', due: 'k opakování', known: 'umím' };

export function songSummary(units, recs, now = Date.now()) {
  const c = { new: 0, learn: 0, due: 0, known: 0, total: units.length };
  for (const u of units) c[unitState(recs.get(u.k), now)]++;
  return c;
}

// Fronta lekce: verše, které se učím a jsou na řadě, pak opakování, pak nové (nejvýš newLeft, v pořadí písně).
export function buildQueue(units, recs, now = Date.now(), newLeft = 6) {
  const learn = [], due = [], fresh = [];
  for (const u of units) {
    const st = unitState(recs.get(u.k), now);
    if (st === 'learn') learn.push(u);
    else if (st === 'due') due.push(u);
    else if (st === 'new' && fresh.length < newLeft) fresh.push(u);
  }
  learn.sort((a, b) => recs.get(a.k).due - recs.get(b.k).due);
  return [...learn, ...due, ...fresh].map(u => u.k);
}

// Kolik nových veršů písně bylo dnes (podle hodin zařízení) poprvé ukázáno.
export function introducedToday(recs, now = Date.now()) {
  const d = new Date(now); d.setHours(0, 0, 0, 0);
  let n = 0;
  for (const r of recs.values()) if (r.intro >= d.getTime()) n++;
  return n;
}

// ---------- cvičení na verš ----------
// Aplikace je střídá sama podle síly verše (rozhodnutí zadavatele); v Nastavení jde každé vypnout (prefs.exOff).
// Cvičení s nahrávkou (diktát) se nabídne jen u načasovaného verše, když nahrávka hraje.
export const EXERCISES = [
  ['initials', 'Podle prvních písmen'],
  ['choiceWord', 'Doplň slovo z nabídky'],
  ['scramble', 'Skládání slov'],
  ['flash', 'Bliknutí (verš se ukáže jen na chvilku)'],
  ['recall', 'Jak verš zní? (vybav si ho po předchozím)'],
  ['choice3', 'Výběr ze tří (který verš následuje)'],
  ['fromCz', 'Z češtiny do velštiny (jen u veršů s překladem)'],
  ['before', 'Napřeskáčku (co je před veršem)'],
  ['dictation', 'Diktát (jen u načasovaných veršů)'],
  ['type', 'Psaní zpaměti'],
];
const LEVELS = [
  ['initials', 'choiceWord', 'scramble'],                 // učím se, první krok
  ['recall', 'flash', 'choice3', 'dictation'],            // učím se dál / interval do 2 dnů
  ['recall', 'fromCz', 'before', 'choice3', 'dictation'], // interval 3–6 dní
  ['type', 'scramble', 'dictation', 'fromCz'],            // interval od 7 dnů
];
export function levelOf(rec) {
  if (rec.st === 'learn') return rec.step === 0 ? 0 : 1;
  return rec.ivl < 3 ? 1 : rec.ivl < 7 ? 2 : 3;
}
// ctx: { words, others (slova písně mimo verš), units, hasTr, hasNext, timed } – co cvičení potřebuje
const AVAILABLE = {
  choiceWord: c => c.others >= 3, scramble: c => c.words >= 3, choice3: c => c.units >= 3,
  fromCz: c => c.hasTr, before: c => c.hasNext, dictation: c => c.timed,
};
export function pickExercise(rec, ctx, { off = {}, alwaysType = false, last = null, rnd = Math.random } = {}) {
  if (!rec || rec.st === 'new') return 'intro';
  if (alwaysType) return 'type';
  let c = LEVELS[levelOf(rec)].filter(ex => !off[ex] && (!AVAILABLE[ex] || AVAILABLE[ex](ctx)));
  if (c.length > 1) c = c.filter(ex => ex !== last);
  if (!c.length) return levelOf(rec) === 3 && !off.type ? 'type' : levelOf(rec) === 0 && !off.initials ? 'initials' : 'recall';
  return c[Math.floor(rnd() * c.length)];
}
export const exerciseFor = (rec, alwaysType = false) => pickExercise(rec, {}, { alwaysType, rnd: () => 0 });

export function shuffle(arr, rnd = Math.random) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
// Zamíchat tak, aby pořadí nebylo stejné jako původní (podle klíče), pokud to jde.
export function shuffleNew(arr, key = x => x, rnd = Math.random) {
  const orig = arr.map(key).join('\n');
  for (let t = 0; t < 12; t++) { const s = shuffle(arr, rnd); if (s.map(key).join('\n') !== orig) return s; }
  return arr.slice().reverse();
}

// Špatné možnosti ze stejné písně, co nejpodobnější správné (rozhodnutí zadavatele).
const wordKey = w => lineKey(w).replace(/ /g, '');
export function songWords(song) {
  const m = new Map();
  for (const l of primaryVersion(song).lines) for (const w of l.text.split(/\s+/)) {
    const k = wordKey(w);
    const core = (w.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/u) || [''])[0];
    if (k && core && !m.has(k)) m.set(k, core);
  }
  return m; // klíč → slovo, jak je v textu
}
// exclude = slova, která už ve verši jsou vidět (nedávají smysl jako možnost)
export function wordDistractors(correct, words, n = 3, rnd = Math.random, exclude = '') {
  const ck = wordKey(correct);
  const ex = new Set(String(exclude).split(/\s+/).map(wordKey));
  const score = k => (k[0] === ck[0] ? 2 : 0) + (Math.abs(k.length - ck.length) <= 2 ? 1 : 0) + rnd();
  return [...words.keys()].filter(k => k !== ck && !ex.has(k)).sort((a, b) => score(b) - score(a)).slice(0, n).map(k => words.get(k));
}
export function lineDistractors(target, units, n = 2, rnd = Math.random) {
  const tw = new Set(target.k.split(' '));
  const score = u => u.k.split(' ').filter(w => tw.has(w)).length + (u.k.split(' ')[0] === target.k.split(' ')[0] ? 1 : 0) + rnd() * 1.5;
  return units.filter(u => u.k !== target.k).sort((a, b) => score(b) - score(a)).slice(0, n);
}

// Porovnání poskládaného pořadí: kolik položek je na špatném místě (podle klíče, refrén se může prohodit).
export const orderErrors = (placed, correct) => placed.reduce((n, x, i) => n + (x !== correct[i] ? 1 : 0), 0);

// ---------- psaní zpaměti ----------
// Porovnání bez ohledu na velikost písmen, interpunkci, apostrofy a znaménka (stříšky se ignorují úplně – rozhodnutí
// zadavatele). Drobný překlep (1 písmeno u slov od 4 písmen, 2 u slov od 8) se uzná, jen se označí.
const words = s => String(s || '').split(/\s+/).map(w => ({ raw: w, key: lineKey(w).replace(/ /g, '') })).filter(w => w.key);

function dist(a, b) { // Damerau–Levenshtein (sousední záměna = 1)
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    const c = a[i - 1] === b[j - 1] ? 0 : 1;
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + c);
    if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
  }
  return d[a.length][b.length];
}
const tolerance = w => (w.length >= 8 ? 2 : w.length >= 4 ? 1 : 0);
function wordMatch(target, typed) {
  if (target === typed) return 'ok';
  return dist(target, typed) <= tolerance(target) ? 'typo' : null;
}

// → { parts: [{ text, st: 'ok'|'typo'|'bad'|'miss', typed? } | { typed, st: 'extra' }], errors, typos, suggest (1–3) }
export function compareTyped(target, typed) {
  const T = words(target), U = words(typed);
  const n = T.length, m = U.length;
  const cost = Array.from({ length: n + 1 }, () => Array(m + 1).fill(0));
  const how = Array.from({ length: n + 1 }, () => Array(m + 1).fill(''));
  for (let i = 1; i <= n; i++) { cost[i][0] = i; how[i][0] = 'miss'; }
  for (let j = 1; j <= m; j++) { cost[0][j] = j; how[0][j] = 'extra'; }
  for (let i = 1; i <= n; i++) for (let j = 1; j <= m; j++) {
    const wm = wordMatch(T[i - 1].key, U[j - 1].key);
    const opts = [
      [cost[i - 1][j - 1] + (wm === 'ok' ? 0 : wm === 'typo' ? 0.4 : 1), wm || 'bad'],
      [cost[i - 1][j] + 1, 'miss'],
      [cost[i][j - 1] + 1, 'extra'],
    ];
    opts.sort((a, b) => a[0] - b[0]);
    [cost[i][j], how[i][j]] = opts[0];
  }
  const parts = [];
  let i = n, j = m;
  while (i > 0 || j > 0) {
    const h = how[i][j];
    if (h === 'miss') { parts.push({ text: T[i - 1].raw, st: 'miss' }); i--; }
    else if (h === 'extra') { parts.push({ typed: U[j - 1].raw, st: 'extra' }); j--; }
    else { parts.push({ text: T[i - 1].raw, typed: U[j - 1].raw, st: h }); i--; j--; }
  }
  parts.reverse();
  const errors = parts.filter(p => p.st === 'bad' || p.st === 'miss' || p.st === 'extra').length;
  const typos = parts.filter(p => p.st === 'typo').length;
  return { parts, errors, typos, suggest: errors === 0 ? 3 : errors === 1 ? 2 : 1 };
}

// ---------- data z cizích zdrojů (záloha, synchronizace) ----------
export function normalizeRec(r) {
  if (!r || typeof r !== 'object' || typeof r.s !== 'string' || typeof r.k !== 'string') return null;
  if (!r.s || r.s.length > 40 || !r.k || r.k.length > 300) return null;
  const num = (v, min = 0, max = 1e15) => (Number.isFinite(+v) ? Math.min(max, Math.max(min, +v)) : min);
  return {
    id: recId(r.s, r.k), s: r.s, k: r.k,
    st: ['new', 'learn', 'review'].includes(r.st) ? r.st : 'new',
    step: Math.round(num(r.step, 0, STEPS.length - 1)), due: num(r.due), ivl: Math.round(num(r.ivl, 0, MAX_IVL)),
    ease: Number.isFinite(+r.ease) && r.ease !== null ? num(r.ease, 1.3, 5) : EASE, reps: Math.round(num(r.reps, 0, 1e6)), lapses: Math.round(num(r.lapses, 0, 1e6)),
    intro: num(r.intro), last: num(r.last), t: num(r.t),
  };
}

// Naposledy změněný záznam vyhrává; při shodě „větší“ JSON, aby všechna zařízení skončila stejně.
export const recWins = (a, b) => !b || a.t > b.t || (a.t === b.t && JSON.stringify(a) > JSON.stringify(b));
