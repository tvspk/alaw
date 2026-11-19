// Porovnání verzí textu: sporná místa hlavní verze proti jiné verzi, poslech verše ve smyčce (0,75×), rozhodnutí
// ✓ platí hlavní / ✓ platí druhá (přepíše hlavní verzi, pokrok verše zůstane) / ⚠ nejisté. Logika v versions.js.
// Adresa #/compare/<id písně>[/<id verze>[/<verš hlavní verze>]].
import { el, iconBtn, ICONS, sheet, menu, toast } from './ui.js';
import { getSong, saveSong, moveProgress, deleteAudioBlob, getPrefs } from './store.js';
import { primaryVersion, formatMs } from './model.js';
import { Player } from './player.js';
import { attachMedia, lineRange } from './lesson.js';
import { MAX_VERSIONS, STATE, analyze, summary, decide, addOtherLines, prune, splitWords, otherVersions } from './versions.js';

const RATES = [0.75, 0.5, 1];

export async function renderCompare(root, id, versionId, focusLi, nav) {
  const song = await getSong(id);
  if (!song) { root.append(el('div', { class: 'view' }, el('p', { class: 'empty', text: 'Píseň nenalezena.' }))); return; }
  const main = () => primaryVersion(song);
  let other = otherVersions(song).find(v => v.id === versionId) || otherVersions(song)[0];
  const st = { filter: 'todo', source: null, rate: 0.75, looping: null, focus: focusLi };
  const player = new Player();
  player.rate = st.rate;
  let tick = null;
  let tapPlayBtn = null; // tlačítko přehrávání v okně časování verše

  const top = el('header', { class: 'topbar' },
    iconBtn('back', 'Zpět', () => nav.back()),
    el('h1', {}, el('span', { text: 'Porovnat verze' }), el('small', { text: song.title })),
    other ? iconBtn('more', 'Možnosti verze', openMenu) : null);
  const view = el('div', { class: 'view compare' }, top);
  root.append(view);

  if (!other) {
    view.append(el('div', { class: 'section' },
      el('p', { text: 'Píseň má zatím jen hlavní verzi textu. Přidej text z jiného zdroje (jiná webová stránka, zpěvník, přepis z videa) a aplikace ukáže, kde se liší.' }),
      el('div', { class: 'row' }, el('button', { type: 'button', class: 'btn primary', text: '＋ Přidat verzi textu', onclick: () => nav.replace(`#/version/${encodeURIComponent(song.id)}/new`) }))));
    return () => player.destroy();
  }

  // ---------- přepínač verzí, nahrávka ----------
  const chips = el('div', { class: 'tools vchips' });
  const info = el('div', { class: 'vinfo' });
  const media = el('div', { class: 'lesson-media' });
  const playBtn = el('button', { type: 'button', class: 'play small', 'aria-label': 'Přehrát', html: ICONS.play, onclick: () => player.toggle() });
  const timeEl = el('span', { class: 'time', text: '' });
  const rateBtn = el('button', { type: 'button', class: 'pill on', onclick: () => {
    st.rate = RATES[(RATES.indexOf(st.rate) + 1) % RATES.length];
    player.setRate(st.rate); updateRate();
  } });
  const srcBtn = el('button', { type: 'button', class: 'pill', hidden: true, onclick: () => loadMedia(st.source === 'other' ? 'main' : 'other') });
  const ctrl = el('div', { class: 'row drill-ctrl', hidden: true }, playBtn, iconBtn('rewind', 'O 5 sekund zpět', () => player.seek(player.time() - 5000)), timeEl,
    el('span', { class: 'grow' }), srcBtn, rateBtn);
  const mediaNote = el('p', { class: 'hint', hidden: true });
  const sum = el('div', { class: 'vsum' });
  const list = el('div', { class: 'spots' });
  view.append(chips, info, media, ctrl, mediaNote, sum, list);

  const updateRate = () => { rateBtn.textContent = `${String(st.rate).replace('.', ',')}×`; rateBtn.classList.toggle('on', st.rate !== 1); };
  const hasMedia = v => !!(v.audio || v.youtubeId);
  player.onState = p => { for (const b of [playBtn, tapPlayBtn]) if (b) b.innerHTML = p ? ICONS.pause : ICONS.play; };
  player.onTime = t => { timeEl.textContent = formatMs(t, false); if (tick) tick(t); };
  player.onError = msg => { mediaNote.textContent = msg; mediaNote.hidden = false; };

  // zdroj nahrávky: 'main' (hlavní verze) | 'other' (vlastní nahrávka porovnávané verze)
  async function loadMedia(src) {
    const v = src === 'other' ? other : main();
    st.source = src; st.looping = null;
    srcBtn.hidden = !(hasMedia(main()) && hasMedia(other));
    srcBtn.textContent = src === 'other' ? `♪ ${other.label}` : '♪ Hlavní';
    media.replaceChildren();
    mediaNote.hidden = true;
    ctrl.hidden = true;
    player.destroy();
    const ok = await attachMedia(player, v, media, () => { ctrl.hidden = false; player.setRate(st.rate); render(); });
    if (!ok) {
      ctrl.hidden = true;
      mediaNote.hidden = false;
      mediaNote.textContent = v.audio ? `Nahrávka „${v.audio.name}“ v tomto zařízení není.` : 'Bez nahrávky. Rozdíly můžeš rozhodnout i tak, poslechem jinde.';
    }
    render();
  }
  const mediaVersion = () => (st.source === 'other' ? other : main());

  // ---------- seznam sporných míst ----------
  let res = null;
  function compute() { res = analyze(song).find(r => r.version.id === other.id); }

  function marked(words, from, count, add, cls) {
    // slova verše; [from, from+count) nahradit slovy add (zvýrazněná); count = 0 a add prázdné → značka chybějícího místa
    const out = [];
    const w = words.slice();
    const repl = add ? splitWords(add) : w.slice(from, from + count);
    const before = w.slice(0, from), after = w.slice(from + count);
    if (before.length) out.push(before.join(' ') + ' ');
    out.push(repl.length ? el('mark', { class: cls, text: repl.join(' ') }) : el('mark', { class: `${cls} gap`, text: '‸', title: 'tady slova chybí' }));
    if (after.length) out.push(' ' + after.join(' '));
    return out;
  }

  function spotCard(s) {
    const lines = main().lines;
    const head = el('div', { class: 'spot-head' },
      el('span', { text: s.kind === 'mixed' ? `Verše ${s.lines.map(i => i + 1).join(', ')}` : `Verš ${s.li + 1}` }),
      el('span', { class: `spot-st st-${s.st}`, text: (s.st === 'ok' ? '✓ ' : '⚠ ') + STATE[s.st] }));
    let rowMain, rowOther;
    if (s.kind === 'word') {
      const words = splitWords(lines[s.li].text);
      rowMain = el('div', { class: 'spot-line' }, el('span', { class: 'vlabel', text: 'Hlavní' }), el('span', { class: 'vtext' }, marked(words, s.w, s.n, null, 'd-a')));
      rowOther = el('div', { class: 'spot-line' }, el('span', { class: 'vlabel', text: other.label }), el('span', { class: 'vtext' }, marked(words, s.w, s.n, s.b, 'd-b')));
    } else {
      rowMain = el('div', { class: 'spot-line' }, el('span', { class: 'vlabel', text: 'Hlavní' }), el('span', { class: 'vtext' }, el('mark', { class: 'd-a', text: s.a })));
      rowOther = el('div', { class: 'spot-line' }, el('span', { class: 'vlabel', text: other.label }), el('span', { class: 'vtext' }, el('mark', { class: 'd-b', text: s.b })));
    }
    const card = el('div', { class: `spot st-${s.st}`, dataset: { li: s.li, key: s.key } }, head, rowMain, rowOther, listenRow(s));
    const choice = (text, ch, on) => el('button', { type: 'button', class: 'btn small' + (on ? ' on' : ''), text, onclick: () => choose(s, on ? 'open' : ch) });
    card.append(el('div', { class: 'row decide' },
      choice('✓ Platí hlavní', 'main', s.st === 'ok'),
      s.kind === 'word' ? choice(`✓ Platí ${other.label}`, 'other', false) : null,
      choice('⚠ Nejisté', 'unsure', s.st === 'unsure')));
    if (s.kind === 'mixed') card.append(el('p', { class: 'hint', text: 'Přepsané verše uprav případně ručně v Upravit píseň.' }));
    return card;
  }

  // řádek poslechu: verš ve smyčce, nebo načasování verše, když čas chybí
  function listenRow(s) {
    if (!player.ready) return null;
    const v = mediaVersion();
    const idx = st.source === 'other' ? (s.kind === 'word' ? s.oli : s.oLines[0]) : s.li;
    if (idx == null || !v.lines[idx]) return null;
    const range = lineRange(v, idx);
    if (!range) {
      return el('div', { class: 'row' }, el('button', { type: 'button', class: 'btn small', text: '⏱ Načasovat verš', onclick: () => timeLine(v, idx, s) }),
        el('span', { class: 'hint', text: 'Verš nemá čas, smyčka ho potřebuje.' }));
    }
    const on = st.looping === s.key;
    return el('div', { class: 'row' },
      el('button', { type: 'button', class: 'btn small' + (on ? ' primary' : ''), text: on ? '⏹ Zastavit' : `🔁 Poslouchat verš (${String(st.rate).replace('.', ',')}×)`,
        onclick: () => (on ? stopLoop() : loopLine(v, idx, s.key)) }),
      el('button', { type: 'button', class: 'btn small ghost', text: '⏱', title: 'Přečasovat verš', 'aria-label': 'Přečasovat verš', onclick: () => timeLine(v, idx, s) }));
  }

  function loopLine(v, idx, key) {
    const [a, b] = lineRange(v, idx);
    player.setLoop(a, b);
    player.setRate(st.rate);
    player.playFrom(Math.max(0, a - 150));
    st.looping = key;
    render();
  }
  function stopLoop() { const was = st.looping; player.setLoop(null); player.pause(); st.looping = null; if (was) render(); }

  async function choose(s, ch) {
    const change = decide(song, s, ch);
    prune(song);
    await saveSong(song);
    if (change && await moveProgress(song.id, change.from, change.to)) toast('Verš opraven, pokrok zůstal');
    else if (ch === 'other') toast('Hlavní verze opravena');
    if (st.looping === s.key) stopLoop();
    render();
  }

  function blocks() {
    const out = [];
    const lines = main().lines;
    if (res.onlyOther.length) {
      out.push(el('h2', { class: 'spots-h', text: `Verše navíc ve verzi ${other.label}` }));
      for (const b of res.onlyOther) {
        out.push(el('div', { class: 'spot block' },
          el('div', { class: 'spot-head' }, el('span', { text: b.after < 0 ? 'Na začátku' : `Za veršem ${b.after + 1}` }),
            b.repeat ? el('span', { class: 'spot-st', text: 'opakovaný verš' }) : null),
          el('div', { class: 'spot-line' }, el('span', { class: 'vtext' }, b.oLines.map(li => el('div', {}, el('mark', { class: 'd-b', text: other.lines[li].text }))))),
          el('div', { class: 'row decide' }, el('button', { type: 'button', class: 'btn small', text: '＋ Přidat do hlavní verze', onclick: async () => {
            const n = addOtherLines(song, other, b);
            prune(song);
            await saveSong(song);
            toast(n === 1 ? 'Verš přidán do hlavní verze' : `${n} verše přidány do hlavní verze`);
            render();
          } }))));
      }
    }
    if (res.onlyMain.length) {
      out.push(el('h2', { class: 'spots-h', text: `Verše, které verze ${other.label} nemá` }));
      for (const b of res.onlyMain) {
        out.push(el('div', { class: 'spot block' },
          el('div', { class: 'spot-head' }, el('span', { text: `Verš ${b.lines.map(i => i + 1).join(', ')}` }),
            b.repeat ? el('span', { class: 'spot-st', text: 'opakovaný refrén' }) : null),
          el('div', { class: 'spot-line' }, el('span', { class: 'vtext' }, b.lines.map(li => el('div', {}, el('mark', { class: 'd-a', text: lines[li].text })))))));
      }
      out.push(el('p', { class: 'hint', text: 'Jen pro informaci: zdroje často refrén vypíšou jen jednou. Kdyby verš v hlavní verzi být neměl, smaž ho v Upravit píseň.' }));
    }
    return out;
  }

  function render() {
    compute();
    const y = scrollY;
    const others = otherVersions(song);
    chips.hidden = others.length < 2;
    chips.replaceChildren(...others.map(v => el('button', { type: 'button', class: 'chip' + (v === other ? ' on' : ''), text: v.label,
      onclick: () => { if (v !== other) nav.replace(`#/compare/${encodeURIComponent(song.id)}/${encodeURIComponent(v.id)}`); } })));
    info.replaceChildren(...[el('span', { text: `Hlavní ↔ ${other.label}` }),
      /^https?:\/\//i.test(other.sourceUrl) ? el('a', { href: other.sourceUrl, target: '_blank', rel: 'noopener', class: 'vsrc', text: 'zdroj ↗' }) : null].filter(Boolean));
    const c = summary(res.items);
    const fchip = (f, text) => el('button', { type: 'button', class: 'chip' + (st.filter === f ? ' on' : ''), text, onclick: () => { st.filter = f; render(); } });
    sum.replaceChildren(...[
      el('div', { text: c.total ? [`${c.total} ${c.total === 1 ? 'sporné místo' : c.total < 5 ? 'sporná místa' : 'sporných míst'}`,
        c.open && `${c.open} nerozhodnuto`, c.unsure && `${c.unsure} nejisté`, c.ok && `${c.ok} ověřeno`].filter(Boolean).join(' · ')
        : 'Ve slovech se verze shodují (velikost písmen, interpunkce a stříšky se nepočítají).' }),
      c.total && c.ok + c.unsure ? el('div', { class: 'tools' }, fchip('todo', 'K rozhodnutí'), fchip('all', 'Všechna')) : null].filter(Boolean));
    if (res.tooLong) { list.replaceChildren(el('p', { class: 'empty', text: 'Text je na porovnání příliš dlouhý.' })); return; }
    const shown = res.items.filter(s => st.filter === 'all' || s.st === 'open' || s.st === 'unsure');
    list.replaceChildren(
      ...(shown.length ? shown.map(spotCard) : c.total ? [el('p', { class: 'empty', text: 'Všechna sporná místa jsou ověřená. 🎉' })] : []),
      ...blocks());
    if (st.focus != null) { // ⚠ u verše v písni → ukázat jeho sporné místo
      const card = list.querySelector(`.spot[data-li="${st.focus}"]`);
      if (card) st.flash = { li: st.focus, until: Date.now() + 1600 };
      st.focus = null;
      if (card) { card.classList.add('flash'); setTimeout(() => card.scrollIntoView({ block: 'center' }), 30); return; }
    }
    if (st.flash && Date.now() < st.flash.until) list.querySelector(`.spot[data-li="${st.flash.li}"]`)?.classList.add('flash');
    scrollTo(0, y);
  }

  // ---------- načasování jednoho verše ťuknutím na začátku a na konci ----------
  function timeLine(v, idx, s) {
    stopLoop();
    let start = null, end = null;
    const lines = v.lines;
    const prevT = [...lines.slice(0, idx)].reverse().find(l => l.start != null)?.start;
    const status = el('div', { class: 'tap-next' });
    const pos = el('input', { type: 'range', class: 'progress', min: 0, max: Math.round(player.duration || 1000), step: 100, value: Math.round(player.time()), 'aria-label': 'Pozice',
      oninput: () => player.seek(+pos.value) });
    const tTime = el('span', { class: 'time' });
    const pBtn = el('button', { type: 'button', class: 'play small', 'aria-label': 'Přehrát', html: player.playing ? ICONS.pause : ICONS.play, onclick: () => player.toggle() });
    const startBtn = el('button', { type: 'button', class: 'btn primary', text: 'Teď začíná', onclick: () => { start = Math.round(player.time()); end = null; if (!player.playing) player.play(); paint(); } });
    const endBtn = el('button', { type: 'button', class: 'btn', text: 'Teď končí', onclick: () => { if (start == null) return; end = Math.round(player.time()); player.pause(); paint(); } });
    const saveBtn = el('button', { type: 'button', class: 'btn primary', text: 'Uložit a poslouchat' });
    tapPlayBtn = pBtn;
    tick = t => { tTime.textContent = formatMs(t); if (document.activeElement !== pos) pos.value = Math.round(t); };
    function paint() {
      status.replaceChildren(el('small', { text: start == null ? 'Pusť nahrávku a ťukni, až verš začne:' : end == null ? `Začátek ${formatMs(start)}. Ťukni, až verš skončí:` : `${formatMs(start)} – ${formatMs(end)}` }), lines[idx].text);
      endBtn.disabled = start == null;
      saveBtn.disabled = start == null || end == null || end <= start;
    }
    sheet(closeIt => {
      saveBtn.onclick = async () => {
        lines[idx].start = start;
        const next = lines[idx + 1];
        if (next && (next.start == null || next.start <= start)) next.start = end;
        await saveSong(song);
        closeIt(); cleanup();
        toast(`Verš ${idx + 1} načasován`);
        render();
        loopLine(v, idx, s.key);
      };
      return el('div', { class: 'form' },
        el('h3', { text: `Načasovat verš ${idx + 1}${v === other ? ` (${other.label})` : ''}` }),
        el('p', { class: 'hint', text: 'Ťukni na začátku a na konci verše. Čas se uloží i pro učení a karaoke.' }),
        status,
        pos,
        el('div', { class: 'row' }, pBtn, iconBtn('rewind', 'O 5 sekund zpět', () => player.seek(player.time() - 5000)), tTime),
        el('div', { class: 'row' }, startBtn, endBtn),
        el('div', { class: 'row end' }, el('button', { type: 'button', class: 'btn', text: 'Zrušit', onclick: () => { closeIt(); cleanup(); } }), saveBtn));
    });
    function cleanup() { tick = null; tapPlayBtn = null; player.pause(); }
    // zavření tažením / klepnutím mimo
    const back = document.querySelector('.sheet-backdrop:last-of-type');
    back?.addEventListener('click', e => { if (e.target === back) cleanup(); });
    paint();
    player.setLoop(null);
    player.setRate(1);
    player.seek(Math.max(0, (prevT ?? 0) - 1000));
    pos.max = Math.round(player.duration || 1000);
  }

  // ---------- nabídka verze ----------
  function openMenu() {
    sheet(close => el('div', {},
      el('h3', { text: other.label }),
      el('div', { class: 'sub', text: `${other.lines.length} veršů${other.sourceUrl ? ' · ' + other.sourceUrl : ''}` }),
      menu([
        { icon: '✎', label: 'Upravit tuto verzi', action: () => nav.go(`#/version/${encodeURIComponent(song.id)}/${encodeURIComponent(other.id)}`) },
        song.versions.length < MAX_VERSIONS && { icon: '＋', label: 'Přidat další verzi textu', action: () => nav.go(`#/version/${encodeURIComponent(song.id)}/new`) },
        { icon: '🗑', label: 'Smazat tuto verzi', danger: true, action: async () => {
          if (!confirm(`Smazat verzi „${other.label}“? Rozhodnutí sporných míst proti ní se zapomenou.`)) return;
          if (other.audio) await deleteAudioBlob(other.audio.key);
          song.versions = song.versions.filter(v => v !== other);
          prune(song);
          await saveSong(song);
          toast('Verze smazána');
          nav.back();
        } },
      ], close)));
  }

  updateRate();
  render();
  loadMedia(hasMedia(main()) ? 'main' : hasMedia(other) ? 'other' : 'main');
  document.documentElement.style.setProperty('--lyric-size', `${getPrefs().lyricSize}rem`);
  return () => player.destroy();
}
