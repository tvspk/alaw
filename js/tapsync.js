// Časování veršů ťukáním: pustíš nahrávku a na začátku každého verše ťukneš.
import { el, iconBtn, ICONS, toast, skipBtns } from './ui.js';
import { t, dec, num } from './i18n.js';
import { getSong, saveSong, getAudioBlob, getPrefs } from './store.js';
import { primaryVersion, formatMs } from './model.js';
import { Player } from './player.js';

export async function renderTapSync(root, id, nav) {
  const song = await getSong(id);
  if (!song) { root.append(el('div', { class: 'view' }, el('p', { class: 'empty', text: t('Píseň nenalezena.') }))); return; }
  const version = primaryVersion(song);
  const lines = version.lines;
  const starts = lines.map(l => l.start);
  let cursor = Math.max(0, starts.findIndex(s => s == null));
  if (starts.every(s => s != null)) cursor = 0;
  let dirty = false;

  const player = new Player();
  player.rate = 1;
  const media = el('div', { class: 'media' });
  const err = el('div', { class: 'media-error', hidden: true });
  const listEl = el('ol', { class: 'sync-list' });
  const nextEl = el('div', { class: 'tap-next' });
  const timeEl = el('span', { class: 'time', text: '00:00' });
  const playBtn = el('button', { type: 'button', class: 'play', 'aria-label': t('Přehrát'), html: ICONS.play, onclick: () => player.toggle() });
  const rateBtn = el('button', { type: 'button', class: 'pill', text: '1×', onclick: () => {
    player.setRate(player.rate === 1 ? 0.75 : player.rate === 0.75 ? 0.5 : 1);
    rateBtn.textContent = `${num(player.rate)}×`;
    rateBtn.classList.toggle('on', player.rate !== 1);
  } });

  const tapBtn = el('button', { type: 'button', class: 'tap-btn', text: t('ŤUK'), onpointerdown: e => { e.preventDefault(); tap(); } });

  function tap() {
    if (!player.ready) { toast(t('Nahrávka se ještě načítá.')); return; }
    if (cursor >= lines.length) { toast(t('Všechny verše mají čas. Ulož.')); return; }
    if (!player.playing) player.play();
    starts[cursor] = Math.round(player.time());
    cursor++;
    dirty = true;
    render(true);
    if (navigator.vibrate) navigator.vibrate(15);
  }

  function undo() {
    if (cursor === 0) return;
    cursor--;
    starts[cursor] = null;
    dirty = true;
    const prev = [...starts.slice(0, cursor)].reverse().find(s => s != null);
    if (player.ready) player.seek(Math.max(0, (prev ?? 0) - 1000));
    render(true);
  }

  function shift(ms) {
    for (let i = 0; i < starts.length; i++) if (starts[i] != null) starts[i] = Math.max(0, starts[i] + ms);
    dirty = true;
    render(false);
    toast(t('Všechny časy posunuty o {s} s', { s: (ms > 0 ? '+' : '') + dec(ms / 1000) }), 1200);
  }

  function render(scroll) {
    listEl.replaceChildren(...lines.map((l, i) => el('li', {
      class: (i === cursor ? 'cur ' : '') + (starts[i] != null ? 'done' : ''),
      onclick: () => {
        cursor = i;
        // začni přehrávat kousek před předchozím veršem, ať je slyšet nájezd
        const prev = [...starts.slice(0, i)].reverse().find(s => s != null);
        if (player.ready) player.seek(Math.max(0, (prev ?? starts[i] ?? 0) - 500));
        render(false);
      },
    }, el('span', { class: 't', text: starts[i] != null ? formatMs(starts[i]) : '—' }), el('span', { text: l.text }))));
    const next = lines[cursor];
    nextEl.replaceChildren(el('small', { text: cursor < lines.length ? t('Ťukni, až začne verš {n} z {m}:', { n: cursor + 1, m: lines.length }) : t('Hotovo, všechny verše mají čas.') }), next ? next.text : '');
    if (scroll) listEl.children[Math.min(cursor, lines.length - 1)]?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  async function save() {
    lines.forEach((l, i) => { l.start = starts[i]; });
    await saveSong(song);
    dirty = false;
    toast(t('Časy uloženy'));
    nav.back();
  }

  player.onState = p => { playBtn.innerHTML = p ? ICONS.pause : ICONS.play; };
  player.onTime = t => { timeEl.textContent = formatMs(t); };
  player.onError = m => { err.textContent = m; err.hidden = false; };

  const top = el('header', { class: 'topbar' },
    iconBtn('back', t('Zpět'), () => { if (!dirty || confirm(t('Odejít bez uložení časů?'))) nav.back(); }),
    el('h1', {}, el('span', { text: t('Časování veršů') }), el('small', { text: song.title })),
    el('button', { type: 'button', class: 'btn small primary', text: t('Uložit'), onclick: save }));

  const help = el('div', { class: 'section' },
    el('p', { text: t('Pusť nahrávku a ťukni na tlačítko vždy na začátku verše. Ťuknutím na verš v seznamu se vrátíš a přečasuješ ho. Pokud ťukáš trochu pozdě, posuň všechny časy.') }),
    el('div', { class: 'row' },
      el('button', { type: 'button', class: 'btn small', text: t('↶ Zpět o verš'), onclick: undo }),
      el('button', { type: 'button', class: 'btn small', text: `−${dec(0.1)} s`, onclick: () => shift(-100) }),
      el('button', { type: 'button', class: 'btn small', text: `+${dec(0.1)} s`, onclick: () => shift(100) }),
      el('button', { type: 'button', class: 'btn small danger', text: t('Smazat časy'), onclick: () => {
        if (!confirm(t('Smazat všechny časy?'))) return;
        starts.fill(null); cursor = 0; dirty = true; player.seek(0); render(true);
      } })));

  const zone = el('div', { class: 'tap-zone' }, el('div', { class: 'inner' },
    nextEl,
    el('div', { class: 'controls' }, ...skipBtns(() => player), playBtn, timeEl, el('span', { class: 'grow' }), rateBtn),
    tapBtn));

  root.append(el('div', { class: 'view', style: { paddingBottom: '260px' } }, top, media, err, help, listEl), zone);
  render(false);

  if (!lines.length) { zone.hidden = true; help.replaceChildren(el('p', { text: t('Píseň nemá text. Nejdřív ho doplň v Upravit.') })); }
  else if (version.audio && getPrefs().source[song.id] !== 'youtube') {
    const blob = await getAudioBlob(version.audio.key);
    if (blob) player.loadAudio(blob); else { err.textContent = t('Zvukový soubor v tomto zařízení není.'); err.hidden = false; }
  } else if (version.youtubeId) {
    const wrap = el('div', { class: 'yt-wrap' });
    media.append(wrap);
    player.loadYouTube(wrap, version.youtubeId);
  } else {
    zone.hidden = true;
    help.replaceChildren(el('p', {}, t('K časování potřebuješ nahrávku. Přidej v '), el('a', { href: `#/edit/${song.id}`, text: t('Upravit') }), t(' odkaz na YouTube nebo zvukový soubor.')));
  }

  const onKey = e => {
    if (e.target.closest('input, textarea')) return;
    if (e.code === 'Space' || e.code === 'Enter') { e.preventDefault(); tap(); }
    else if (e.code === 'Backspace') { e.preventDefault(); undo(); }
  };
  document.addEventListener('keydown', onKey);
  return () => { player.destroy(); document.removeEventListener('keydown', onKey); };
}
