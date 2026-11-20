// Obrazovka písně: text, režimy učení, přehrávač, smyčka, úprava veršů.
import { el, fill, iconBtn, ICONS, sheet, menu, toast, download, safeName } from './ui.js';
import { t, pl, vlabel, num, lang as uiLang } from './i18n.js';
import { getSong, saveSong, deleteSong, getAudioBlob, getPrefs, setPrefs, getProgress, resetProgress } from './store.js';
import { songUnits, songSummary, unitState, lineKey, STATE_LABEL, fmtIvl } from './learn.js';
import { DRILLS } from './drill.js';
import { primaryVersion, formatMs, toLrc, toTxt, langLabel, isSynced, trOf, setTr, trText, trLangs, otherLang } from './model.js';
import { Player, RATES } from './player.js';
import { hasAi, translateVersion, explainLine } from './ai.js';
import { MAX_VERSIONS, analyze, summary } from './versions.js';
import { applyLyrics, runTranscribe, transcribable } from './bulk.js';
import { openSearch } from './search.js';

const WORD_RE = /^([^\p{L}\p{N}]*)(.*?)([^\p{L}\p{N}]*)$/u;

function hash01(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0) / 4294967296;
}

function parseTime(text) {
  const s = String(text || '').trim();
  if (!s) return null;
  const m = s.match(/^(\d{1,3}):(\d{1,2})(?:[.,](\d{1,3}))?$/) || s.match(/^()(\d+)(?:[.,](\d{1,3}))?$/);
  if (!m) return undefined;
  const f = m[3] ? +m[3].padEnd(3, '0').slice(0, 3) : 0;
  return ((+m[1] || 0) * 60 + +m[2]) * 1000 + f;
}

