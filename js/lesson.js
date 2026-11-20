// Lekce „Učit se“: nové verše a opakování v intervalech. Cvičení na verš střídá aplikace sama podle síly verše
// (learn.pickExercise); s nahrávkou (diktát, poslech) jen u načasovaných veršů.
// Adresa #/learn/<id písně> (celá lekce) nebo #/learn/<id>/<klíč verše> (procvičit jen jeden verš z mapy písně).
import { el, fill as fillEl, iconBtn } from './ui.js';
import { t, pl, lang as uiLang } from './i18n.js';
import { getSong, getAudioBlob, getPrefs, setPrefs, getProgress, saveProgress } from './store.js';
import { primaryVersion, trOf, trText, anyTr, otherLang } from './model.js';

// Překlad pro lekci: v jazyce rozhraní, jinak v druhém jazyce.
const trLangFor = line => (trText(line, uiLang) || !trText(line, otherLang(uiLang)) ? uiLang : otherLang(uiLang));
import { Player } from './player.js';
import {
  songUnits, freshRec, introduce, grade, previews, GRADES, buildQueue, introducedToday, pickExercise,
  compareTyped, songSummary, fmtIvl, lineKey, songWords, wordDistractors, lineDistractors, shuffle, shuffleNew, orderErrors,
} from './learn.js';
import { analyze, variantTexts, unsureSpots, shakyWords } from './versions.js';

const WORD_RE = /^([^\p{L}\p{N}]*)(.*?)([^\p{L}\p{N}]*)$/u;
const TITLES = {
  intro: t('Nový verš'), initials: t('Podle prvních písmen'), recall: t('Jak verš zní?'), type: t('Napiš zpaměti'),
  choiceWord: t('Doplň slovo'), scramble: t('Poskládej verš'), flash: t('Bliknutí'), choice3: t('Který verš následuje?'),
  fromCz: t('Z češtiny do velštiny'), before: t('Co je před tímto veršem?'), dictation: t('Diktát'),
};

// Nahrávka písně do přehrávače (vlastní soubor, jinak YouTube v malém okně). Používá i drill.js.
export async function attachMedia(player, version, container, onReady, { needTimed = false } = {}) {
  if (needTimed && !version.lines.some(l => l.start != null)) return false;
  player.onReady = () => { player.setRate(player.rate); if (onReady) onReady(); };
  if (version.audio) {
    const blob = await getAudioBlob(version.audio.key);
    if (blob) { player.loadAudio(blob); return true; }
  }
  if (version.youtubeId) {
    const wrap = el('div', { class: 'yt-wrap small' });
    container.replaceChildren(wrap);
    await player.loadYouTube(wrap, version.youtubeId);
    return true;
  }
  return false;
}

// Úsek verše i: od jeho začátku po začátek dalšího časovaného verše.
export function lineRange(version, i) {
  const a = version.lines[i]?.start;
  if (a == null) return null;
  const next = version.lines.slice(i + 1).find(l => l.start != null && l.start > a);
  return [a, next ? next.start : a + 8000];
}

export function wordsOf(text, mode) { // 'initials' = první písmena, jinak skryté slovo
  const out = [];
  for (const part of text.split(/(\s+)/)) {
    if (!part) continue;
    if (/^\s+$/.test(part)) { out.push(part); continue; }
    const [, lead, core, trail] = part.match(WORD_RE);
    if (!core) { out.push(part); continue; }
    if (lead) out.push(lead);
    const w = el('span', { class: 'w hide' });
    if (mode === 'initials') w.append(el('span', { class: 'first', text: core[0] }), core.slice(1));
    else w.append(core);
    out.push(w);
    if (trail) out.push(trail);
  }
  return out;
}

