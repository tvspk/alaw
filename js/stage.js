// Režim na celou obrazovku pro zpívání (0.17): jen předchozí, aktuální a další verš velkým písmem (+ překlad),
// obrazovka nezhasne (Wake Lock). Bez časů veršů se ukáže celý text velkým písmem k rolování.
// Otevírá obrazovka písně (song.js) a posílá sem čas a stav přehrávače; při náhodném přehrávání zůstane otevřený
// i po přechodu na další píseň (carry → takeCarry).
import { el, iconBtn, ICONS, skipBtns } from './ui.js';
import { t, lang as uiLang } from './i18n.js';
import { getPrefs, setPrefs } from './store.js';
import { trText, otherLang, formatMs } from './model.js';

let carry = false;
export function carryStage() { carry = true; }
export function takeCarry() { const c = carry; carry = false; return c; }

let lock = null;
async function wake(on) {
  try {
    if (on && !lock && navigator.wakeLock && document.visibilityState === 'visible') {
      lock = await navigator.wakeLock.request('screen');
      lock.addEventListener('release', () => { lock = null; });
    } else if (!on && lock) { await lock.release(); lock = null; }
  } catch { lock = null; }
}

// opts: { song, version, player: () => Player, toggle(), next|null, prev|null, onClose() }
export function openStage(opts) {
  const { song, version } = opts;
  const timed = version.lines.some(l => l.start != null);
  let size = getPrefs().stageSize || 1;
  const prevEl = el('div', { class: 'st-prev' }), curEl = el('div', { class: 'st-cur' }), trEl = el('div', { class: 'st-tr' }), nextEl = el('div', { class: 'st-next' });
  const main = el('div', { class: 'st-main' + (timed ? '' : ' st-all'), onclick: e => { if (timed && !e.target.closest('button')) opts.toggle(); } });
  if (timed) main.append(prevEl, curEl, trEl, nextEl);
  else main.append(el('div', { class: 'st-note', text: t('Píseň nemá časy veršů – text se neposouvá sám.') }),
    ...version.lines.map(l => el('div', { class: 'st-line' + (l.stanza ? ' stanza' : ''), text: l.text })));
  const skip = skipBtns(opts.player);
  const playBtn = el('button', { type: 'button', class: 'play', 'aria-label': t('Přehrát'), html: ICONS.play, onclick: () => opts.toggle() });
  // posuvník písně a čas
  const seek = el('input', { type: 'range', class: 'progress', min: 0, max: 1000, value: 0, step: 100, 'aria-label': t('Pozice'),
    oninput: () => opts.player().seek(+seek.value) });
  const timeEl = el('span', { class: 'st-time' });
  const setSize = d => { size = Math.max(0.7, Math.min(1.8, Math.round((size + d) * 10) / 10)); setPrefs({ stageSize: size }); box.style.setProperty('--st-size', size); };
  const box = el('div', { class: 'stage', role: 'dialog', 'aria-label': t('Zpívání na celou obrazovku') },
    el('div', { class: 'st-top' },
      el('div', { class: 'st-title' }, el('b', { text: song.title }), song.artist ? el('small', { text: song.artist }) : null),
      iconBtn('close', t('Zavřít'), () => close())),
    main,
    el('div', { class: 'st-seek' }, seek, timeEl),
    el('div', { class: 'st-foot' },
      el('button', { type: 'button', class: 'pill', text: 'A−', 'aria-label': t('Menší písmo'), onclick: () => setSize(-0.1) }),
      opts.prev ? iconBtn('prev', t('Předchozí píseň'), () => opts.prev()) : null,
      skip[0],
      playBtn,
      skip[1],
      opts.next ? iconBtn('next', t('Další píseň'), () => opts.next()) : null,
      el('button', { type: 'button', class: 'pill', text: 'A+', 'aria-label': t('Větší písmo'), onclick: () => setSize(0.1) })));
  box.style.setProperty('--st-size', size);
  box.__close = () => close();
  document.body.append(box);
  document.body.classList.add('stage-on');
  try { if (!document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {}); } catch { /* nejde */ }
  wake(true);
  const onVis = () => { if (document.visibilityState === 'visible') wake(true); };
  document.addEventListener('visibilitychange', onVis);

  let shown = -2;
  function update(ms) {
    const d = opts.player().duration;
    if (d) seek.max = Math.round(d);
    if (document.activeElement !== seek) seek.value = Math.round(ms);
    timeEl.textContent = `${formatMs(ms, false)} / ${formatMs(d, false)}`;
    if (!timed) return;
    let i = -1;
    version.lines.forEach((l, j) => { if (l.start != null && l.start <= ms + 80) i = j; });
    if (i === shown) return;
    shown = i;
    const L = version.lines, lg = getPrefs().trLang || uiLang;
    const cur = L[i];
    prevEl.textContent = i > 0 ? L[i - 1].text : '';
    curEl.textContent = cur ? cur.text : '♪';
    const tr = cur && getPrefs().showTr ? trText(cur, lg) || trText(cur, otherLang(lg)) : null;
    trEl.textContent = tr ? tr.text : '';
    nextEl.textContent = L[i + 1] ? L[i + 1].text : '';
    curEl.classList.remove('in'); void curEl.offsetWidth; curEl.classList.add('in');
  }
  function state(playing) {
    playBtn.innerHTML = playing ? ICONS.pause : ICONS.play;
    playBtn.setAttribute('aria-label', playing ? t('Pozastavit') : t('Přehrát'));
  }
  let closed = false;
  function close(keep = false) {
    if (closed) return;
    closed = true;
    box.remove();
    document.body.classList.remove('stage-on');
    document.removeEventListener('visibilitychange', onVis);
    if (!keep) {
      wake(false);
      try { if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); } catch { /* nic */ }
    }
    opts.onClose?.();
  }
  const p = opts.player();
  update(p.time()); state(p.playing);
  return { update, state, close };
}