export async function renderSong(root, id, nav) {
  let song = await getSong(id);
  if (!song) { root.append(el('div', { class: 'view' }, el('p', { class: 'empty', text: t('Píseň nenalezena.') }))); return; }
  const prefs = getPrefs();
  let version = primaryVersion(song);
  const player = new Player();
  player.rate = prefs.rate;
  const units = songUnits(song);
  let recs = await getProgress(song.id);

  const st = {
    mode: prefs.mode, pct: prefs.clozePct, seed: 1, revealed: new Set(), revealAll: false,
    loop: null, active: -1, lastUserScroll: 0, source: null,
  };

  // ---------- horní lišta ----------
  const titleEl = el('h1', {}, el('span', { text: song.title }), el('small', { text: [song.artist, langLabel(song.language)].filter(Boolean).join(' · ') }));
  const top = el('header', { class: 'topbar' },
    iconBtn('back', t('Zpět'), () => nav.back()),
    titleEl,
    iconBtn('more', t('Další možnosti'), openSongMenu));

  // ---------- média ----------
  const media = el('div', { class: 'media' });
  const mediaError = el('div', { class: 'media-error', hidden: true });

  // ---------- režimy učení ----------
  const segBtns = {};
  const seg = el('div', { class: 'seg', role: 'tablist' },
    [['read', t('Číst')], ['cloze', t('Mizení')], ['initials', t('Písmena')], ['map', t('Mapa')]].map(([m, label]) =>
      (segBtns[m] = el('button', { type: 'button', role: 'tab', text: label, onclick: () => setMode(m) }))));
  const pctLabel = el('span');
  const pctInput = el('input', { type: 'range', min: 10, max: 100, step: 10, value: st.pct, 'aria-label': t('Kolik slov skrýt'),
    oninput: () => { st.pct = +pctInput.value; setPrefs({ clozePct: st.pct }); st.revealed.clear(); updatePct(); renderLyrics(); } });
  const range = el('label', { class: 'range' }, pctLabel, pctInput);
  const shuffleBtn = el('button', { type: 'button', class: 'chip', text: t('🔀 Jiná slova'), onclick: () => { st.seed++; st.revealed.clear(); renderLyrics(); } });
  const revealBtn = el('button', { type: 'button', class: 'chip', onclick: () => { st.revealAll = !st.revealAll; st.revealed.clear(); renderLyrics(); updateTools(); } });
  const togTr = toggleChip(t('Překlad'), 'showTr');
  const togAlt = toggleChip(t('Ze zdroje'), 'showAlt');
  const togLit = toggleChip(t('Doslovně'), 'showLit');
  const togContr = toggleChip(t('Zkratky'), 'showContr');
  const tools = el('div', { class: 'tools' });
  const study = el('div', { class: 'study' }, seg, tools);

  // Jazyk zobrazeného překladu (CZ/EN): volba v prefs.trLang, jinak jazyk rozhraní; když píseň ten překlad nemá, druhý.
  function dispLang() {
    const av = trLangs(version), want = getPrefs().trLang || uiLang;
    return av.includes(want) ? want : av[0] || uiLang;
  }
  function trSwitch() {
    const dl = dispLang();
    return el('div', { class: 'tr-switch', role: 'group', 'aria-label': t('Jazyk překladu') }, ['cs', 'en'].map(lg =>
      el('button', { type: 'button', class: dl === lg ? 'on' : '', text: lg === 'cs' ? 'CZ' : 'EN', 'aria-pressed': String(dl === lg),
        onclick: () => { setPrefs({ trLang: lg }); updateTools(); renderLyrics(); } })));
  }

  function toggleChip(label, key) {
    const b = el('button', { type: 'button', class: 'chip', text: label, onclick: () => { setPrefs({ [key]: !getPrefs()[key] }); updateTools(); renderLyrics(); } });
    b.dataset.key = key;
    return b;
  }

  function updatePct() { pctLabel.textContent = t('Skrýt {p} %', { p: st.pct }); }

  function updateTools() {
    for (const [m, b] of Object.entries(segBtns)) { b.classList.toggle('on', st.mode === m); b.setAttribute('aria-selected', st.mode === m); }
    const p = getPrefs();
    const dl = dispLang();
    const has = k => version.lines.some(l => (k === 'translation' ? trText(l, dl) : k === 'alt' ? dl === 'cs' && l.alt
      : k === 'contractions' ? trOf(l, dl).contractions.length : trOf(l, dl)[k]));
    const chips = [];
    if (st.mode === 'cloze') chips.push(range, shuffleBtn);
    if (st.mode === 'cloze' || st.mode === 'initials') { revealBtn.textContent = st.revealAll ? t('🙈 Skrýt') : t('👁 Odkrýt vše'); chips.push(revealBtn); }
    if (has('translation')) chips.push(togTr);
    if (p.showTr && trLangs(version).length > 1) chips.push(trSwitch());
    if (has('alt')) chips.push(togAlt);
    if (has('literal')) chips.push(togLit);
    if (has('contractions')) chips.push(togContr);
    for (const c of [togTr, togAlt, togLit, togContr]) c.classList.toggle('on', !!p[c.dataset.key]);
    tools.replaceChildren(...chips);
    tools.hidden = !chips.length;
    updatePct();
  }

  function setMode(m) {
    st.mode = m; st.revealed.clear(); st.revealAll = false;
    setPrefs({ mode: m });
    updateTools(); renderLyrics();
  }

  // ---------- učení: souhrn a mapa písně ----------
  const learnInfo = el('div', { class: 'grow' });
  const learnBox = el('div', { class: 'learn-box' }, learnInfo,
    el('button', { type: 'button', class: 'btn small', text: t('🎯 Procvičit'), onclick: openDrills }),
    el('button', { type: 'button', class: 'btn small primary', text: t('🎓 Učit se'), onclick: () => nav.go(`#/learn/${encodeURIComponent(song.id)}`) }));
  function openDrills() {
    sheet(close => el('div', {},
      el('h3', { text: t('Procvičit celou píseň') }),
      el('div', { class: 'sub', text: t('Mimo lekci, kdykoli. Pokrok mění jen zkouška (co nevíš, vrátí se do opakování).') }),
      el('div', { class: 'menu' }, DRILLS.map(([m, icon, label, desc]) => el('button', { type: 'button', onclick: () => { close(); nav.go(`#/drill/${encodeURIComponent(song.id)}/${m}`); } },
        el('span', { class: 'ic', text: icon }), el('span', {}, el('div', { text: label }), el('small', { class: 'menu-desc', text: desc })))))));
  }
  function updateLearnBox() {
    const c = songSummary(units, recs);
    learnBox.hidden = !units.length;
    const parts = [];
    if (c.new === c.total) parts.push(pl(c.total, '{n} verš k naučení', '{n} verše k naučení', '{n} veršů k naučení'));
    else {
      parts.push(t('Umíš {n} z {m}', { n: c.known + c.due, m: c.total }));
      if (c.due) parts.push(t('{n} k opakování', { n: c.due }));
      if (c.learn) parts.push(t('{n} se učíš', { n: c.learn }));
      if (c.new) parts.push(t('{n} nových', { n: c.new }));
    }
    learnInfo.textContent = parts.join(' · ');
  }
  function mapState(line, now) {
    const rec = recs.get(lineKey(line.text));
    const state = unitState(rec, now);
    let txt = STATE_LABEL[state];
    if (state === 'known') {
      const days = Math.max(1, Math.round((rec.due - now) / 86400e3));
      txt += ' · ' + t('opakování za {d}', { d: fmtIvl(days) });
    }
    if (rec && rec.lapses && state !== 'new') txt += ' · ' + t('zapomenuto {n}×', { n: rec.lapses });
    return el('div', { class: 'mstate', text: txt });
  }
  async function reloadProgress() { recs = await getProgress(song.id); renderLyrics(); }

  // ---------- verze textu: sporná místa ----------
  const vbar = el('button', { type: 'button', class: 'vbar', hidden: true, onclick: () => nav.go(`#/compare/${encodeURIComponent(song.id)}`) });
  let flags = new Map(); // verš → { st: 'open'|'unsure', vid }
  function updateVersions() {
    flags = new Map();
    if (song.versions.length < 2) { vbar.hidden = true; return; }
    const res = analyze(song);
    for (const r of res) for (const sp of r.items) {
      if (sp.st === 'ok') continue;
      for (const li of sp.kind === 'mixed' ? sp.lines : [sp.li]) {
        if (!flags.has(li) || (flags.get(li).st === 'unsure' && sp.st === 'open')) flags.set(li, { st: sp.st, vid: r.version.id });
      }
    }
    const c = summary(res.flatMap(r => r.items));
    const names = res.map(r => vlabel(r.version.label)).join(', ');
    vbar.hidden = false;
    vbar.classList.toggle('todo', c.open > 0);
    vbar.textContent = c.open ? '⚖ ' + pl(c.open, '{n} sporné místo proti verzi {v} – rozhodnout', '{n} sporná místa proti verzi {v} – rozhodnout', '{n} sporných míst proti verzi {v} – rozhodnout', { v: names })
      : c.total ? '⚖ ' + t('Verze {v}: rozhodnuto', { v: names }) + (c.unsure ? ', ' + pl(c.unsure, '{n} místo nejisté', '{n} místa nejistá', '{n} míst nejistých') : '')
        : '⚖ ' + t('Verze {v} se ve slovech shoduje', { v: names });
  }

  // ---------- text ----------
  const list = el('ol', { class: 'lyrics' });
  let lineEls = [];

  function wordNodes(line) {
    const out = [];
    let wi = 0;
    for (const part of line.text.split(/(\s+)/)) {
      if (!part) continue;
      if (/^\s+$/.test(part)) { out.push(part); continue; }
      const [, lead, core, trail] = part.match(WORD_RE);
      if (!core) { out.push(part); continue; }
      const key = `${line.id}:${wi}`;
      const hide = !st.revealAll && (st.mode === 'initials' || (st.mode === 'cloze' && hash01(`${st.seed}|${line.id}|${wi}`) * 100 < st.pct));
      wi++;
      if (lead) out.push(lead);
      if (!hide) out.push(core);
      else if (st.revealed.has(key)) out.push(el('span', { class: 'w peek', text: core }));
      else {
        const w = el('span', { class: 'w hide', dataset: { k: key }, role: 'button', 'aria-label': t('Skryté slovo, ťukni pro odkrytí') });
        if (st.mode === 'initials') w.append(el('span', { class: 'first', text: core[0] }), core.slice(1));
        else w.append(core);
        out.push(w);
      }
      if (trail) out.push(trail);
    }
    return out;
  }

  function renderLyrics() {
    const p = getPrefs(), dl = dispLang();
    const learning = (st.mode === 'cloze' || st.mode === 'initials') && !st.revealAll;
    const map = st.mode === 'map', now = Date.now();
    updateLearnBox();
    updateVersions();
    const loopRange = loopIdx();
    lineEls = version.lines.map((line, i) => {
      const timed = line.start != null;
      const body = el('div', { class: 'body' },
        timed && st.mode === 'read' ? el('div', { class: 'time', text: formatMs(line.start, false) }) : null,
        el('div', { class: 'text' }, wordNodes(line)),
        ...(learning ? [] : (() => {
          const tr = p.showTr ? trText(line, dl) : null, x = trOf(line, dl);
          return [
            tr ? el('div', { class: tr.src ? 'alt' : 'tr', text: tr.text, title: tr.src ? t('Překlad ze zdroje') : null }) : null,
            p.showAlt && dl === 'cs' && line.alt ? el('div', { class: 'alt', text: line.alt }) : null,
            p.showLit && x.literal ? el('div', { class: 'lit', text: x.literal }) : null,
            p.showContr && x.contractions.length
              ? el('div', { class: 'contr' }, x.contractions.map(c => el('span', { text: `${c.short} → ${c.full}`, title: c.note }))) : null];
        })()),
        line.note && st.mode === 'read' ? el('div', { class: 'note', text: line.note }) : null,
        map ? mapState(line, now) : null);
      const ms = map ? unitState(recs.get(lineKey(line.text)), now) : null;
      const fl = flags.get(i);
      const li = el('li', { class: 'lyric' + (line.stanza ? ' stanza' : '') + (timed ? ' timed' : '') + (map ? ` mapped m-${ms}` : ''), dataset: { i } },
        body,
        fl ? el('button', { type: 'button', class: `vflag v-${fl.st}`, text: '⚠', title: fl.st === 'open' ? t('Sporné místo – jiná verze má jiné znění') : t('Nejisté místo'),
          'aria-label': t('Sporné místo, porovnat verze'), onclick: () => nav.go(`#/compare/${encodeURIComponent(song.id)}/${encodeURIComponent(fl.vid)}/${i}`) }) : null,
        el('button', { type: 'button', class: 'icon-btn more', 'aria-label': t('Možnosti verše'), html: ICONS.more, onclick: () => openLineMenu(i) }));
      if (i === st.active) li.classList.add('active');
      if (loopRange && i >= loopRange[0] && i <= loopRange[1]) li.classList.add('in-loop');
      return li;
    });
    list.replaceChildren(...lineEls);
    if (!version.lines.length) list.append(el('div', { class: 'empty' },
      el('p', { text: t('Píseň zatím nemá text.') }),
      el('div', { class: 'row', style: { justifyContent: 'center' } },
        el('button', { type: 'button', class: 'btn primary', text: t('🔍 Najít text'), onclick: () => openSearch({ title: song.title, artist: song.artist, language: song.language }, async d => {
          try { await applyLyrics(song.id, d); toast(t('Text uložen')); nav.replace(`#/song/${encodeURIComponent(song.id)}`); } catch (e) { toast(e.message); }
        }, { songId: song.id }) }),
        transcribable(song) ? el('button', { type: 'button', class: 'btn', text: t('🎧 Přepsat z nahrávky'), onclick: () => runTranscribe(song.id, nav) }) : null,
        el('button', { type: 'button', class: 'btn', text: t('Vložit ručně'), onclick: () => nav.go(`#/edit/${encodeURIComponent(song.id)}`) }))));
  }

  list.addEventListener('click', e => {
    const w = e.target.closest('.w.hide');
    if (w) { st.revealed.add(w.dataset.k); renderLyrics(); return; }
    if (e.target.closest('.more, .vflag')) return;
    if (st.mode === 'map') {
      const li = e.target.closest('.lyric');
      const k = li && lineKey(version.lines[+li.dataset.i].text);
      if (k) nav.go(`#/learn/${encodeURIComponent(song.id)}/${encodeURIComponent(k)}`);
      return;
    }
    const li = e.target.closest('.lyric');
    if (!li || !e.target.closest('.text')) return;
    const i = +li.dataset.i;
    const line = version.lines[i];
    if (line.start == null || !player.ready) return;
    const lr = loopIdx();
    if (lr && (i < lr[0] || i > lr[1])) clearLoop();
    player.playFrom(Math.max(0, line.start - 150));
  });

  // ---------- přehrávač ----------
  const playBtn = el('button', { type: 'button', class: 'play', 'aria-label': t('Přehrát'), html: ICONS.play, onclick: () => player.toggle() });
  const timeEl = el('span', { class: 'time', text: '00:00 / --:--' });
  const progress = el('input', { type: 'range', class: 'progress', min: 0, max: 1000, value: 0, step: 100, 'aria-label': t('Pozice'),
    oninput: () => player.seek(+progress.value) });
  const rateBtn = el('button', { type: 'button', class: 'pill', onclick: () => {
    const next = RATES[(RATES.indexOf(player.rate) + 1) % RATES.length] ?? 1;
    player.setRate(next); setPrefs({ rate: next }); updateRate();
  } });
  const loopBtn = el('button', { type: 'button', class: 'pill loop', hidden: true, onclick: clearLoop });
  const srcBtn = el('button', { type: 'button', class: 'pill', hidden: true, onclick: () => switchSource(st.source === 'audio' ? 'youtube' : 'audio') });
  const bar = el('div', { class: 'playerbar', hidden: true }, el('div', { class: 'inner' },
    progress,
    el('div', { class: 'controls' },
      iconBtn('rewind', t('O 5 sekund zpět'), () => player.seek(player.time() - 5000)),
      playBtn, timeEl, el('span', { class: 'grow' }), loopBtn, srcBtn, rateBtn)));

  function updateRate() { rateBtn.textContent = `${num(player.rate)}×`; rateBtn.classList.toggle('on', player.rate !== 1); }

  player.onState = playing => { playBtn.innerHTML = playing ? ICONS.pause : ICONS.play; playBtn.setAttribute('aria-label', playing ? t('Pozastavit') : t('Přehrát')); };
  player.onReady = () => { progress.max = Math.round(player.duration || 1000); mediaError.hidden = true; onTime(player.time()); };
  player.onError = msg => {
    mediaError.textContent = msg; mediaError.hidden = false;
    if (player.kind === 'youtube' && !player.ready) media.replaceChildren(); // prázdný černý rámeček nezobrazovat
  };
  player.onTime = onTime;

  function onTime(t) {
    if (player.duration) progress.max = Math.round(player.duration);
    if (document.activeElement !== progress) progress.value = Math.round(t);
    timeEl.textContent = `${formatMs(t, false)} / ${formatMs(player.duration, false)}`;
    // aktivní verš = poslední časovaný verš, který už začal
    let active = -1;
    version.lines.forEach((l, i) => { if (l.start != null && l.start <= t + 80) active = i; });
    if (active !== st.active) {
      lineEls[st.active]?.classList.remove('active');
      st.active = active;
      const li = lineEls[active];
      if (li) {
        li.classList.add('active');
        if (getPrefs().autoScroll && player.playing && Date.now() - st.lastUserScroll > 3500) li.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
    }
  }
  const markScroll = () => { st.lastUserScroll = Date.now(); };
  window.addEventListener('touchmove', markScroll, { passive: true });
  window.addEventListener('wheel', markScroll, { passive: true });

  async function switchSource(kind) {
    st.source = kind;
    setPrefs({ source: { ...getPrefs().source, [song.id]: kind } });
    mediaError.hidden = true;
    const hasAudio = !!version.audio, hasYt = !!version.youtubeId;
    srcBtn.hidden = !(hasAudio && hasYt);
    srcBtn.textContent = kind === 'audio' ? '♪ Soubor' : '▶ YouTube';
    bar.hidden = false;
    if (kind === 'audio') {
      const blob = await getAudioBlob(version.audio.key);
      if (!blob) {
        player.destroy();
        media.replaceChildren(el('div', { class: 'media-note', text: t('Zvukový soubor „{f}“ v tomto zařízení není. Nahraj ho znovu v Upravit.', { f: version.audio.name }) }));
        return;
      }
      media.replaceChildren();
      player.loadAudio(blob);
    } else {
      const wrap = el('div', { class: 'yt-wrap' });
      media.replaceChildren(wrap);
      await player.loadYouTube(wrap, version.youtubeId);
    }
    player.setRate(player.rate);
    applyLoop(false);
  }

  function setupMedia() {
    const hasAudio = !!version.audio, hasYt = !!version.youtubeId;
    if (!hasAudio && !hasYt) {
      player.destroy(); bar.hidden = true;
      media.replaceChildren(el('div', { class: 'media-note' }, t('Bez nahrávky. V '),
        el('a', { href: `#/edit/${song.id}`, text: t('Upravit') }), t(' můžeš přidat odkaz na YouTube nebo vlastní zvukový soubor.')));
      return;
    }
    const saved = getPrefs().source[song.id];
    switchSource(saved === 'youtube' && hasYt ? 'youtube' : saved === 'audio' && hasAudio ? 'audio' : hasAudio ? 'audio' : 'youtube');
  }

  // ---------- smyčka ----------
  function loopIdx() { return st.loop ? [Math.min(st.loop.a, st.loop.b), Math.max(st.loop.a, st.loop.b)] : null; }

  function applyLoop(start = true) {
    const r = loopIdx();
    if (!r) { player.setLoop(null); loopBtn.hidden = true; return; }
    const a = version.lines[r[0]].start;
    const next = version.lines.slice(r[1] + 1).find(l => l.start != null);
    player.setLoop(a, next ? next.start : null);
    loopBtn.hidden = false;
    loopBtn.textContent = r[0] === r[1] ? '🔁 ' + t('verš {n}', { n: r[0] + 1 }) + '  ✕' : `🔁 ${r[0] + 1}–${r[1] + 1}  ✕`;
    if (start && player.ready) player.playFrom(Math.max(0, a - 150));
  }

  function setLoop(a, b) {
    if (version.lines[Math.min(a, b)].start == null) { toast(t('Verš ještě nemá čas. Nejdřív píseň načasuj.')); return; }
    st.loop = { a, b };
    applyLoop(); renderLyrics();
  }

  function clearLoop() { st.loop = null; applyLoop(false); renderLyrics(); }

  // ---------- nabídky ----------
  function openLineMenu(i) {
    const line = version.lines[i];
    const timed = line.start != null && player.kind;
    const r = loopIdx();
    sheet(close => el('div', {},
      el('h3', { text: line.text }),
      trText(line, dispLang()) ? el('div', { class: 'sub', text: trText(line, dispLang()).text }) : null,
      menu([
        timed && { icon: '🔁', label: t('Opakovat tento verš'), action: () => setLoop(i, i) },
        timed && { icon: '⤒', label: r ? t('Smyčka začne tady') : t('Smyčka od tohoto verše…'), action: () => setLoop(i, r ? Math.max(r[1], i) : i) },
        timed && r && { icon: '⤓', label: t('Smyčka skončí tady'), action: () => setLoop(Math.min(r[0], i), i) },
        (st.mode === 'cloze' || st.mode === 'initials') && { icon: '👁', label: t('Odkrýt verš'), action: () => { revealLine(line); } },
        lineKey(line.text) && { icon: '🎓', label: t('Procvičit tento verš'), action: () => nav.go(`#/learn/${encodeURIComponent(song.id)}/${encodeURIComponent(lineKey(line.text))}`) },
        unitState(recs.get(lineKey(line.text))) !== 'new' && { icon: '↺', label: t('Vynulovat pokrok verše'), action: async () => {
          await resetProgress(song.id, [lineKey(line.text)]); await reloadProgress(); toast(t('Pokrok verše vynulován'));
        } },
        { icon: '✎', label: t('Upravit verš, překlad, poznámku'), action: () => editLine(i) },
        { icon: '🤖', label: t('Vysvětlit verš slovo po slovu (AI)'), action: () => explain(i) },
      ], close)));
  }

  function revealLine(line) {
    const n = line.text.split(/\s+/).length;
    for (let w = 0; w < n + 1; w++) st.revealed.add(`${line.id}:${w}`);
    renderLyrics();
  }

  function editLine(i) {
    const line = version.lines[i];
    const f = {
      text: el('textarea', { class: 'short', value: line.text }),
      alt: el('textarea', { class: 'short', value: line.alt }),
      note: el('textarea', { class: 'short', value: line.note, placeholder: t('Pomůcka, poznámka k výslovnosti…') }),
      start: el('input', { value: line.start != null ? formatMs(line.start) : '', inputmode: 'decimal', placeholder: 'mm:ss.cc' }),
    };
    // překlad, doslovný překlad a zkratky v obou jazycích, jazyk rozhraní první
    const langs = [uiLang, otherLang(uiLang)];
    const lname = lg => (lg === 'cs' ? t('čeština') : t('angličtina'));
    const tf = Object.fromEntries(langs.map(lg => { const x = trOf(line, lg); return [lg, {
      translation: el('textarea', { class: 'short', value: x.translation }),
      literal: el('textarea', { class: 'short', value: x.literal }),
      contractions: el('textarea', { class: 'short', value: x.contractions.map(c => `${c.short} = ${c.full}${c.note ? ' — ' + c.note : ''}`).join('\n'), placeholder: t('dwi = rydw i — hovorově') }),
    }]; }));
    const parseContr = v => v.split('\n').map(s => s.trim()).filter(Boolean).map(s => {
      const [pair, ...noteParts] = s.split(/\s+[—–-]\s+/);
      const [short, full = ''] = pair.split('=').map(x => x.trim());
      return { short, full, note: noteParts.join(' – ').trim() };
    }).filter(c => c.short);
    const field = (label, node, hint) => el('label', { class: 'field' }, el('span', { text: label }), node, hint ? el('div', { class: 'hint', text: hint }) : null);
    sheet(close => el('div', { class: 'form' },
      el('h3', { text: t('Verš {n}', { n: i + 1 }) }),
      field(t('Text'), f.text),
      langs.map(lg => field(t('Překlad – {l}', { l: lname(lg) }), tf[lg].translation)),
      langs.map(lg => field(t('Doslovně – {l}', { l: lname(lg) }), tf[lg].literal)),
      field(t('Překlad ze zdroje'), f.alt),
      langs.map((lg, j) => field(t('Zkratky a hovorové tvary – {l}', { l: lname(lg) }), tf[lg].contractions, j ? null : t('Jeden na řádek: krátký tvar = plný tvar — poznámka'))),
      field(t('Poznámka'), f.note),
      field(t('Začátek verše'), f.start, t('Např. 01:23.45. Prázdné = bez času.')),
      el('div', { class: 'row end' },
        el('button', { type: 'button', class: 'btn', text: t('Zrušit'), onclick: close }),
        el('button', { type: 'button', class: 'btn primary', text: t('Uložit'), onclick: async () => {
          const start = parseTime(f.start.value);
          if (start === undefined) { toast(t('Čas zapiš jako mm:ss.cc, např. 01:23.45')); return; }
          if (!f.text.value.trim()) { toast(t('Text verše nesmí být prázdný.')); return; }
          Object.assign(line, {
            text: f.text.value.replace(/\s+/g, ' ').trim(),
            alt: f.alt.value.trim(),
            note: f.note.value.trim(),
            start,
          });
          for (const lg of langs) setTr(line, lg, { translation: tf[lg].translation.value.trim(), literal: tf[lg].literal.value.trim(), contractions: parseContr(tf[lg].contractions.value) });
          await saveSong(song);
          close(); updateTools(); renderLyrics(); applyLoop(false);
          toast(t('Uloženo'));
        } }))));
  }

  function needAi() {
    if (hasAi()) return false;
    if (confirm(t('Pro překlady je potřeba klíč ke Gemini. Otevřít Nastavení?'))) nav.go('#/settings');
    return true;
  }

  // lg = jazyk překladu (výchozí jazyk rozhraní); překlad v druhém jazyce zůstane
  async function translate(overwrite, lg = uiLang) {
    if (needAi()) return;
    if (overwrite && !confirm(lg === 'cs' ? t('Přepsat český překlad (i doslovný a zkratky) novým z AI? Anglický zůstane.') : t('Přepsat anglický překlad (i doslovný a zkratky) novým z AI? Český zůstane.'))) return;
    const status = el('div', { class: 'ai-status', text: t('Posílám verše Gemini…') });
    const closeSheet = sheet(() => el('div', {}, el('h3', { text: t('Překlad pomocí AI') }), status));
    let progress = '';
    try {
      const n = await translateVersion(song, version, { overwrite, lang: lg,
        onProgress: (d, total) => { progress = total ? t('Přeloženo {d} z {n} veršů', { d, n: total }) : ''; status.textContent = progress || t('Všechny verše už překlad mají.'); },
        onWait: msg => { status.textContent = [progress, msg].filter(Boolean).join(' · '); } });
      await saveSong(song);
      closeSheet();
      setPrefs({ showTr: true, trLang: lg });
      updateTools(); renderLyrics();
      toast(n ? pl(n, 'Přeložen {n} verš', 'Přeloženy {n} verše', 'Přeloženo {n} veršů') : t('Všechny verše už překlad mají.'));
    } catch (e) {
      // co se stihlo přeložit, zůstane uložené; příště se doplní jen zbytek
      await saveSong(song); updateTools(); renderLyrics();
      status.textContent = (progress ? `${progress}. ` : '') + e.message + (progress ? ' ' + t('Zbytek doplníš příště volbou „Doplnit překlad pomocí AI“.') : '');
      status.classList.add('media-error');
    }
  }

  async function explain(i) {
    if (needAi()) return;
    const line = version.lines[i];
    const body = el('div', { class: 'ai-status', text: t('Ptám se Gemini…') });
    sheet(close => el('div', {}, el('h3', { text: line.text }), body,
      el('div', { class: 'row end', style: { marginTop: '10px' } }, el('button', { type: 'button', class: 'btn', text: t('Zavřít'), onclick: close }))));
    try {
      const r = await explainLine(song, version, line);
      const table = el('table', { class: 'gloss' }, (r.words || []).map(w => el('tr', {},
        el('td', { class: 'g-word', text: w.word }),
        el('td', {}, el('div', { text: w.meaning }), w.base && w.base !== w.word ? el('div', { class: 'g-base', text: `← ${w.base}` }) : null,
          w.grammar ? el('div', { class: 'g-gram', text: w.grammar }) : null))));
      const save = el('button', { type: 'button', class: 'btn small', text: t('Uložit do poznámky verše'), onclick: async () => {
        const txt = [(r.words || []).map(w => `${w.word}${w.base && w.base !== w.word ? ` (${w.base})` : ''} = ${w.meaning}${w.grammar ? ` – ${w.grammar}` : ''}`).join('\n'), r.note].filter(Boolean).join('\n');
        line.note = [line.note, txt].filter(Boolean).join('\n\n');
        await saveSong(song); renderLyrics(); toast(t('Uloženo do poznámky')); save.disabled = true;
      } });
      fill(body, table, r.note ? el('p', { class: 'g-note', text: r.note }) : null, save);
    } catch (e) { body.textContent = e.message; body.classList.add('media-error'); }
  }

  const hasTrIn = lg => version.lines.some(l => trOf(l, lg).translation);
  // Nastavení → „Nabízet i překlad do druhého jazyka“: doplnit, nebo (když už je celý) přeložit znovu
  function otherTrItem() {
    const o = otherLang(uiLang);
    const full = version.lines.some(l => l.text.trim()) && version.lines.every(l => !l.text.trim() || trOf(l, o).translation);
    const label = o === 'en' ? (full ? t('Přeložit znovu do angličtiny (AI)') : t('Přeložit i do angličtiny (AI)'))
      : (full ? t('Přeložit znovu do češtiny (AI)') : t('Přeložit i do češtiny (AI)'));
    return { icon: '🤖', label, action: () => translate(full, o) };
  }

  // Stažení textu: s časy (.lrc), bez časů, překlad, text s překladem pod každým veršem (.txt)
  function openExport() {
    const base = safeName(song.artist + '-' + song.title);
    const lname = lg => (lg === 'cs' ? t('čeština') : t('angličtina'));
    const txt = (name, content) => () => download(name, content, 'text/plain');
    const av = trLangs(version);
    sheet(close => el('div', {},
      el('h3', { text: t('Stáhnout text') }),
      el('div', { class: 'sub', text: av.length ? t('Textové soubory otevřeš v telefonu i v počítači.') : t('Píseň zatím nemá překlad – přeložíš ho v nabídce písně.') }),
      menu([
        { icon: '📄', label: t('Text bez časů (.txt)'), action: txt(`${base}.txt`, toTxt(song, version, 'text')) },
        isSynced(version) && { icon: '⏱', label: t('Text s časy (.lrc)'), action: txt(`${base}.lrc`, toLrc(song, version)) },
        ...av.flatMap(lg => [
          { icon: '🌐', label: t('Překlad – {l} (.txt)', { l: lname(lg) }), action: txt(`${base}-${lg}.txt`, toTxt(song, version, 'tr', lg)) },
          { icon: '📖', label: t('Text a pod veršem překlad – {l} (.txt)', { l: lname(lg) }), action: txt(`${base}-${song.language || 'text'}-${lg}.txt`, toTxt(song, version, 'both', lg)) },
        ]),
      ], close)));
  }

  function openSongMenu() {
    sheet(close => el('div', {},
      el('h3', { text: song.title }),
      el('div', { class: 'sub', text: pl(version.lines.length, '{n} verš', '{n} verše', '{n} veršů') }),
      menu([
        { icon: '✎', label: t('Upravit píseň'), action: () => nav.go(`#/edit/${song.id}`) },
        { icon: '⏱', label: t('Časovat verše ťukáním'), action: () => nav.go(`#/sync/${song.id}`) },
        song.versions.length > 1 && { icon: '⚖', label: t('Porovnat verze textu'), action: () => nav.go(`#/compare/${encodeURIComponent(song.id)}`) },
        song.versions.length < MAX_VERSIONS && { icon: '＋', label: t('Přidat verzi textu z jiného zdroje…'), action: () => nav.go(`#/version/${encodeURIComponent(song.id)}/new`) },
        transcribable(song) && (!version.lines.length || song.versions.length < MAX_VERSIONS) && { icon: '🎧', label: version.lines.length ? t('Přepsat z nahrávky jako další verzi (AI)') : t('Přepsat text z nahrávky (AI)'), action: () => runTranscribe(song.id, nav) },
        { icon: '🎓', label: t('Učit se'), action: () => nav.go(`#/learn/${encodeURIComponent(song.id)}`) },
        { icon: '🎯', label: t('Procvičit celou píseň…'), action: openDrills },
        [...recs.values()].some(r => r.st !== 'new') && { icon: '↺', label: t('Vynulovat pokrok celé písně'), action: async () => {
          if (!confirm(t('Vynulovat pokrok učení u všech veršů této písně?'))) return;
          const n = await resetProgress(song.id, units.map(u => u.k)); await reloadProgress(); toast(pl(n, 'Vynulován {n} verš', 'Vynulovány {n} verše', 'Vynulováno {n} veršů'));
        } },
        { icon: '🤖', label: hasTrIn(uiLang) ? t('Doplnit překlad pomocí AI') : t('Přeložit pomocí AI'), action: () => translate(false) },
        hasTrIn(uiLang) && { icon: '🤖', label: t('Přeložit celou píseň znovu (AI)'), action: () => translate(true) },
        getPrefs().trBoth && otherTrItem(),
        { icon: '⇩', label: t('Stáhnout text…'), action: openExport },
        { icon: '⇩', label: t('Stáhnout píseň (.json)'), action: () => download(`${safeName(song.artist + '-' + song.title)}.json`, JSON.stringify(song, null, 2)) },
        { icon: '🗑', label: t('Smazat píseň'), danger: true, action: async () => {
          if (!confirm(t('Smazat „{t}“ včetně zvukového souboru? Nejde to vrátit.', { t: song.title }))) return;
          await deleteSong(song); toast(t('Smazáno')); nav.home();
        } },
      ], close)));
  }

  // ---------- sestavení ----------
  const view = el('div', { class: 'view' }, top, media, mediaError, learnBox, vbar, study, list);
  root.append(view, bar);
  updateRate(); updateTools(); renderLyrics(); setupMedia();
  const onScroll = () => top.classList.toggle('scrolled', scrollY > 4);
  window.addEventListener('scroll', onScroll, { passive: true });
  const onKey = e => {
    if (e.target.closest('input, textarea, select') || document.querySelector('.sheet')) return;
    if (e.code === 'Space') { e.preventDefault(); player.toggle(); }
  };
  document.addEventListener('keydown', onKey);
  document.documentElement.style.setProperty('--lyric-size', `${getPrefs().lyricSize}rem`);

  return () => {
    player.destroy();
    window.removeEventListener('scroll', onScroll);
    window.removeEventListener('touchmove', markScroll);
    window.removeEventListener('wheel', markScroll);
    document.removeEventListener('keydown', onKey);
  };
}
