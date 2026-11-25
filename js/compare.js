// Porovnání verzí textu: sporná místa hlavní verze proti jiné verzi, poslech verše ve smyčce (0,75×), rozhodnutí
// ✓ platí hlavní / ✓ platí druhá (přepíše hlavní verzi, pokrok verše zůstane) / ⚠ nejisté. Logika v versions.js.
// Adresa #/compare/<id písně>[/<id verze>[/<verš hlavní verze>]].
import { el, iconBtn, ICONS, sheet, menu, toast, skipBtns } from './ui.js';
import { t, pl, vlabel, num } from './i18n.js';
import { getSong, saveSong, moveProgress, deleteAudioBlob, getPrefs } from './store.js';
import { primaryVersion, formatMs } from './model.js';
import { Player } from './player.js';
import { attachMedia, lineRange } from './lesson.js';
import { MAX_VERSIONS, STATE, analyze, summary, decide, addOtherLines, prune, splitWords, otherVersions, makePrimary } from './versions.js';

const RATES = [0.75, 0.5, 1];

export async function renderCompare(root, id, versionId, focusLi, nav) {
  const song = await getSong(id);
  if (!song) { root.append(el('div', { class: 'view' }, el('p', { class: 'empty', text: t('Píseň nenalezena.') }))); return; }
  const main = () => primaryVersion(song);
  let other = otherVersions(song).find(v => v.id === versionId) || otherVersions(song)[0];
  const st = { filter: 'todo', source: null, rate: 0.75, looping: null, focus: focusLi };
  const player = new Player();
  player.rate = st.rate;
  let tick = null;
  let tapPlayBtn = null; // tlačítko přehrávání v okně časování verše

  const top = el('header', { class: 'topbar' },
    iconBtn('back', t('Zpět'), () => nav.back()),
    el('h1', {}, el('span', { text: t('Porovnat verze') }), el('small', { text: song.title })),
    other ? iconBtn('more', t('Možnosti verze'), openMenu) : null);
  const view = el('div', { class: 'view compare' }, top);
  root.append(view);

  if (!other) {
    view.append(el('div', { class: 'section' },
      el('p', { text: t('Píseň má zatím jen hlavní verzi textu. Přidej text z jiného zdroje (jiná webová stránka, zpěvník, přepis z videa) a aplikace ukáže, kde se liší.') }),
      el('div', { class: 'row' }, el('button', { type: 'button', class: 'btn primary', text: t('＋ Přidat verzi textu'), onclick: () => nav.replace(`#/version/${encodeURIComponent(song.id)}/new`) }))));
    return () => player.destroy();
  }

  // ---------- přepínač verzí, nahrávka ----------
  const chips = el('div', { class: 'tools vchips' });
  const info = el('div', { class: 'vinfo' });
  const media = el('div', { class: 'lesson-media' });
  const playBtn = el('button', { type: 'button', class: 'play small', 'aria-label': t('Přehrát'), html: ICONS.play, onclick: () => player.toggle() });
  const timeEl = el('span', { class: 'time', text: '' });
  const rateBtn = el('button', { type: 'button', class: 'pill on', onclick: () => {
    st.rate = RATES[(RATES.indexOf(st.rate) + 1) % RATES.length];
    player.setRate(st.rate); updateRate();
  } });
  const srcBtn = el('button', { type: 'button', class: 'pill', hidden: true, onclick: () => loadMedia(st.source === 'other' ? 'main' : 'other') });
  const ctrl = el('div', { class: 'row drill-ctrl', hidden: true }, playBtn, ...skipBtns(() => player), timeEl,
    el('span', { class: 'grow' }), srcBtn, rateBtn);
  const mediaNote = el('p', { class: 'hint', hidden: true });
  const sum = el('div', { class: 'vsum' });
  const list = el('div', { class: 'spots' });
  view.append(chips, info, media, ctrl, mediaNote, sum, list);

  const updateRate = () => { rateBtn.textContent = `${num(st.rate)}×`; rateBtn.classList.toggle('on', st.rate !== 1); };
  const hasMedia = v => !!(v.audio || v.youtubeId);
  player.onState = p => { for (const b of [playBtn, tapPlayBtn]) if (b) b.innerHTML = p ? ICONS.pause : ICONS.play; };
  player.onTime = t => { timeEl.textContent = formatMs(t, false); if (tick) tick(t); };
  player.onError = msg => { mediaNote.textContent = msg; mediaNote.hidden = false; };

  // zdroj nahrávky: 'main' (hlavní verze) | 'other' (vlastní nahrávka porovnávané verze)
  async function loadMedia(src) {
    const v = src === 'other' ? other : main();
    st.source = src; st.looping = null;
    srcBtn.hidden = !(hasMedia(main()) && hasMedia(other));
    srcBtn.textContent = src === 'other' ? `♪ ${vlabel(other.label)}` : '♪ ' + t('Hlavní');
    media.replaceChildren();
    mediaNote.hidden = true;
    ctrl.hidden = true;
    player.destroy();
    const ok = await attachMedia(player, v, media, () => { ctrl.hidden = false; player.setRate(st.rate); render(); });
    if (!ok) {
      ctrl.hidden = true;
      mediaNote.hidden = false;
      mediaNote.textContent = v.audio ? t('Nahrávka „{f}“ v tomto zařízení není.', { f: v.audio.name }) : t('Bez nahrávky. Rozdíly můžeš rozhodnout i tak, poslechem jinde.');
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
    out.push(repl.length ? el('mark', { class: cls, text: repl.join(' ') }) : el('mark', { class: `${cls} gap`, text: '‸', title: t('tady slova chybí') }));
    if (after.length) out.push(' ' + after.join(' '));
    return out;
  }

  function spotCard(s) {
    const lines = main().lines;
    const head = el('div', { class: 'spot-head' },
      el('span', { text: s.kind === 'mixed' ? t('Verše {n}', { n: s.lines.map(i => i + 1).join(', ') }) : t('Verš {n}', { n: s.li + 1 }) }),
      el('span', { class: `spot-st st-${s.st}`, text: (s.st === 'ok' ? '✓ ' : '⚠ ') + STATE[s.st] }));
    let rowMain, rowOther;
    if (s.kind === 'word') {
      const words = splitWords(lines[s.li].text);
      rowMain = el('div', { class: 'spot-line' }, el('span', { class: 'vlabel', text: t('Hlavní') }), el('span', { class: 'vtext' }, marked(words, s.w, s.n, null, 'd-a')));
      rowOther = el('div', { class: 'spot-line' }, el('span', { class: 'vlabel', text: vlabel(other.label) }), el('span', { class: 'vtext' }, marked(words, s.w, s.n, s.b, 'd-b')));
    } else {
      rowMain = el('div', { class: 'spot-line' }, el('span', { class: 'vlabel', text: t('Hlavní') }), el('span', { class: 'vtext' }, el('mark', { class: 'd-a', text: s.a })));
      rowOther = el('div', { class: 'spot-line' }, el('span', { class: 'vlabel', text: vlabel(other.label) }), el('span', { class: 'vtext' }, el('mark', { class: 'd-b', text: s.b })));
    }
    const card = el('div', { class: `spot st-${s.st}`, dataset: { li: s.li, key: s.key } }, head, rowMain, rowOther, listenRow(s));
    const choice = (text, ch, on) => el('button', { type: 'button', class: 'btn small' + (on ? ' on' : ''), text, onclick: () => choose(s, on ? 'open' : ch) });
    card.append(el('div', { class: 'row decide' },
      choice(t('✓ Platí hlavní'), 'main', s.st === 'ok'),
      s.kind === 'word' ? choice(t('✓ Platí {v}', { v: vlabel(other.label) }), 'other', false) : null,
      choice(t('⚠ Nejisté'), 'unsure', s.st === 'unsure')));
    if (s.kind === 'mixed') card.append(el('p', { class: 'hint', text: t('Přepsané verše uprav případně ručně v Upravit píseň.') }));
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
      return el('div', { class: 'row' }, el('button', { type: 'button', class: 'btn small', text: t('⏱ Načasovat verš'), onclick: () => timeLine(v, idx, s) }),
        el('span', { class: 'hint', text: t('Verš nemá čas, smyčka ho potřebuje.') }));
    }
    const on = st.looping === s.key;
    return el('div', { class: 'row' },
      el('button', { type: 'button', class: 'btn small' + (on ? ' primary' : ''), text: on ? t('⏹ Zastavit') : t('🔁 Poslouchat verš ({r}×)', { r: num(st.rate) }),
        onclick: () => (on ? stopLoop() : loopLine(v, idx, s.key)) }),
      el('button', { type: 'button', class: 'btn small ghost', text: '⏱', title: t('Přečasovat verš'), 'aria-label': t('Přečasovat verš'), onclick: () => timeLine(v, idx, s) }));
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
    if (change && await moveProgress(song.id, change.from, change.to)) toast(t('Verš opraven, pokrok zůstal'));
    else if (ch === 'other') toast(t('Hlavní verze opravena'));
    if (st.looping === s.key) stopLoop();
    render();
  }

  function blocks() {
    const out = [];
    const lines = main().lines;
    if (res.onlyOther.length) {
      out.push(el('h2', { class: 'spots-h', text: t('Verše navíc ve verzi {v}', { v: vlabel(other.label) }) }));
      for (const b of res.onlyOther) {
        out.push(el('div', { class: 'spot block' },
          el('div', { class: 'spot-head' }, el('span', { text: b.after < 0 ? t('Na začátku') : t('Za veršem {n}', { n: b.after + 1 }) }),
            b.repeat ? el('span', { class: 'spot-st', text: t('opakovaný verš') }) : null),
          el('div', { class: 'spot-line' }, el('span', { class: 'vtext' }, b.oLines.map(li => el('div', {}, el('mark', { class: 'd-b', text: other.lines[li].text }))))),
          el('div', { class: 'row decide' }, el('button', { type: 'button', class: 'btn small', text: t('＋ Přidat do hlavní verze'), onclick: async () => {
            const n = addOtherLines(song, other, b);
            prune(song);
            await saveSong(song);
            toast(pl(n, 'Verš přidán do hlavní verze', '{n} verše přidány do hlavní verze', '{n} veršů přidáno do hlavní verze'));
            render();
          } }))));
      }
    }
    if (res.onlyMain.length) {
      out.push(el('h2', { class: 'spots-h', text: t('Verše, které verze {v} nemá', { v: vlabel(other.label) }) }));
      for (const b of res.onlyMain) {
        out.push(el('div', { class: 'spot block' },
          el('div', { class: 'spot-head' }, el('span', { text: t('Verš {n}', { n: b.lines.map(i => i + 1).join(', ') }) }),
            b.repeat ? el('span', { class: 'spot-st', text: t('opakovaný refrén') }) : null),
          el('div', { class: 'spot-line' }, el('span', { class: 'vtext' }, b.lines.map(li => el('div', {}, el('mark', { class: 'd-a', text: lines[li].text })))))));
      }
      out.push(el('p', { class: 'hint', text: t('Jen pro informaci: zdroje často refrén vypíšou jen jednou. Kdyby verš v hlavní verzi být neměl, smaž ho v Upravit píseň.') }));
    }
    return out;
  }

  function render() {
    compute();
    const y = scrollY;
    const others = otherVersions(song);
    chips.hidden = others.length < 2;
    chips.replaceChildren(...others.map(v => el('button', { type: 'button', class: 'chip' + (v === other ? ' on' : ''), text: vlabel(v.label),
      onclick: () => { if (v !== other) nav.replace(`#/compare/${encodeURIComponent(song.id)}/${encodeURIComponent(v.id)}`); } })));
    info.replaceChildren(...[el('span', { text: `${t('Hlavní')} ↔ ${vlabel(other.label)}` }),
      /^https?:\/\//i.test(other.sourceUrl) ? el('a', { href: other.sourceUrl, target: '_blank', rel: 'noopener', class: 'vsrc', text: t('zdroj ↗') }) : null].filter(Boolean));
    const c = summary(res.items);
    const fchip = (f, text) => el('button', { type: 'button', class: 'chip' + (st.filter === f ? ' on' : ''), text, onclick: () => { st.filter = f; render(); } });
    sum.replaceChildren(...[
      el('div', { text: c.total ? [pl(c.total, '{n} sporné místo', '{n} sporná místa', '{n} sporných míst'),
        c.open && t('{n} nerozhodnuto', { n: c.open }), c.unsure && t('{n} nejisté', { n: c.unsure }), c.ok && t('{n} ověřeno', { n: c.ok })].filter(Boolean).join(' · ')
        : t('Ve slovech se verze shodují (velikost písmen, interpunkce a stříšky se nepočítají).') }),
      c.total && c.ok + c.unsure ? el('div', { class: 'tools' }, fchip('todo', t('K rozhodnutí')), fchip('all', t('Všechna'))) : null].filter(Boolean));
    if (res.tooLong) { list.replaceChildren(el('p', { class: 'empty', text: t('Text je na porovnání příliš dlouhý.') })); return; }
    const shown = res.items.filter(s => st.filter === 'all' || s.st === 'open' || s.st === 'unsure');
    list.replaceChildren(
      ...(shown.length ? shown.map(spotCard) : c.total ? [el('p', { class: 'empty', text: t('Všechna sporná místa jsou ověřená. 🎉') })] : []),
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
    const pos = el('input', { type: 'range', class: 'progress', min: 0, max: Math.round(player.duration || 1000), step: 100, value: Math.round(player.time()), 'aria-label': t('Pozice'),
      oninput: () => player.seek(+pos.value) });
    const tTime = el('span', { class: 'time' });
    const pBtn = el('button', { type: 'button', class: 'play small', 'aria-label': t('Přehrát'), html: player.playing ? ICONS.pause : ICONS.play, onclick: () => player.toggle() });
    const startBtn = el('button', { type: 'button', class: 'btn primary', text: t('Teď začíná'), onclick: () => { start = Math.round(player.time()); end = null; if (!player.playing) player.play(); paint(); } });
    const endBtn = el('button', { type: 'button', class: 'btn', text: t('Teď končí'), onclick: () => { if (start == null) return; end = Math.round(player.time()); player.pause(); paint(); } });
    const saveBtn = el('button', { type: 'button', class: 'btn primary', text: t('Uložit a poslouchat') });
    tapPlayBtn = pBtn;
    tick = t => { tTime.textContent = formatMs(t); if (document.activeElement !== pos) pos.value = Math.round(t); };
    function paint() {
      status.replaceChildren(el('small', { text: start == null ? t('Pusť nahrávku a ťukni, až verš začne:') : end == null ? t('Začátek {s}. Ťukni, až verš skončí:', { s: formatMs(start) }) : `${formatMs(start)} – ${formatMs(end)}` }), lines[idx].text);
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
        toast(t('Verš {n} načasován', { n: idx + 1 }));
        render();
        loopLine(v, idx, s.key);
      };
      return el('div', { class: 'form' },
        el('h3', { text: t('Načasovat verš {n}', { n: idx + 1 }) + (v === other ? ` (${vlabel(other.label)})` : '') }),
        el('p', { class: 'hint', text: t('Ťukni na začátku a na konci verše. Čas se uloží i pro učení a karaoke.') }),
        status,
        pos,
        el('div', { class: 'row' }, pBtn, ...skipBtns(() => player), tTime),
        el('div', { class: 'row' }, startBtn, endBtn),
        el('div', { class: 'row end' }, el('button', { type: 'button', class: 'btn', text: t('Zrušit'), onclick: () => { closeIt(); cleanup(); } }), saveBtn));
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

  // ---------- výměna hlavní verze ----------
  async function swapMain() {
    const decided = main().lines.some(l => l.vars && l.vars.length);
    if (!confirm(t('Udělat z „{v}“ hlavní verzi? Učit se budeš její text, pokrok veršů se převede na nové znění.', { v: vlabel(other.label) }) + (decided ? ' ' + t('Rozhodnutí sporných míst se vynulují.') : ''))) return;
    const fresh = await getSong(song.id);
    const pairs = makePrimary(fresh, other.id);
    await saveSong(fresh);
    let moved = 0;
    for (const [a, b] of pairs) if (await moveProgress(fresh.id, a, b)) moved++;
    toast(t('Hlavní verze: {v}', { v: vlabel(other.label) }) + (moved ? ' ' + pl(moved, '(pokrok převeden u {n} verše)', '(pokrok převeden u {n} veršů)', '(pokrok převeden u {n} veršů)') : ''), 3500);
    nav.replace(`#/song/${encodeURIComponent(fresh.id)}`);
  }

  // ---------- nabídka verze ----------
  function openMenu() {
    sheet(close => el('div', {},
      el('h3', { text: vlabel(other.label) }),
      el('div', { class: 'sub', text: pl(other.lines.length, '{n} verš', '{n} verše', '{n} veršů') + (other.sourceUrl ? ' · ' + other.sourceUrl : '') }),
      menu([
        { icon: '✎', label: t('Upravit tuto verzi'), action: () => nav.go(`#/version/${encodeURIComponent(song.id)}/${encodeURIComponent(other.id)}`) },
        { icon: '⭐', label: t('Udělat hlavní verzí'), action: () => swapMain() },
        song.versions.length < MAX_VERSIONS && { icon: '＋', label: t('Přidat další verzi textu'), action: () => nav.go(`#/version/${encodeURIComponent(song.id)}/new`) },
        { icon: '🗑', label: t('Smazat tuto verzi'), danger: true, action: async () => {
          if (!confirm(t('Smazat verzi „{v}“? Rozhodnutí sporných míst proti ní se zapomenou.', { v: vlabel(other.label) }))) return;
          if (other.audio) await deleteAudioBlob(other.audio.key);
          song.versions = song.versions.filter(v => v !== other);
          prune(song);
          await saveSong(song);
          toast(t('Verze smazána'));
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