export async function renderLesson(root, id, focusKey, nav) {
  const song = await getSong(id);
  if (!song) { root.append(el('div', { class: 'view' }, el('p', { class: 'empty', text: t('Píseň nenalezena.') }))); return; }
  const version = primaryVersion(song);
  const units = songUnits(song);
  const byKey = new Map(units.map(u => [u.k, u]));
  const allWords = songWords(song);
  const vres = song.versions.length > 1 ? analyze(song) : []; // sporná místa proti jiným verzím textu
  let recs = await getProgress(song.id);
  const player = new Player();
  player.rate = getPrefs().rate;
  let stopAt = null, extraNew = 0, done = 0, lastEx = null;

  // ---------- fronta ----------
  let queue;
  function fill() {
    if (focusKey) { queue = byKey.has(focusKey) ? [focusKey] : []; return; }
    const left = Math.max(0, getPrefs().newPerDay + extraNew - introducedToday(recs));
    queue = buildQueue(units, recs, Date.now(), left);
  }
  fill();
  // verš, který se učím, se vrátí za pár karet (když nic jiného nezbývá, hned)
  function requeue(k, rec) {
    if (rec.st !== 'learn') return;
    const pos = rec.step === 0 && rec.reps <= 1 ? 1 : rec.step === 0 ? 2 : 4;
    queue.splice(Math.min(pos, queue.length), 0, k);
  }

  // ---------- rozhraní ----------
  const counter = el('small');
  const top = el('header', { class: 'topbar' },
    iconBtn('back', t('Zpět'), () => nav.back()),
    el('h1', {}, el('span', { text: song.title }), counter));
  const typeChip = el('button', { type: 'button', class: 'chip', text: t('✍ Vždy psát'), onclick: () => {
    setPrefs({ alwaysType: !getPrefs().alwaysType }); typeChip.classList.toggle('on', getPrefs().alwaysType); show();
  } });
  typeChip.classList.toggle('on', getPrefs().alwaysType);
  const media = el('div', { class: 'lesson-media' });
  const card = el('div', { class: 'lcard' });
  root.append(el('div', { class: 'view lesson' }, top, media, el('div', { class: 'tools', style: { margin: '2px 0 10px' } }, typeChip), card));

  function updateCounter() {
    const s = songSummary(units, recs);
    counter.textContent = queue.length ? t('Zbývá {q} · umíš {n} z {m}', { q: queue.length, n: s.known + s.due, m: s.total }) : t('Umíš {n} z {m}', { n: s.known + s.due, m: s.total });
  }

  // ---------- zvuk ----------
  const canPlay = i => i >= 0 && version.lines[i] && version.lines[i].start != null && player.ready;
  function playLine(i, rate) {
    if (!canPlay(i)) return;
    const [a, b] = lineRange(version, i);
    stopAt = b;
    player.setRate(rate || getPrefs().rate);
    player.playFrom(Math.max(0, a - 150));
  }
  player.onTime = t => { if (stopAt != null && t >= stopAt - 40) { stopAt = null; player.pause(); } };
  player.onError = msg => { media.replaceChildren(el('div', { class: 'media-error', text: msg })); };
  // až je nahrávka připravená, doplnit tlačítka poslechu (rozepsanou nebo odkrytou kartu nepřekreslovat)
  const ready = () => { if (cur && !cur.revealed && !cur.busy && ['intro', 'initials', 'recall', 'before', 'choiceWord', 'choice3'].includes(cur.ex)) draw(); };
  const listenBtn = (i, label) => canPlay(i) ? el('button', { type: 'button', class: 'btn small', text: `▶ ${label}`, onclick: () => playLine(i) }) : null;

  // ---------- karty ----------
  let cur = null; // { k, unit, line, rec, ex, revealed, busy, data }

  function ctxFor(unit) {
    const line = version.lines[unit.first];
    const next = version.lines[unit.first + 1];
    return {
      words: line.text.split(/\s+/).filter(w => lineKey(w)).length, units: units.length,
      others: (own => [...allWords.keys()].filter(k => !own.has(k)).length)(new Set(line.text.split(/\s+/).map(w => lineKey(w).replace(/ /g, '')))),
      hasTr: !!anyTr(line, uiLang),
      hasNext: !!next && !!lineKey(next.text) && lineKey(next.text) !== unit.k,
      timed: canPlay(unit.first),
    };
  }

  function show() {
    updateCounter();
    if (!queue.length) { finish(); return; }
    const k = queue[0];
    const unit = byKey.get(k);
    const rec = recs.get(k) || freshRec(song.id, k);
    const forced = window.__alawForceEx; // jen pro testy
    const ex = forced && rec.st !== 'new' ? forced : pickExercise(rec, ctxFor(unit), { off: getPrefs().exOff || {}, alwaysType: getPrefs().alwaysType, last: lastEx });
    lastEx = ex;
    cur = { k, unit, line: version.lines[unit.first], rec, ex, revealed: false, busy: false, data: prepare(ex, unit) };
    draw();
  }

  // data cvičení se připraví jednou (překreslení kvůli nahrávce je nesmí zamíchat znovu)
  function prepare(ex, unit) {
    const line = version.lines[unit.first];
    if (ex === 'choiceWord') {
      const toks = line.text.split(/(\s+)/);
      // nejisté a nerozhodnuté slovo (jiná verze ho má jinak) se hádat nebude
      const shaky = vres.length ? shakyWords(song, unit.first, vres) : new Set();
      let wi = -1;
      const raw = toks.map(t => (t && !/^\s+$/.test(t) ? ++wi : -1));
      const sure = toks.map((t, i) => [t, i]).filter(([t, i]) => lineKey(t) && !shaky.has(raw[i]));
      const all = sure.length ? sure : toks.map((t, i) => [t, i]).filter(([t]) => lineKey(t));
      const long = all.filter(([t]) => lineKey(t).replace(/ /g, '').length >= 3);
      const pool = long.length ? long : all;
      const [tok, i] = pool[Math.floor(Math.random() * pool.length)];
      const [, lead, core, trail] = tok.match(WORD_RE);
      return { toks, i, lead, core, trail, options: shuffle([core, ...wordDistractors(core, allWords, 3, Math.random, line.text)]) };
    }
    if (ex === 'scramble') {
      const toks = line.text.split(/\s+/).filter(Boolean).map((w, i) => ({ w, i, k: lineKey(w) }));
      return { toks: shuffleNew(toks, t => t.k), placed: [] };
    }
    if (ex === 'choice3') return { options: shuffle([unit, ...lineDistractors(unit, units)]) };
    return {};
  }

  function head() {
    const { unit, rec, ex } = cur;
    const stLabel = !rec || rec.st === 'new' ? t('nový') : rec.st === 'learn' ? (rec.lapses ? t('znovu se učím') : t('učím se')) : t('opakování · interval {i}', { i: fmtIvl(rec.ivl) });
    const nums = unit.lines.map(i => i + 1).join(', ');
    return el('div', { class: 'lhead' },
      el('span', { class: 'lex', text: TITLES[ex] }),
      el('span', { class: 'lmeta', text: t('verš {n}', { n: nums }) + (unit.lines.length > 1 ? ' ' + t('(opakuje se)') : '') + ` · ${stLabel}` }));
  }

  function context() {
    const i = cur.unit.first - 1;
    const prev = i >= 0 ? version.lines[i] : null;
    return el('div', { class: 'lprev' },
      el('div', { class: 'lprev-label', text: prev ? t('Předchozí verš') : t('Začátek písně') }),
      prev ? el('div', { class: 'lprev-text', text: prev.text }) : null,
      prev ? listenBtn(i, t('Předchozí verš')) : null);
  }

  function extras(line) {
    const li = version.lines.indexOf(line);
    const uns = vres.length && li >= 0 && !cur?.variantUsed ? unsureSpots(song, [li], vres) : [];
    return [
      ...uns.map(sp => el('div', { class: 'lvariant', text: '⚠ ' + (sp.a ? t('Nejisté: jiná verze má {b} místo „{a}“', { b: sp.b ? `„${sp.b}“` : t('tu nic'), a: sp.a }) : t('Nejisté: jiná verze má {b}', { b: sp.b ? `„${sp.b}“` : t('tu nic') })) })),
      ...(lg => { const tr = trText(line, lg), x = trOf(line, lg); return [
        tr ? el('div', { class: tr.src ? 'alt' : 'tr', text: tr.text }) : null,
        line.alt && !(tr && tr.src) && lg === 'cs' ? el('div', { class: 'alt', text: line.alt }) : null,
        x.literal ? el('div', { class: 'lit', text: x.literal }) : null,
        x.contractions.length ? el('div', { class: 'contr' }, x.contractions.map(c => el('span', { text: `${c.short} → ${c.full}`, title: c.note }))) : null]; })(trLangFor(line)),
      line.note ? el('div', { class: 'note', text: line.note }) : null,
    ];
  }

  function gradeRow(suggest) {
    const pv = previews(cur.rec.st === 'new' ? introduce(cur.rec) : cur.rec);
    return el('div', { class: 'grades' }, GRADES.map(([g, label], j) =>
      el('button', { type: 'button', class: `grade g${g}` + (suggest === g ? ' sug' : ''), dataset: { g },
        onclick: () => rate(g) }, el('strong', { text: label }), el('small', { text: pv[j] }))));
  }

  const btn = (text, onclick, cls = 'btn') => el('button', { type: 'button', class: cls, text, onclick });
  const hintChip = (text, fn) => el('button', { type: 'button', class: 'chip', text, onclick: e => { fn(); e.target.remove(); } });
  const revealRow = () => el('div', { class: 'row end' }, btn(t('Odkrýt'), () => reveal(), 'btn primary'));
  const hidden3 = () => el('span', { class: 'lq', text: '? ? ?' });

  function draw() {
    const { unit, ex, line, data } = cur;
    const body = [];
    const hintBox = el('div', { class: 'lhint' });
    const trHint = () => anyTr(line, uiLang) ? hintChip(t('Nápověda: překlad'), () => hintBox.append(el('div', { class: 'tr', text: anyTr(line, uiLang) }))) : null;

    if (ex === 'intro') {
      body.push(context(),
        el('div', { class: 'ltarget' }, el('div', { class: 'ltext', text: line.text }), ...extras(line)),
        el('div', { class: 'row' }, listenBtn(unit.first, t('Poslechnout verš'))),
        el('p', { class: 'hint', text: t('Přečti si verš nahlas, poslechni si ho a zkus si ho zapamatovat. Za chvíli se tě na něj zeptám.') }),
        el('div', { class: 'row end' }, btn(t('Dál'), nextFromIntro, 'btn primary')));
      if (getPrefs().autoPlayLine) setTimeout(() => playLine(unit.first), 50);

    } else if (ex === 'type' || ex === 'dictation') {
      const input = el('textarea', { class: 'ltype', rows: 2, lang: song.language || 'cy', autocapitalize: 'off', autocomplete: 'off', spellcheck: false,
        placeholder: ex === 'dictation' ? t('Napiš, co slyšíš…') : t('Napiš verš zpaměti…'), 'aria-label': t('Verš') });
      input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); check(input.value); } });
      body.push(ex === 'type' ? context() : el('div', { class: 'row' },
        btn(t('▶ Přehrát verš'), () => playLine(unit.first), 'btn primary small'),
        btn(t('🐢 Pomaleji'), () => playLine(unit.first, 0.75), 'btn small')),
      el('div', { class: 'ltarget' }, input, hintBox),
      el('div', { class: 'row' }, ex === 'type' ? trHint() : null,
        hintChip(t('První písmena'), () => hintBox.append(el('div', { class: 'ltext small' }, wordsOf(line.text, 'initials'))))),
      el('div', { class: 'row end' }, btn(t('Nevím'), () => check('')), btn(t('Zkontrolovat'), () => check(input.value), 'btn primary')));
      if (ex === 'dictation') setTimeout(() => playLine(unit.first), 50);
      setTimeout(() => input.focus(), 30);

    } else if (ex === 'choiceWord') {
      const sentence = el('div', { class: 'ltext' }, data.toks.map((t, i) => (i === data.i
        ? [data.lead, el('span', { class: 'blank', text: '____' }), data.trail] : t)));
      body.push(context(), el('div', { class: 'ltarget' }, sentence, hintBox),
        el('p', { class: 'hint', text: t('Které slovo chybí?') }),
        el('div', { class: 'choices' }, data.options.map(o => btn(o, () => pick(o === data.core, o), 'choice'))),
        el('div', { class: 'row' }, trHint()));

    } else if (ex === 'choice3') {
      body.push(context(),
        el('p', { class: 'hint', text: unit.first ? t('Který verš následuje?') : t('Kterým veršem píseň začíná?') }),
        el('div', { class: 'choices lines' }, data.options.map(u => btn(u.text, () => pick(u.k === cur.k, u.text), 'choice'))));

    } else if (ex === 'scramble') {
      const placed = el('div', { class: 'sc-placed' }, data.placed.length ? data.placed.map((tk, j) =>
        btn(tk.w, () => { data.placed.splice(j, 1); draw(); }, 'sc-word on')) : el('span', { class: 'lq small', text: t('ťukej slova ve správném pořadí') }));
      const left = data.toks.filter(tk => !data.placed.includes(tk));
      body.push(context(), el('div', { class: 'ltarget' }, placed),
        el('div', { class: 'sc-pool' }, left.map(tk => btn(tk.w, () => {
          data.placed.push(tk);
          if (data.placed.length === data.toks.length) checkScramble(); else draw();
        }, 'sc-word'))),
        el('div', { class: 'row' }, trHint()), hintBox);

    } else if (ex === 'flash') {
      const ms = window.__alawFlashMs || Math.max(1500, 600 + 380 * line.text.split(/\s+/).length);
      const box = el('div', { class: 'ltext', text: line.text });
      const bar = el('div', { class: 'flashbar' }, el('i', { style: { animationDuration: `${ms}ms` } }));
      body.push(context(), el('div', { class: 'ltarget' }, box, bar),
        el('p', { class: 'hint', text: t('Zapamatuj si verš, za chvilku zmizí. Pak si ho řekni nahlas a odkryj.') }));
      const mine = cur;
      setTimeout(() => {
        if (cur !== mine || cur.revealed) return;
        box.replaceChildren(hidden3());
        bar.remove();
        card.append(revealRow());
      }, ms);

    } else if (ex === 'fromCz') {
      body.push(el('div', { class: 'lprev' }, el('div', { class: 'lprev-label', text: t('Překlad') }),
        el('div', { class: 'lprev-text cz', text: anyTr(line, uiLang) })),
      el('div', { class: 'ltarget' }, el('div', { class: 'ltext' }, hidden3())),
      el('p', { class: 'hint', text: t('Jak tenhle verš zní v originále? Řekni ho nahlas, pak odkryj.') }),
      revealRow());

    } else if (ex === 'before') {
      const nxt = unit.first + 1;
      body.push(el('div', { class: 'lprev' }, el('div', { class: 'lprev-label', text: t('Tento verš') }),
        el('div', { class: 'lprev-text', text: version.lines[nxt].text }), listenBtn(nxt, t('Poslechnout'))),
      el('div', { class: 'ltarget' }, el('div', { class: 'ltext' }, hidden3())),
      el('p', { class: 'hint', text: t('Který verš je těsně před ním? Řekni ho nahlas, pak odkryj.') }),
      revealRow());

    } else { // initials, recall
      const hidden = el('div', { class: 'ltext' }, ex === 'initials' ? wordsOf(line.text, 'initials') : hidden3());
      body.push(context(),
        el('div', { class: 'ltarget' }, hidden, ex === 'initials' && anyTr(line, uiLang) ? el('div', { class: 'tr', text: anyTr(line, uiLang) }) : null, hintBox),
        el('p', { class: 'hint', text: ex === 'initials' ? t('Řekni si celý verš nahlas, pak ho odkryj a ohodnoť, jak to šlo.') : t('Jak pokračuje píseň? Řekni si verš nahlas, pak ho odkryj a ohodnoť, jak to šlo.') }),
        el('div', { class: 'row' },
          ex === 'recall' ? trHint() : null,
          ex === 'recall' ? hintChip(t('První písmena'), () => hidden.replaceChildren(...wordsOf(line.text, 'initials'))) : null),
        revealRow());
    }
    fillEl(card, head(), ...body);
  }

  // odkrytá karta: celý verš + hodnocení (suggest = zvýrazněný návrh)
  function reveal(top = null, suggest = null, note = t('Jak to šlo?')) {
    const line = cur.line;
    cur.revealed = true;
    const ctx = ['fromCz', 'before', 'dictation'].includes(cur.ex) ? null : context();
    fillEl(card, head(), ...(ctx ? [ctx] : []),
      el('div', { class: 'ltarget shown' }, ...(top || [el('div', { class: 'ltext', text: line.text })]), ...extras(line)),
      cur.ex === 'before' ? el('div', { class: 'lprev' }, el('div', { class: 'lprev-label', text: t('Pak následuje') }), el('div', { class: 'lprev-text', text: version.lines[cur.unit.first + 1].text })) : null,
      el('div', { class: 'row' }, listenBtn(cur.unit.first, t('Poslechnout verš'))),
      el('p', { class: 'hint', text: note }),
      gradeRow(suggest));
    if (getPrefs().autoPlayLine && cur.ex !== 'dictation') playLine(cur.unit.first);
  }

  function pick(ok, chosen) {
    const verdict = el('div', { class: 'lverdict ' + (ok ? 'ok' : 'bad'), text: ok ? t('Správně!') : t('Ne – vybral(a) jsi „{c}“.', { c: chosen }) });
    reveal([el('div', { class: 'ltext', text: cur.line.text }), verdict], ok ? 3 : 1, t('Jak to šlo? Zvýrazněné tlačítko je návrh.'));
  }

  function checkScramble() {
    const d = cur.data;
    const right = d.toks.slice().sort((a, b) => a.i - b.i);
    const errors = orderErrors(d.placed.map(t => t.k), right.map(t => t.k));
    const mine = el('div', { class: 'ltext diff' }, d.placed.flatMap((t, j) => [j ? ' ' : '',
      el('span', { class: t.k === right[j].k ? 'x-ok' : 'x-bad', text: t.w })]));
    const verdict = el('div', { class: 'lverdict ' + (errors ? 'bad' : 'ok'),
      text: errors ? pl(errors, 'Na špatném místě: {n} slovo.', 'Na špatném místě: {n} slova.', 'Na špatném místě: {n} slov.') : t('Správně!') });
    reveal(errors ? [mine, el('div', { class: 'ltext', text: cur.line.text }), verdict] : [el('div', { class: 'ltext', text: cur.line.text }), verdict],
      errors === 0 ? 3 : errors <= 2 ? 2 : 1, t('Jak to šlo? Zvýrazněné tlačítko je návrh podle chyb.'));
  }

  function check(typed) {
    // u nejistých míst se uzná i znění jiné verze (rozhodnutí zadavatele)
    let r = compareTyped(cur.line.text, typed), used = null;
    if (vres.length && typed.trim()) {
      for (const v of variantTexts(song, cur.unit.lines, vres)) {
        const rv = compareTyped(v.text, typed);
        if (rv.errors < r.errors || (rv.errors === r.errors && rv.typos < r.typos)) { r = rv; used = v; }
      }
    }
    const diff = el('div', { class: 'ltext diff' }, r.parts.flatMap((p, j) => [j ? ' ' : '',
      p.st === 'extra' ? el('s', { class: 'x-extra', text: p.typed, title: t('navíc') })
        : el('span', { class: `x-${p.st}`, text: p.text, title: p.st === 'typo' || p.st === 'bad' ? t('napsáno: {w}', { w: p.typed }) : p.st === 'miss' ? t('chybí') : '' })]));
    const verdict = !typed.trim() ? t('Nevadí, příště to půjde.') : r.errors === 0 ? (r.typos ? t('Správně (s drobným překlepem).') : t('Výborně, přesně!')) : t('Chyb: {n}.', { n: r.errors });
    cur.variantUsed = !!used;
    const note = used ? el('div', { class: 'lvariant ok', text: t('Uznáno podle jiné verze (nejisté místo): {s}', { s: used.spots.map(sp => t('„{b}“ místo „{a}“', { b: sp.b || '—', a: sp.a || '—' })).join(', ') }) }) : null;
    reveal([typed.trim() ? el('div', { class: 'ltyped', text: typed.trim() }) : null, diff,
      el('div', { class: 'lverdict' + (r.errors ? ' bad' : ' ok'), text: verdict }), note].filter(Boolean), typed.trim() ? r.suggest : 1,
    t('Jak to šlo? Zvýrazněné tlačítko je návrh podle chyb.'));
  }

  async function nextFromIntro() {
    if (cur.busy) return;
    cur.busy = true;
    const rec = introduce(cur.rec);
    await saveProgress(rec);
    recs.set(cur.k, rec);
    queue.shift();
    requeue(cur.k, rec);
    show();
  }

  async function rate(g) {
    if (!cur || !cur.revealed || cur.busy) return;
    cur.busy = true;
    const rec = grade(cur.rec.st === 'new' ? introduce(cur.rec) : cur.rec, g);
    await saveProgress(rec);
    recs.set(cur.k, rec);
    done++;
    queue.shift();
    requeue(cur.k, rec);
    show();
  }

  function whenTxt(due, now) {
    const day = ms => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); };
    const days = Math.round((day(due) - day(now)) / 86400e3);
    return days <= 0 ? t('dnes později') : days === 1 ? t('zítra') : t('za {d}', { d: fmtIvl(days) });
  }

  function finish() {
    cur = null;
    const s = songSummary(units, recs);
    const now = Date.now();
    const next = [...recs.values()].filter(r => r.st !== 'new' && r.due > now).sort((a, b) => a.due - b.due)[0];
    const nextTxt = next ? t('Další opakování {w}.', { w: whenTxt(next.due, now) }) : '';
    card.replaceChildren(el('div', { class: 'ldone' },
      el('div', { class: 'big', text: focusKey ? t('Hotovo') : done || s.known + s.due ? t('Pro dnešek hotovo 🎉') : t('Nic k učení') }),
      el('p', { text: t('Umíš {n} z {m} veršů', { n: s.known + s.due, m: s.total }) + (s.learn ? ', ' + t('{n} se učíš', { n: s.learn }) : '') + `. ${nextTxt}` }),
      el('div', { class: 'row', style: { justifyContent: 'center' } },
        !focusKey && s.new ? btn(t('Naučit se další nové verše ({n})', { n: Math.min(s.new, 4) }), () => { extraNew += 4; fill(); show(); }) : null,
        btn(t('Zpět k písni'), () => nav.back(), 'btn primary'))));
  }

  const onKey = e => {
    if (e.target.closest('input, textarea, select') || document.querySelector('.sheet')) return;
    if (!cur) return;
    if (cur.revealed && /^[1-4]$/.test(e.key)) { e.preventDefault(); rate(+e.key); }
    else if (!cur.revealed && (e.code === 'Space' || e.key === 'Enter') && ['intro', 'initials', 'recall', 'fromCz', 'before'].includes(cur.ex)) {
      e.preventDefault();
      if (cur.ex === 'intro') nextFromIntro(); else reveal();
    }
  };
  document.addEventListener('keydown', onKey);
  document.documentElement.style.setProperty('--lyric-size', `${getPrefs().lyricSize}rem`);
  show();
  attachMedia(player, version, media, ready, { needTimed: true });
  return () => { player.destroy(); document.removeEventListener('keydown', onKey); };
}
