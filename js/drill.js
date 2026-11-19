// Procvičování celé písně nebo sloky (mimo lekci): skládání sloky, rozmazávání, tahák pro zpěv, zkouška celé písně.
// Adresa #/drill/<id písně>/<režim>. Funguje bez časů; s časy navíc přehrání a smyčka sloky.
// Pokrok mění jen zkouška: verše, které nevíš, se vrátí do opakování (rozhodnutí zadavatele: známé se nemění).
import { el, fill, iconBtn, ICONS, toast } from './ui.js';
import { getSong, getPrefs, getProgress, saveProgress } from './store.js';
import { primaryVersion } from './model.js';
import { Player } from './player.js';
import { lineKey, freshRec, introduce, grade, shuffleNew } from './learn.js';
import { attachMedia, wordsOf } from './lesson.js';
import { analyze, unsureSpots } from './versions.js';

export const DRILLS = [
  ['order', '🧩', 'Skládání sloky', 'Přeházené verše sloky poskládej do správného pořadí.'],
  ['blur', '🌫', 'Rozmazávání', 'Opakuj sloku znovu a znovu, text se s každým kolem víc rozmaže.'],
  ['cheat', '🎤', 'Tahák pro zpěv', 'Celá píseň jen s prvním slovem verše – zpívej s nahrávkou.'],
  ['exam', '📝', 'Zkouška celé písně', 'Verš po verši od začátku. Co nevíš, vrátí se do opakování.'],
];
const BLUR = [0, 1.2, 2.4, 3.8, 5.5];   // px; další kolo = text úplně zmizí

// Sloky podle prázdných řádků; dlouhé bloky (bez prázdných řádků) po čtyřech verších.
export function stanzas(lines) {
  const groups = [];
  lines.forEach((l, i) => { if (!lineKey(l.text)) return; if (!groups.length || (l.stanza && groups.at(-1).length)) groups.push([]); groups.at(-1).push(i); });
  return groups.flatMap(g => (g.length > 8 ? Array.from({ length: Math.ceil(g.length / 4) }, (_, j) => g.slice(j * 4, j * 4 + 4)) : [g]));
}

