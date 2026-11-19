// Lekce „Učit se“: nové verše a opakování v intervalech. Cvičení na verš střídá aplikace sama podle síly verše
// (learn.pickExercise); s nahrávkou (diktát, poslech) jen u načasovaných veršů.
// Adresa #/learn/<id písně> (celá lekce) nebo #/learn/<id>/<klíč verše> (procvičit jen jeden verš z mapy písně).
import { el, iconBtn } from './ui.js';
import { getSong, getAudioBlob, getPrefs, setPrefs, getProgress, saveProgress } from './store.js';
import { primaryVersion } from './model.js';
import { Player } from './player.js';
import {
  songUnits, freshRec, introduce, grade, previews, GRADES, buildQueue, introducedToday, pickExercise,
  compareTyped, songSummary, fmtIvl, lineKey, songWords, wordDistractors, lineDistractors, shuffle, shuffleNew, orderErrors,
} from './learn.js';

const WORD_RE = /^([^\p{L}\p{N}]*)(.*?)([^\p{L}\p{N}]*)$/u;
const TITLES = {
  intro: 'Nový verš', initials: 'Podle prvních písmen', recall: 'Jak verš zní?', type: 'Napiš zpaměti',
  choiceWord: 'Doplň slovo', scramble: 'Poskládej verš', flash: 'Bliknutí', choice3: 'Který verš následuje?',
  fromCz: 'Z češtiny do velštiny', before: 'Co je před tímto veršem?', dictation: 'Diktát',
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
  if (!song) { root.append(el('div', { class: 'view' }, el('p', { class: 'empty', text: 'Píseň nenalezena.' }))); return; }
  const version = primaryVersion(song);
  const units = songUnits(song);
  const byKey = new Map(units.map(u => [u.k, u]));
  const allWords = songWords(song);
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
    iconBtn('back', 'Zpět', () => nav.back()),
    el('h1', {}, el('span', { text: song.title }), counter));
  const typeChip = el('button', { type: 'button', class: 'chip', text: '✍ Vždy psát', onclick: () => {
    setPrefs({ alwaysType: !getPrefs().alwaysType }); typeChip.classList.toggle('on', getPrefs().alwaysType); show();
  } });
  typeChip.classList.toggle('on', getPrefs().alwaysType);
  const media = el('div', { class: 'lesson-media' });
  const card = el('div', { class: 'lcard' });
  root.append(el('div', { class: 'view lesson' }, top, media, el('div', { class: 'tools', style: { margin: '2px 0 10px' } }, typeChip), card));

  function updateCounter() {
    const s = songSummary(units, recs);
    counter.textContent = queue.length ? `Zbývá ${queue.length} · umíš ${s.known + s.due} z ${s.total}` : `Umíš ${s.known + s.due} z ${s.total}`;
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
      hasTr: !!(line.translation || line.alt),
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
      const all = toks.map((t, i) => [t, i]).filter(([t]) => lineKey(t));
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
    const stLabel = !rec || rec.st === 'new' ? 'nový' : rec.st === 'learn' ? (rec.lapses ? 'znovu se učím' : 'učím se') : `opakování · interval ${fmtIvl(rec.ivl)}`;
    const nums = unit.lines.map(i => i + 1).join(', ');
    return el('div', { class: 'lhead' },
      el('span', { class: 'lex', text: TITLES[ex] }),
      el('span', { class: 'lmeta', text: `verš ${nums}${unit.lines.length > 1 ? ' (opakuje se)' : ''} · ${stLabel}` }));
  }

  function context() {
    const i = cur.unit.first - 1;
    const prev = i >= 0 ? version.lines[i] : null;
    return el('div', { class: 'lprev' },
      el('div', { class: 'lprev-label', text: prev ? 'Předchozí verš' : 'Začátek písně' }),
      prev ? el('div', { class: 'lprev-text', text: prev.text }) : null,
      prev ? listenBtn(i, 'Předchozí verš') : null);
  }

  function extras(line) {
    return [
      line.translation ? el('div', { class: 'tr', text: line.translation }) : null,
      line.alt ? el('div', { class: 'alt', text: line.alt }) : null,
      line.literal ? el('div', { class: 'lit', text: line.literal }) : null,
      line.contractions.length ? el('div', { class: 'contr' }, line.contractions.map(c => el('span', { text: `${c.short} → ${c.full}`, title: c.note }))) : null,
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
  const revealRow = () => el('div', { class: 'row end' }, btn('Odkrýt', () => reveal(), 'btn primary'));
  const hidden3 = () => el('span', { class: 'lq', text: '? ? ?' });

  function draw() {
    const { unit, ex, line, data } = cur;
    const body = [];
    const hintBox = el('div', { class: 'lhint' });
    const trHint = () => (line.translation || line.alt) ? hintChip('Nápověda: překlad', () => hintBox.append(el('div', { class: 'tr', text: line.translation || line.alt }))) : null;

    if (ex === 'intro') {
      body.push(context(),
        el('div', { class: 'ltarget' }, el('div', { class: 'ltext', text: line.text }), ...extras(line)),
        el('div', { class: 'row' }, listenBtn(unit.first, 'Poslechnout verš')),
        el('p', { class: 'hint', text: 'Přečti si verš nahlas, poslechni si ho a zkus si ho zapamatovat. Za chvíli se tě na něj zeptám.' }),
        el('div', { class: 'row end' }, btn('Dál', nextFromIntro, 'btn primary')));
      if (getPrefs().autoPlayLine) setTimeout(() => playLine(unit.first), 50);

    } else if (ex === 'type' || ex === 'dictation') {
      const input = el('textarea', { class: 'ltype', rows: 2, lang: song.language || 'cy', autocapitalize: 'off', autocomplete: 'off', spellcheck: false,
        placeholder: ex === 'dictation' ? 'Napiš, co slyšíš…' : 'Napiš verš zpaměti…', 'aria-label': 'Verš' });
      input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); check(input.value); } });
      body.push(ex === 'type' ? context() : el('div', { class: 'row' },
        btn('▶ Přehrát verš', () => playLine(unit.first), 'btn primary small'),
        btn('🐢 Pomaleji', () => playLine(unit.first, 0.75), 'btn small')),
      el('div', { class: 'ltarget' }, input, hintBox),
      el('div', { class: 'row' }, ex === 'type' ? trHint() : null,
        hintChip('První písmena', () => hintBox.append(el('div', { class: 'ltext small' }, wordsOf(line.text, 'initials'))))),
      el('div', { class: 'row end' }, btn('Nevím', () => check('')), btn('Zkontrolovat', () => check(input.value), 'btn primary')));
      if (ex === 'dictation') setTimeout(() => playLine(unit.first), 50);
      setTimeout(() => input.focus(), 30);

    } else if (ex === 'choiceWord') {
      const sentence = el('div', { class: 'ltext' }, data.toks.map((t, i) => (i === data.i
        ? [data.lead, el('span', { class: 'blank', text: '____' }), data.trail] : t)));
      body.push(context(), el('div', { class: 'ltarget' }, sentence, hintBox),
        el('p', { class: 'hint', text: 'Které slovo chybí?' }),
        el('div', { class: 'choices' }, data.options.map(o => btn(o, () => pick(o === data.core, o), 'choice'))),
        el('div', { class: 'row' }, trHint()));

    } else if (ex === 'choice3') {
      body.push(context(),
        el('p', { class: 'hint', text: unit.first ? 'Který verš následuje?' : 'Kterým veršem píseň začíná?' }),
        el('div', { class: 'choices lines' }, data.options.map(u => btn(u.text, () => pick(u.k === cur.k, u.text), 'choice'))));

    } else if (ex === 'scramble') {
      const placed = el('div', { class: 'sc-placed' }, data.placed.length ? data.placed.map((t, j) =>
        btn(t.w, () => { data.placed.splice(j, 1); draw(); }, 'sc-word on')) : el('span', { class: 'lq small', text: 'ťukej slova ve správném pořadí' }));
      const left = data.toks.filter(t => !data.placed.includes(t));
      body.push(context(), el('div', { class: 'ltarget' }, placed),
        el('div', { class: 'sc-pool' }, left.map(t => btn(t.w, () => {
          data.placed.push(t);
          if (data.placed.length === data.toks.length) checkScramble(); else draw();
        }, 'sc-word'))),
        el('div', { class: 'row' }, trHint()), hintBox);

    } else if (ex === 'flash') {
      const ms = window.__alawFlashMs || Math.max(1500, 600 + 380 * line.text.split(/\s+/).length);
      const box = el('div', { class: 'ltext', text: line.text });
      const bar = el('div', { class: 'flashbar' }, el('i', { style: { animationDuration: `${ms}ms` } }));
      body.push(context(), el('div', { class: 'ltarget' }, box, bar),
        el('p', { class: 'hint', text: 'Zapamatuj si verš, za chvilku zmizí. Pak si ho řekni nahlas a odkryj.' }));
      const mine = cur;
      setTimeout(() => {
        if (cur !== mine || cur.revealed) return;
        box.replaceChildren(hidden3());
        bar.remove();
        card.append(revealRow());
      }, ms);

    } else if (ex === 'fromCz') {
      body.push(el('div', { class: 'lprev' }, el('div', { class: 'lprev-label', text: 'Česky' }),
        el('div', { class: 'lprev-text cz', text: line.translation || line.alt })),
      el('div', { class: 'ltarget' }, el('div', { class: 'ltext' }, hidden3())),
      el('p', { class: 'hint', text: 'Jak tenhle verš zní v originále? Řekni ho nahlas, pak odkryj.' }),
      revealRow());

    } else if (ex === 'before') {
      const nxt = unit.first + 1;
      body.push(el('div', { class: 'lprev' }, el('div', { class: 'lprev-label', text: 'Tento verš' }),
        el('div', { class: 'lprev-text', text: version.lines[nxt].text }), listenBtn(nxt, 'Poslechnout')),
      el('div', { class: 'ltarget' }, el('div', { class: 'ltext' }, hidden3())),
      el('p', { class: 'hint', text: 'Který verš je těsně před ním? Řekni ho nahlas, pak odkryj.' }),
      revealRow());

    } else { // initials, recall
      const hidden = el('div', { class: 'ltext' }, ex === 'initials' ? wordsOf(line.text, 'initials') : hidden3());
      body.push(context(),
        el('div', { class: 'ltarget' }, hidden, ex === 'initials' && line.translation ? el('div', { class: 'tr', text: line.translation }) : null, hintBox),
        el('p', { class: 'hint', text: ex === 'initials' ? 'Řekni si celý verš nahlas, pak ho odkryj a ohodnoť, jak to šlo.' : 'Jak pokračuje píseň? Řekni si verš nahlas, pak ho odkryj a ohodnoť, jak to šlo.' }),
        el('div', { class: 'row' },
          ex === 'recall' ? trHint() : null,
          ex === 'recall' ? hintChip('První písmena', () => hidden.replaceChildren(...wordsOf(line.text, 'initials'))) : null),
        revealRow());
    }
    card.replaceChildren(head(), ...body);
  }

  // odkrytá karta: celý verš + hodnocení (suggest = zvýrazněný návrh)
  function reveal(top = null, suggest = null, note = 'Jak to šlo?') {
    const line = cur.line;
    cur.revealed = true;
    const ctx = ['fromCz', 'before', 'dictation'].includes(cur.ex) ? null : context();
    card.replaceChildren(head(), ...(ctx ? [ctx] : []),
      el('div', { class: 'ltarget shown' }, ...(top || [el('div', { class: 'ltext', text: line.text })]), ...extras(line)),
      cur.ex === 'before' ? el('div', { class: 'lprev' }, el('div', { class: 'lprev-label', text: 'Pak následuje' }), el('div', { class: 'lprev-text', text: version.lines[cur.unit.first + 1].text })) : null,
      el('div', { class: 'row' }, listenBtn(cur.unit.first, 'Poslechnout verš')),
      el('p', { class: 'hint', text: note }),
      gradeRow(suggest));
    if (getPrefs().autoPlayLine && cur.ex !== 'dictation') playLine(cur.unit.first);
  }

  function pick(ok, chosen) {
    const verdict = el('div', { class: 'lverdict ' + (ok ? 'ok' : 'bad'), text: ok ? 'Správně!' : `Ne – vybral(a) jsi „${chosen}“.` });
    reveal([el('div', { class: 'ltext', text: cur.line.text }), verdict], ok ? 3 : 1, 'Jak to šlo? Zvýrazněné tlačítko je návrh.');
  }

  function checkScramble() {
    const d = cur.data;
    const right = d.toks.slice().sort((a, b) => a.i - b.i);
    const errors = orderErrors(d.placed.map(t => t.k), right.map(t => t.k));
    const mine = el('div', { class: 'ltext diff' }, d.placed.flatMap((t, j) => [j ? ' ' : '',
      el('span', { class: t.k === right[j].k ? 'x-ok' : 'x-bad', text: t.w })]));
    const verdict = el('div', { class: 'lverdict ' + (errors ? 'bad' : 'ok'),
      text: errors ? `Na špatném místě: ${errors} ${errors === 1 ? 'slovo' : errors < 5 ? 'slova' : 'slov'}.` : 'Správně!' });
    reveal(errors ? [mine, el('div', { class: 'ltext', text: cur.line.text }), verdict] : [el('div', { class: 'ltext', text: cur.line.text }), verdict],
      errors === 0 ? 3 : errors <= 2 ? 2 : 1, 'Jak to šlo? Zvýrazněné tlačítko je návrh podle chyb.');
  }

  function check(typed) {
    const r = compareTyped(cur.line.text, typed);
    const diff = el('div', { class: 'ltext diff' }, r.parts.flatMap((p, j) => [j ? ' ' : '',
      p.st === 'extra' ? el('s', { class: 'x-extra', text: p.typed, title: 'navíc' })
        : el('span', { class: `x-${p.st}`, text: p.text, title: p.st === 'typo' || p.st === 'bad' ? `napsáno: ${p.typed}` : p.st === 'miss' ? 'chybí' : '' })]));
    const verdict = !typed.trim() ? 'Nevadí, příště to půjde.' : r.errors === 0 ? (r.typos ? 'Správně (s drobným překlepem).' : 'Výborně, přesně!') : `Chyb: ${r.errors}.`;
    reveal([typed.trim() ? el('div', { class: 'ltyped', text: typed.trim() }) : null, diff,
      el('div', { class: 'lverdict' + (r.errors ? ' bad' : ' ok'), text: verdict })].filter(Boolean), typed.trim() ? r.suggest : 1,
    'Jak to šlo? Zvýrazněné tlačítko je návrh podle chyb.');
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
    const day = t => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
    const days = Math.round((day(due) - day(now)) / 86400e3);
    return days <= 0 ? 'dnes později' : days === 1 ? 'zítra' : `za ${fmtIvl(days)}`;
  }

  function finish() {
    cur = null;
    const s = songSummary(units, recs);
    const now = Date.now();
    const next = [...recs.values()].filter(r => r.st !== 'new' && r.due > now).sort((a, b) => a.due - b.due)[0];
    const nextTxt = next ? `Další opakování ${whenTxt(next.due, now)}.` : '';
    card.replaceChildren(el('div', { class: 'ldone' },
      el('div', { class: 'big', text: focusKey ? 'Hotovo' : done || s.known + s.due ? 'Pro dnešek hotovo 🎉' : 'Nic k učení' }),
      el('p', { text: `Umíš ${s.known + s.due} z ${s.total} veršů${s.learn ? `, ${s.learn} se učíš` : ''}. ${nextTxt}` }),
      el('div', { class: 'row', style: { justifyContent: 'center' } },
        !focusKey && s.new ? btn(`Naučit se další nové verše (${Math.min(s.new, 4)})`, () => { extraNew += 4; fill(); show(); }) : null,
        btn('Zpět k písni', () => nav.back(), 'btn primary'))));
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
