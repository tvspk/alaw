// Přidání a úprava písně: název, interpret, jazyk, štítky, text (prostý nebo LRC), YouTube, zvukový soubor.
import { el, iconBtn, toast, pickFile, fileSize } from './ui.js';
import { getSong, saveSong, deleteSong, putAudioBlob, deleteAudioBlob } from './store.js';
import { LANGUAGES, newSong, primaryVersion, parseLyrics, extractYoutubeId, toLrc, toPlainText, isSynced, parseTags, fold, uid, songsFromJson } from './model.js';

const AUDIO_ACCEPT = 'audio/*,.mp3,.m4a,.aac,.ogg,.oga,.opus,.wav,.flac,.webm';

// Při úpravě textu zachová překlady, poznámky a časy u veršů, které se nezměnily.
function mergeLines(oldLines, newLines) {
  let from = 0;
  for (const nl of newLines) {
    const key = fold(nl.text);
    const idx = oldLines.findIndex((ol, j) => j >= from && fold(ol.text) === key);
    if (idx === -1) continue;
    const ol = oldLines[idx];
    from = idx + 1;
    nl.id = ol.id;
    nl.translation = ol.translation;
    nl.literal = ol.literal;
    nl.contractions = ol.contractions;
    nl.note = ol.note;
    if (nl.start == null) nl.start = ol.start;
  }
  return newLines;
}

