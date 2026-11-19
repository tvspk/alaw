// Lekce „Učit se“: nové verše, opakování v intervalech, vybavení dalšího verše, psaní zpaměti.
// Adresa #/learn/<id písně> (celá lekce) nebo #/learn/<id>/<klíč verše> (procvičit jen jeden verš z mapy písně).
import { el, iconBtn, toast } from './ui.js';
import { getSong, getAudioBlob, getPrefs, setPrefs, getProgress, saveProgress } from './store.js';
import { primaryVersion } from './model.js';
import { Player } from './player.js';
import {
  songUnits, freshRec, introduce, grade, previews, GRADES, buildQueue, introducedToday, exerciseFor,
  compareTyped, songSummary, fmtIvl,
} from './learn.js';

const WORD_RE = /^([^\p{L}\p{N}]*)(.*?)([^\p{L}\p{N}]*)$/u;
const TITLES = { intro: 'Nový verš', initials: 'Podle prvních písmen', recall: 'Jak verš zní?', type: 'Napiš zpaměti' };

export async function renderLesson(root, id, focusKey, nav) {
  const song = await getSong(id);
  if (!song) { root.append(el('div', { class: 'view' }, el('p', { class: 'empty', text: 'Píseň nenalezena.' }))); return; }
  const version = primaryVersion(song);
  const units = songUnits(song);
  const byKey = new Map(units.map(u => [u.k, u]));
  let recs = await getProgress(song.id);
  const player = new Player();
  player.rate = getPrefs().rate;
  let stopAt = null, extraNew = 0, done = 0;

  // ---------- fronta ----------
  let queue;
  function fill() {
    if (focusKey) { queue = byKey.has(focusKey) ? [focusKey] : []; return; }
    const left = Math.max(0, getPrefs().newPerDay + extraNew - introducedToday(recs));
    queue = buildQueue(units, recs, Date.now(), left);
  }
  fill();
  // verš, který se učím, se vrátí za pár karet (nejdřív, až uplyne jeho krok, nebo když nic jiného nezbývá)
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
  const view = el('div', { class: 'view lesson' }, top, media, el('div', { class: 'tools', style: { margin: '2px 0 10px' } }, typeChip), card);
  root.append(view);

  function updateCounter() {
    const s = songSummary(units, recs);
    counter.textContent = queue.length ? `Zbývá ${queue.length} · umíš ${s.known + s.due} z ${s.total}` : `Umíš ${s.known + s.due} z ${s.total}`;
  }

  // ---------- zvuk ----------
  const canPlay = i => i >= 0 && version.lines[i] && version.lines[i].start != null && player.ready;
  function playLine(i) {
    if (!canPlay(i)) return;
    const a = version.lines[i].start;
    const next = version.lines.slice(i + 1).find(l => l.start != null && l.start > a);
    stopAt = next ? next.start : a + 8000;
    player.playFrom(Math.max(0, a - 150));
  }
  player.onTime = t => { if (stopAt != null && t >= stopAt - 40) { stopAt = null; player.pause(); } };
  player.onError = msg => { media.replaceChildren(el('div', { class: 'media-error', text: msg })); };
  // až je nahrávka připravená, doplnit tlačítka poslechu (rozepsanou nebo odkrytou kartu nepřekreslovat)
  function ready() { player.setRate(player.rate); if (cur && !cur.revealed && cur.ex !== 'type') draw(); }
  async function setupMedia() {
    const timed = version.lines.some(l => l.start != null);
    if (!timed) return;
    if (version.audio) {
      const blob = await getAudioBlob(version.audio.key);
      if (blob) { player.loadAudio(blob); player.onReady = ready; return; }
    }
    if (version.youtubeId) {
      const wrap = el('div', { class: 'yt-wrap small' });
      media.replaceChildren(wrap);
      player.onReady = ready;
      await player.loadYouTube(wrap, version.youtubeId);
    }
  }
  const listenBtn = (i, label) => canPlay(i) ? el('button', { type: 'button', class: 'btn small', text: `▶ ${label}`, onclick: () => playLine(i) }) : null;

  // ---------- slova verše ----------
  function wordsOf(text, mode) { // mode: 'initials' = první písmena, 'hidden' = jen tečky za slova
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

  // ---------- karty ----------
  let cur = null; // { k, unit, rec, ex, revealed }

  function show() {
    updateCounter();
    if (!queue.length) { finish(); return; }
    const k = queue[0];
    const unit = byKey.get(k);
    const rec = recs.get(k) || freshRec(song.id, k);
    const ex = exerciseFor(rec, getPrefs().alwaysType);
    cur = { k, unit, rec, ex, revealed: false };
    draw();
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

  function draw() {
    const { unit, ex } = cur;
    const line = version.lines[unit.first];
    const body = [];
    if (ex === 'intro') {
      body.push(context(),
        el('div', { class: 'ltarget' }, el('div', { class: 'ltext', text: line.text }), ...extras(line)),
        el('div', { class: 'row' }, listenBtn(unit.first, 'Poslechnout verš')),
        el('p', { class: 'hint', text: 'Přečti si verš nahlas, poslechni si ho a zkus si ho zapamatovat. Za chvíli se tě na něj zeptám.' }),
        el('div', { class: 'row end' }, el('button', { type: 'button', class: 'btn primary', text: 'Dál', onclick: nextFromIntro })));
      if (getPrefs().autoPlayLine) setTimeout(() => playLine(unit.first), 50);
    } else if (ex === 'type') {
      const input = el('textarea', { class: 'ltype', rows: 2, lang: song.language || 'cy', autocapitalize: 'off', autocomplete: 'off', spellcheck: false,
        placeholder: 'Napiš verš zpaměti…', 'aria-label': 'Verš zpaměti' });
      input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); check(input.value); } });
      const hintBox = el('div', { class: 'lhint' });
      body.push(context(),
        el('div', { class: 'ltarget' }, input, hintBox),
        el('div', { class: 'row' },
          line.translation || line.alt ? el('button', { type: 'button', class: 'chip', text: 'Nápověda: překlad', onclick: e => { hintBox.append(el('div', { class: 'tr', text: line.translation || line.alt })); e.target.remove(); } }) : null,
          el('button', { type: 'button', class: 'chip', text: 'První písmena', onclick: e => { hintBox.append(el('div', { class: 'ltext small' }, wordsOf(line.text, 'initials'))); e.target.remove(); } })),
        el('div', { class: 'row end' },
          el('button', { type: 'button', class: 'btn', text: 'Nevím', onclick: () => check('') }),
          el('button', { type: 'button', class: 'btn primary', text: 'Zkontrolovat', onclick: () => check(input.value) })));
      setTimeout(() => input.focus(), 30);
    } else {
      const hidden = el('div', { class: 'ltext' }, ex === 'initials' ? wordsOf(line.text, 'initials') : el('span', { class: 'lq', text: '? ? ?' }));
      const hintBox = el('div', { class: 'lhint' });
      body.push(context(),
        el('div', { class: 'ltarget' }, hidden, ex === 'initials' && line.translation ? el('div', { class: 'tr', text: line.translation }) : null, hintBox),
        el('p', { class: 'hint', text: ex === 'initials' ? 'Řekni si celý verš nahlas, pak ho odkryj a ohodnoť, jak to šlo.' : 'Jak pokračuje píseň? Řekni si verš nahlas, pak ho odkryj a ohodnoť, jak to šlo.' }),
        el('div', { class: 'row' },
          ex === 'recall' && (line.translation || line.alt) ? el('button', { type: 'button', class: 'chip', text: 'Nápověda: překlad', onclick: e => { hintBox.append(el('div', { class: 'tr', text: line.translation || line.alt })); e.target.remove(); } }) : null,
          ex === 'recall' ? el('button', { type: 'button', class: 'chip', text: 'První písmena', onclick: e => { hidden.replaceChildren(...wordsOf(line.text, 'initials')); e.target.remove(); } }) : null),
        el('div', { class: 'row end' }, el('button', { type: 'button', class: 'btn primary', text: 'Odkrýt', onclick: reveal })));
    }
    card.replaceChildren(head(), ...body);
  }

  function reveal() {
    const line = version.lines[cur.unit.first];
    cur.revealed = true;
    card.replaceChildren(head(), context(),
      el('div', { class: 'ltarget shown' }, el('div', { class: 'ltext', text: line.text }), ...extras(line)),
      el('div', { class: 'row' }, listenBtn(cur.unit.first, 'Poslechnout verš')),
      el('p', { class: 'hint', text: 'Jak to šlo?' }),
      gradeRow(null));
    if (getPrefs().autoPlayLine) playLine(cur.unit.first);
  }

  function check(typed) {
    const line = version.lines[cur.unit.first];
    const r = compareTyped(line.text, typed);
    cur.revealed = true;
    const diff = el('div', { class: 'ltext diff' }, r.parts.flatMap((p, j) => [j ? ' ' : '',
      p.st === 'extra' ? el('s', { class: 'x-extra', text: p.typed, title: 'navíc' })
        : el('span', { class: `x-${p.st}`, text: p.text, title: p.st === 'typo' || p.st === 'bad' ? `napsáno: ${p.typed}` : p.st === 'miss' ? 'chybí' : '' })]));
    const verdict = !typed.trim() ? 'Nevadí, příště to půjde.' : r.errors === 0 ? (r.typos ? 'Správně (s drobným překlepem).' : 'Výborně, přesně!') : `Chyb: ${r.errors}.`;
    card.replaceChildren(head(), context(),
      el('div', { class: 'ltarget shown' },
        typed.trim() ? el('div', { class: 'ltyped', text: typed.trim() }) : null,
        diff, el('div', { class: 'lverdict' + (r.errors ? ' bad' : ' ok'), text: verdict }), ...extras(line)),
      el('div', { class: 'row' }, listenBtn(cur.unit.first, 'Poslechnout verš')),
      el('p', { class: 'hint', text: 'Jak to šlo? Zvýrazněné tlačítko je návrh podle chyb.' }),
      gradeRow(typed.trim() ? r.suggest : 1));
    if (getPrefs().autoPlayLine) playLine(cur.unit.first);
  }

  async function nextFromIntro() {
    const rec = introduce(cur.rec);
    await saveProgress(rec);
    recs.set(cur.k, rec);
    queue.shift();
    requeue(cur.k, rec);
    show();
  }

  async function rate(g) {
    if (!cur || !cur.revealed) return;
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
        !focusKey && s.new ? el('button', { type: 'button', class: 'btn', text: `Naučit se další nové verše (${Math.min(s.new, 4)})`, onclick: () => { extraNew += 4; fill(); show(); } }) : null,
        el('button', { type: 'button', class: 'btn primary', text: 'Zpět k písni', onclick: () => nav.back() }))));
  }

  const onKey = e => {
    if (e.target.closest('input, textarea, select') || document.querySelector('.sheet')) return;
    if (!cur) return;
    if (cur.revealed && /^[1-4]$/.test(e.key)) { e.preventDefault(); rate(+e.key); }
    else if (!cur.revealed && (e.code === 'Space' || e.key === 'Enter')) {
      e.preventDefault();
      if (cur.ex === 'intro') nextFromIntro(); else if (cur.ex !== 'type') reveal();
    }
  };
  document.addEventListener('keydown', onKey);
  document.documentElement.style.setProperty('--lyric-size', `${getPrefs().lyricSize}rem`);
  show();
  setupMedia();
  return () => { player.destroy(); document.removeEventListener('keydown', onKey); };
}