export async function renderDrill(root, id, mode, nav) {
  const song = await getSong(id);
  const meta = DRILLS.find(d => d[0] === mode);
  if (!song || !meta) { root.append(el('div', { class: 'view' }, el('p', { class: 'empty', text: 'Píseň nenalezena.' }))); return; }
  const version = primaryVersion(song);
  const lines = version.lines;
  const groups = stanzas(lines);
  const player = new Player();
  player.rate = getPrefs().rate;
  let onTick = null, stopAt = null;

  // ---------- přehrávač (i bez časů: celá nahrávka) ----------
  const media = el('div', { class: 'lesson-media' });
  const playBtn = el('button', { type: 'button', class: 'play small', 'aria-label': 'Přehrát', html: ICONS.play, onclick: () => player.toggle() });
  const ctrl = el('div', { class: 'row drill-ctrl', hidden: true }, playBtn, iconBtn('rewind', 'O 5 sekund zpět', () => player.seek(player.time() - 5000)));
  player.onState = p => { playBtn.innerHTML = p ? ICONS.pause : ICONS.play; };
  player.onTime = t => {
    if (stopAt != null && t >= stopAt - 40) { stopAt = null; player.pause(); }
    if (onTick) onTick(t);
  };
  const timedRange = idx => {
    const a = lines[idx[0]].start;
    if (a == null) return null;
    const next = lines.slice(idx.at(-1) + 1).find(l => l.start != null && l.start > a);
    return [a, next ? next.start : null];
  };

  const area = el('div', { class: 'drill' });
  const view = el('div', { class: 'view lesson' },
    el('header', { class: 'topbar' }, iconBtn('back', 'Zpět', () => nav.back()),
      el('h1', {}, el('span', { text: `${meta[1]} ${meta[2]}` }), el('small', { text: song.title }))),
    media, ctrl, area);
  root.append(view);
  const btn = (text, onclick, cls = 'btn') => el('button', { type: 'button', class: cls, text, onclick });

  // výběr sloky
  let gi = 0;
  const chooser = (onPick, whole = false) => (groups.length > 1 || whole ? el('div', { class: 'chips' },
    whole ? el('button', { type: 'button', class: 'chip' + (gi === -1 ? ' on' : ''), text: 'Celá píseň', onclick: () => { gi = -1; onPick(); } }) : null,
    groups.map((g, j) => el('button', { type: 'button', class: 'chip' + (gi === j ? ' on' : ''), text: `Sloka ${j + 1}`, onclick: () => { gi = j; onPick(); } }))) : null);

  // ---------- skládání sloky ----------
  function order() {
    player.setLoop(null);
    const idx = groups[gi];
    if (!idx || idx.length < 2) { area.replaceChildren(chooser(order), el('p', { class: 'empty', text: 'Tahle sloka má jen jeden verš.' })); return; }
    const items = shuffleNew(idx.map(i => ({ i, k: lineKey(lines[i].text), text: lines[i].text })), x => x.k);
    const placed = [];
    const range = timedRange(idx);
    function draw(result) {
      const right = idx.map(i => lineKey(lines[i].text));
      fill(area, chooser(order),
        el('p', { class: 'hint', text: 'Ťukej verše ve správném pořadí. Ťuknutím na poskládaný verš ho vrátíš.' }),
        range && player.ready ? el('div', { class: 'row' }, btn('▶ Poslechnout sloku', () => { stopAt = range[1]; player.playFrom(Math.max(0, range[0] - 150)); }, 'btn small')) : null,
        el('ol', { class: 'ord-placed' }, placed.map((x, j) => el('li', {},
          el('button', { type: 'button', class: 'ord-line' + (result ? (x.k === right[j] ? ' ok' : ' bad') : ''), text: x.text,
            onclick: () => { if (result) return; placed.splice(j, 1); draw(); } })))),
        el('div', { class: 'ord-pool' }, items.filter(x => !placed.includes(x)).map(x => btn(x.text, () => {
          placed.push(x);
          draw(placed.length === items.length);
        }, 'ord-line'))),
        result ? resultRow(placed.filter((x, j) => x.k !== right[j]).length) : null);
    }
    function resultRow(errors) {
      return el('div', { class: 'ldone' },
        el('div', { class: 'lverdict ' + (errors ? 'bad' : 'ok'), text: errors ? `Na špatném místě: ${errors}` : 'Správně! 🎉' }),
        el('div', { class: 'row', style: { justifyContent: 'center', marginTop: '10px' } },
          btn('Zkusit znovu', order),
          groups.length > 1 ? btn('Další sloka', () => { gi = (gi + 1) % groups.length; order(); }, 'btn primary') : null));
    }
    draw(false);
  }

  // ---------- rozmazávání ----------
  function blur() {
    let round = 0, lastT = 0, looping = false;
    const idx = gi === -1 ? groups.flat() : groups[gi];
    const range = gi === -1 ? null : timedRange(idx);
    const text = el('div', { class: 'blur-text' });
    const label = el('span', { class: 'blur-round' });
    const peek = new Set();
    function paint() {
      const gone = round >= BLUR.length;
      text.style.setProperty('--blur', `${gone ? 0 : BLUR[round]}px`);
      text.replaceChildren(...idx.map(i => el('div', { class: 'blur-line' + (lines[i].stanza && i !== idx[0] ? ' stanza' : '') + (peek.has(i) ? ' peek' : ''), dataset: { i } },
        gone && !peek.has(i) ? el('span', { class: 'lq', text: '· · ·' }) : lines[i].text)));
      label.textContent = gone ? `Kolo ${round + 1}: bez textu` : `Kolo ${round + 1}`;
    }
    text.addEventListener('click', e => { // ťuknutí na verš = krátce ho ukázat ostře
      const d = e.target.closest('.blur-line'); if (!d) return;
      const i = +d.dataset.i; peek.add(i); paint(); setTimeout(() => { peek.delete(i); paint(); }, 1800);
    });
    const next = () => { round = Math.min(BLUR.length, round + 1); paint(); };
    const loopBtn = range && player.ready ? btn('🔁 Smyčka sloky (kolo se přidá samo)', () => {
      looping = !looping;
      loopBtn.classList.toggle('on', looping);
      if (looping) { player.setLoop(range[0], range[1]); player.playFrom(Math.max(0, range[0] - 150)); } else { player.setLoop(null); player.pause(); }
    }, 'btn small') : null;
    onTick = t => { if (looping && lastT - t > 1000) next(); lastT = t; };
    player.setLoop(null);
    fill(area, chooser(blur, true),
      el('p', { class: 'hint', text: 'Řekni nebo zazpívej text, pak přidej kolo – text se víc rozmaže. Ťuknutím na verš ho krátce ukážeš.' }),
      loopBtn ? el('div', { class: 'row' }, loopBtn) : null,
      text,
      el('div', { class: 'row', style: { justifyContent: 'space-between', marginTop: '12px' } },
        btn('◀ Ostřeji', () => { round = Math.max(0, round - 1); paint(); }), label, btn('Další kolo ▶', next, 'btn primary')));
    paint();
  }

  // ---------- tahák pro zpěv ----------
  function cheat() {
    let style = 'word';
    const list = el('ol', { class: 'lyrics cheat' });
    const open = new Set();
    function paint() {
      list.replaceChildren(...lines.map((l, i) => {
        if (!lineKey(l.text)) return el('li', { class: 'lyric' + (l.stanza ? ' stanza' : '') }, el('div', { class: 'body' }, el('div', { class: 'text', text: l.text })));
        const words = l.text.split(/\s+/);
        const body = open.has(i) ? l.text : style === 'word' ? `${words[0]} …` : null;
        return el('li', { class: 'lyric' + (l.stanza ? ' stanza' : ''), dataset: { i } },
          el('div', { class: 'body' }, el('div', { class: 'text' }, body ?? wordsOf(l.text, 'initials'))));
      }));
    }
    list.addEventListener('click', e => {
      const li = e.target.closest('.lyric[data-i]'); if (!li) return;
      const i = +li.dataset.i; open.has(i) ? open.delete(i) : open.add(i); paint();
    });
    let active = -1;
    onTick = t => {
      let a = -1;
      lines.forEach((l, i) => { if (l.start != null && l.start <= t + 80) a = i; });
      if (a === active) return;
      list.querySelector('.active')?.classList.remove('active');
      active = a;
      list.querySelector(`[data-i="${a}"]`)?.classList.add('active');
    };
    const chips = el('div', { class: 'chips' },
      [['word', 'První slovo'], ['initials', 'První písmena']].map(([k, label]) => el('button', { type: 'button', class: 'chip' + (style === k ? ' on' : ''), text: label,
        onclick: e => { style = k; chips.querySelectorAll('.chip').forEach(c => c.classList.remove('on')); e.target.classList.add('on'); paint(); } })));
    player.setLoop(null);
    area.replaceChildren(chips, el('p', { class: 'hint', text: 'Pusť si nahrávku a zpívej. Ťuknutím na verš ho ukážeš celý.' }), list);
    paint();
  }

  // ---------- zkouška celé písně ----------
  async function exam() {
    const recs = await getProgress(song.id);
    const vres = song.versions.length > 1 ? analyze(song) : [];
    const order = lines.map((l, i) => i).filter(i => lineKey(lines[i].text));
    const failed = new Set();
    let pos = 0;
    const doneBox = el('ol', { class: 'exam-done' });
    const cur = el('div', { class: 'lcard' });
    function step() {
      if (pos >= order.length) { finishExam(); return; }
      const i = order[pos];
      cur.replaceChildren(
        el('div', { class: 'lhead' }, el('span', { class: 'lex', text: `Verš ${pos + 1} z ${order.length}` })),
        el('div', { class: 'ltarget' }, el('div', { class: 'ltext' }, el('span', { class: 'lq', text: '? ? ?' }))),
        el('p', { class: 'hint', text: 'Řekni si verš nahlas (nebo zazpívej), pak ho odkryj.' }),
        el('div', { class: 'row end' }, btn('Odkrýt', () => {
          cur.replaceChildren(
            el('div', { class: 'lhead' }, el('span', { class: 'lex', text: `Verš ${pos + 1} z ${order.length}` })),
            el('div', { class: 'ltarget shown' }, el('div', { class: 'ltext', text: lines[i].text }),
              ...(vres.length ? unsureSpots(song, [i], vres) : []).map(sp => el('div', { class: 'lvariant', text: `⚠ Nejisté: jiná verze má ${sp.b ? `„${sp.b}“` : 'tu nic'}${sp.a ? ` místo „${sp.a}“` : ''} – uznej si obojí` }))),
            el('div', { class: 'row', style: { justifyContent: 'center' } },
              btn('✗ Nevěděl(a) jsem', () => answer(false), 'btn danger'),
              btn('✓ Věděl(a) jsem', () => answer(true), 'btn primary')));
        }, 'btn primary')));
    }
    function answer(ok) {
      const i = order[pos];
      if (!ok) failed.add(lineKey(lines[i].text));
      doneBox.append(el('li', { class: (ok ? 'ok' : 'bad') + (lines[i].stanza && pos ? ' stanza' : ''), text: lines[i].text }));
      pos++;
      step();
      cur.scrollIntoView({ block: 'nearest' });
    }
    async function finishExam() {
      const now = Date.now();
      const recsOut = [...failed].map(k => {
        const r = recs.get(k) || freshRec(song.id, k);
        return r.st === 'new' ? introduce(r, now) : grade(r, 1, now);   // zpět do učení
      });
      if (recsOut.length) await saveProgress(...recsOut);
      const n = order.length - [...order].filter(i => failed.has(lineKey(lines[i].text))).length;
      cur.replaceChildren(el('div', { class: 'ldone' },
        el('div', { class: 'big', text: failed.size ? `Umíš ${n} z ${order.length} veršů` : 'Celá píseň bez chyby! 🎉' }),
        failed.size ? el('p', { text: `${failed.size} ${failed.size === 1 ? 'verš se vrátí' : failed.size < 5 ? 'verše se vrátí' : 'veršů se vrátí'} do opakování.` }) : null,
        el('div', { class: 'row', style: { justifyContent: 'center' } },
          failed.size ? btn('🎓 Učit se je teď', () => nav.replace(`#/learn/${encodeURIComponent(song.id)}`), 'btn primary') : null,
          btn('Zpět k písni', () => nav.back()))));
      if (failed.size) toast('Verše, které jsi nevěděl(a), jsou zpátky v opakování');
    }
    area.replaceChildren(el('p', { class: 'hint', text: 'Projdi celou píseň od začátku. Známé verše se nemění, ty, které nevíš, se vrátí do opakování.' }), doneBox, cur);
    step();
  }

  const run = { order, blur, cheat, exam }[mode];
  run();
  attachMedia(player, version, media, () => { ctrl.hidden = false; if (mode === 'order' || mode === 'blur') run(); });
  document.documentElement.style.setProperty('--lyric-size', `${getPrefs().lyricSize}rem`);
  return () => player.destroy();
}