export async function renderEdit(root, id, nav, draft) {
  const existing = id ? await getSong(id) : null;
  if (id && !existing) { root.append(el('div', { class: 'view' }, el('p', { class: 'empty', text: 'Píseň nenalezena.' }))); return; }
  const version = existing ? primaryVersion(existing) : null;
  let newAudio = null;          // File vybraný v tomto formuláři
  let removeAudio = false;

  const f = {
    title: el('input', { value: existing?.title || draft?.title || '', required: true, autocomplete: 'off', placeholder: 'Calon Lân' }),
    artist: el('input', { value: existing?.artist || draft?.artist || '', autocomplete: 'off', placeholder: 'Interpret (nepovinné)' }),
    language: el('select', {}, LANGUAGES.map(([code, label]) => el('option', { value: code, text: label }))),
    tags: el('input', { value: (existing?.tags || []).join(', '), autocomplete: 'off', placeholder: 'hymny, lidovky, rugby' }),
    text: el('textarea', { value: version ? (isSynced(version) ? toLrc(existing, version).split('\n').filter(l => !/^\[(ti|ar):/.test(l)).join('\n').trim() : toPlainText(version).trim()) : draft?.text || '',
      placeholder: 'Vlož text písně. Sloky odděl prázdným řádkem.\nFunguje i formát LRC s časy: [00:12.50]Text verše', spellcheck: false }),
    youtube: el('input', { value: version?.youtubeId ? `https://youtu.be/${version.youtubeId}` : '', inputmode: 'url', autocomplete: 'off', placeholder: 'https://youtu.be/…' }),
  };
  f.language.value = existing?.language || draft?.language || 'cy';

  const audioName = el('div', { class: 'name' });
  const audioRemove = el('button', { type: 'button', class: 'btn small danger', text: 'Odebrat', onclick: () => { newAudio = null; removeAudio = true; updateAudio(); } });
  function updateAudio() {
    const cur = newAudio ? { name: newAudio.name, size: newAudio.size } : !removeAudio && version?.audio ? version.audio : null;
    audioName.textContent = cur ? `${cur.name} (${fileSize(cur.size)})` : 'Žádný soubor';
    audioRemove.hidden = !cur;
  }

  const field = (label, node, hint) => el('label', { class: 'field' }, el('span', { text: label }), node, hint ? el('div', { class: 'hint', text: hint }) : null);

  const form = el('form', { class: 'form', onsubmit: e => { e.preventDefault(); save(); } },
    field('Název písně *', f.title),
    field('Interpret', f.artist),
    el('div', { class: 'row' }, el('div', { class: 'grow' }, field('Jazyk', f.language)), el('div', { class: 'grow' }, field('Štítky', f.tags))),
    el('div', { class: 'field' },
      el('span', { text: 'Text písně' }),
      f.text,
      el('div', { class: 'row' },
        el('div', { class: 'hint grow', text: 'Prostý text nebo LRC. Při úpravě zůstanou překlady a poznámky u veršů, které nezměníš.' }),
        el('button', { type: 'button', class: 'btn small', text: 'Načíst ze souboru', onclick: loadTextFile }))),
    field('Video na YouTube', f.youtube, 'Odkaz nebo 11znakové ID videa.'),
    el('div', { class: 'field' },
      el('span', { text: 'Vlastní nahrávka' }),
      el('div', { class: 'file-box' }, audioName, audioRemove,
        el('button', { type: 'button', class: 'btn small', text: 'Vybrat soubor', onclick: async () => {
          const file = await pickFile(AUDIO_ACCEPT);
          if (!file) return;
          if (!file.type.startsWith('audio/') && !/\.(mp3|m4a|aac|ogg|oga|opus|wav|flac|webm)$/i.test(file.name)) { toast('Tohle nevypadá jako zvukový soubor.'); return; }
          newAudio = file; removeAudio = false; updateAudio();
        } })),
      el('div', { class: 'hint', text: 'mp3, m4a, ogg, wav, flac… Uloží se jen v tomto telefonu.' })),
    el('div', { class: 'row end' },
      existing ? el('button', { type: 'button', class: 'btn danger', text: 'Smazat', onclick: remove }) : null,
      el('span', { class: 'grow' }),
      el('button', { type: 'button', class: 'btn', text: 'Zrušit', onclick: () => nav.back() }),
      el('button', { type: 'submit', class: 'btn primary', text: existing ? 'Uložit' : 'Přidat píseň' })));

  async function loadTextFile() {
    const file = await pickFile('.lrc,.txt,.json,text/plain,application/json');
    if (!file) return;
    const text = await file.text();
    if (/\.json$/i.test(file.name)) {
      try {
        const { songs } = songsFromJson(JSON.parse(text));
        const s = songs[0];
        if (!s) throw new Error();
        const v = primaryVersion(s);
        if (!f.title.value) f.title.value = s.title;
        if (!f.artist.value) f.artist.value = s.artist;
        f.text.value = isSynced(v) ? toLrc(s, v).split('\n').filter(l => !/^\[(ti|ar):/.test(l)).join('\n').trim() : toPlainText(v).trim();
        if (v.youtubeId && !f.youtube.value) f.youtube.value = `https://youtu.be/${v.youtubeId}`;
      } catch { toast('Tenhle JSON neumím přečíst.'); }
      return;
    }
    f.text.value = text.trim();
    const ti = text.match(/^\[ti:(.*)\]$/mi), ar = text.match(/^\[ar:(.*)\]$/mi);
    if (ti && !f.title.value) f.title.value = ti[1].trim();
    if (ar && !f.artist.value) f.artist.value = ar[1].trim();
  }

  async function save() {
    const title = f.title.value.trim();
    if (!title) { toast('Vyplň název písně.'); f.title.focus(); return; }
    const ytRaw = f.youtube.value.trim();
    const youtubeId = ytRaw ? extractYoutubeId(ytRaw) : null;
    if (ytRaw && !youtubeId) { toast('Odkaz na YouTube nepoznávám.'); f.youtube.focus(); return; }
    const lines = parseLyrics(f.text.value);

    const song = existing || newSong({ title, lines: [] });
    const v = primaryVersion(song);
    Object.assign(song, { title, artist: f.artist.value.trim(), language: f.language.value, tags: parseTags(f.tags.value) });
    v.lines = existing ? mergeLines(v.lines, lines) : lines;
    v.youtubeId = youtubeId;

    try {
      if ((newAudio || removeAudio) && v.audio) { await deleteAudioBlob(v.audio.key); v.audio = null; }
      if (newAudio) {
        const key = uid(16);
        await putAudioBlob(key, newAudio);
        v.audio = { key, name: newAudio.name, type: newAudio.type || '', size: newAudio.size };
      }
      await saveSong(song);
    } catch (e) {
      toast(e && e.name === 'QuotaExceededError' ? 'V telefonu došlo místo pro uložení.' : 'Uložení se nepovedlo.');
      return;
    }
    toast(existing ? 'Uloženo' : 'Píseň přidána');
    nav.replace(`#/song/${song.id}`);
  }

  async function remove() {
    if (!confirm(`Smazat „${existing.title}“ včetně zvukového souboru? Nejde to vrátit.`)) return;
    await deleteSong(existing);
    toast('Smazáno');
    nav.replace('#/');
  }

  updateAudio();
  root.append(el('div', { class: 'view' },
    el('header', { class: 'topbar' }, iconBtn('back', 'Zpět', () => nav.back()), el('h1', { text: existing ? 'Upravit píseň' : 'Nová píseň' })),
    form));
  if (!existing && !f.title.value) f.title.focus();
}
