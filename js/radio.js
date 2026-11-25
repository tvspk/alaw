// Společný přehrávač celé aplikace (0.16): náhodné přehrávání písní s vlastní nahrávkou.
// Hraje dál při procházení aplikace; dole je malý přehrávač (název → text písně, ⏮ ⏯ ⏭ ✕).
// Obrazovka písně, která právě hraje, se k němu připojí (attach) místo vlastního přehrávače:
// karaoke, skok na verš i smyčka pak běží nad touto nahrávkou. Jiný přehrávač v aplikaci ho pozastaví (Player.playing).
// Jen písně s vlastní nahrávkou (YouTube potřebuje viditelné video). Pořadí se zamíchá, po poslední písni znovu.
import { el, iconBtn, ICONS, toast } from './ui.js';
import { t } from './i18n.js';
import { getSong, getAudioBlob } from './store.js';
import { primaryVersion } from './model.js';
import { Player } from './player.js';

export const player = new Player();
let queue = [], pos = -1;
let cur = null;        // { song, version } – právě nahraná píseň
let hook = null;       // obsluha připojené obrazovky písně { onTime, onState, onReady, onError }
let wantPlay = false;  // po načtení rovnou hrát
let seq = 0;           // novější přepnutí ruší starší (rychlé ťukání na ⏭)
let fails = 0;         // nehratelné nahrávky za sebou
const subs = new Set();
let bar = null, ui = null;

// Verze s vlastní nahrávkou: hlavní, jinak první, která nahrávku má.
export function audioVersion(song) {
  const p = primaryVersion(song);
  return p.audio ? p : song.versions.find(v => v.audio) || null;
}
export const hasRecording = song => !!audioVersion(song);

export const current = () => cur;
export const active = () => !!cur;
export const queueInfo = () => ({ pos, total: queue.length });

function shuffle(a) {
  a = [...a];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// Spustí náhodné přehrávání ze zadaných písní (bere jen ty s vlastní nahrávkou). Vrací počet písní ve frontě.
export async function playShuffled(songs) {
  const ids = songs.filter(hasRecording).map(s => s.id);
  if (!ids.length) { toast(t('Žádná z písní nemá vlastní nahrávku.')); return 0; }
  queue = shuffle(ids); pos = -1; fails = 0;
  await step(1, true);
  return ids.length;
}

export function next() { if (queue.length) step(1, true); }
export function prev() {
  if (!cur) return;
  if (player.time() > 3000 || pos <= 0) { player.seek(0); player.play(); return; }
  step(-1, true);
}
export function toggle() { if (cur) player.toggle(); }

export function stop() {
  seq++;
  player.destroy();
  queue = []; pos = -1; cur = null; hook = null;
  notify(); draw(); session();
}

async function step(dir, play) {
  const my = ++seq;
  for (let tries = 0; tries < queue.length; tries++) {
    let p = pos + dir;
    if (p >= queue.length) { // konec fronty → zamíchat znovu (ať tatáž píseň nehraje dvakrát po sobě)
      const last = queue[queue.length - 1];
      queue = shuffle(queue);
      if (queue.length > 1 && queue[0] === last) [queue[0], queue[1]] = [queue[1], queue[0]];
      p = 0;
    }
    if (p < 0) return;
    pos = p;
    const song = await getSong(queue[pos]);
    const v = song && audioVersion(song);
    const blob = v && await getAudioBlob(v.audio.key);
    if (my !== seq) return;
    if (!blob) continue; // nahrávka v tomto zařízení není (třeba se ještě stahuje) → další
    cur = { song, version: v };
    wantPlay = play;
    player.rate = 1;
    player.setLoop(null);
    player.loadAudio(blob);
    notify(); draw(); session();
    return;
  }
  if (my !== seq) return;
  toast(t('Nahrávky těchto písní v tomto zařízení nejsou.'), 3500);
  stop();
}

// ---------- obsluha přehrávače ----------
player.onReady = () => {
  fails = 0;
  hook?.onReady?.();
  if (wantPlay) { wantPlay = false; player.play(); }
  draw();
};
player.onState = playing => { hook?.onState?.(playing); drawState(); session(); };
player.onTime = ms => { hook?.onTime?.(ms); drawTime(ms); };
player.onError = msg => {
  hook?.onError?.(msg);
  if (!player.ready && ++fails < Math.min(queue.length, 5)) step(1, true); // nehratelný soubor → další píseň
  else if (!hook) toast(msg, 3500);
};
player.onEnded = () => {
  if (player.loop) { player.playFrom(player.loop.start); return; } // smyčka verše z obrazovky písně
  next();
};

// ---------- připojení obrazovky písně ----------
export function matches(songId, versionId) { return !!cur && cur.song.id === songId && cur.version.id === versionId; }

export function attach(songId, versionId, handlers) {
  if (!matches(songId, versionId)) return false;
  hook = handlers;
  draw();
  return true;
}

export function detach(handlers) {
  if (hook !== handlers) return;
  hook = null;
  player.setLoop(null);
  draw();
}

// Změna písně nebo konec přehrávání → fn(cur)
export function subscribe(fn) { subs.add(fn); return () => subs.delete(fn); }
function notify() { for (const fn of [...subs]) { try { fn(cur); } catch (e) { console.error(e); } } }

// ---------- malý přehrávač dole ----------
function build() {
  const title = el('a', { class: 'mini-title', href: '#/' });
  const play = el('button', { type: 'button', class: 'mini-play', 'aria-label': t('Přehrát'), html: ICONS.play, onclick: toggle });
  const fillEl = el('i');
  ui = { title, play, fillEl };
  bar = el('div', { class: 'minibar', hidden: true, role: 'region', 'aria-label': t('Náhodné přehrávání') },
    el('div', { class: 'mini-prog' }, fillEl),
    el('div', { class: 'inner' },
      title,
      iconBtn('prev', t('Předchozí píseň'), prev),
      play,
      iconBtn('next', t('Další píseň'), next),
      iconBtn('close', t('Ukončit náhodné přehrávání'), stop)));
  document.body.append(bar);
}

function draw() {
  if (!bar) build();
  const show = !!cur && !hook;
  bar.hidden = !show;
  document.body.classList.toggle('mini-on', show);
  if (!cur) return;
  const s = cur.song;
  ui.title.setAttribute('href', `#/song/${encodeURIComponent(s.id)}`);
  ui.title.title = t('Otevřít text písně');
  ui.title.replaceChildren(el('b', { text: s.title }),
    el('small', { text: [s.artist, `🔀 ${pos + 1}/${queue.length}`].filter(Boolean).join(' · ') }));
  drawState();
  drawTime(player.time());
}

function drawState() {
  if (!ui) return;
  ui.play.innerHTML = player.playing ? ICONS.pause : ICONS.play;
  ui.play.setAttribute('aria-label', player.playing ? t('Pozastavit') : t('Přehrát'));
}

function drawTime(ms) {
  if (!ui || bar.hidden) return;
  const d = player.duration;
  ui.fillEl.style.width = d ? `${Math.min(100, (100 * ms) / d).toFixed(2)}%` : '0';
}

// Ovládání ze systému (klávesy pro hudbu, panel médií v prohlížeči / na zamčené obrazovce)
function session() {
  const ms = navigator.mediaSession;
  if (!ms) return;
  try {
    if (!cur) {
      ms.metadata = null;
      for (const a of ['play', 'pause', 'nexttrack', 'previoustrack']) ms.setActionHandler(a, null);
      ms.playbackState = 'none';
      return;
    }
    if (typeof MediaMetadata === 'function' && ms.metadata?.title !== cur.song.title) {
      ms.metadata = new MediaMetadata({ title: cur.song.title, artist: cur.song.artist || '', album: 'Alaw' });
    }
    ms.setActionHandler('play', () => player.play());
    ms.setActionHandler('pause', () => player.pause());
    ms.setActionHandler('nexttrack', next);
    ms.setActionHandler('previoustrack', prev);
    ms.playbackState = player.playing ? 'playing' : 'paused';
  } catch { /* starší prohlížeč */ }
}

// testovací háček
window.__alawRadio = { player, current, queueInfo, next, prev, stop };
