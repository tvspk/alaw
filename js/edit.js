// Přidání a úprava písně: název, interpret, jazyk, štítky, text (prostý nebo LRC), YouTube, zvukový soubor.
// S versionId upravuje (nebo s 'new' přidává) další verzi textu písně: název verze, text, YouTube, nahrávka (#/version/…).
import { el, iconBtn, toast, pickFile, fileSize } from './ui.js';
import { getSong, saveSong, deleteSong, putAudioBlob, deleteAudioBlob } from './store.js';
import { LANGUAGES, newSong, newVersion, primaryVersion, parseLyrics, extractYoutubeId, toLrc, toPlainText, isSynced, parseTags, fold, uid, songsFromJson, formatMs, attachAlt } from './model.js';
import { openSearch, askUrl, importFromUrl } from './search.js';
import { MAX_VERSIONS, prune } from './versions.js';
import { SOURCES } from './sources.js';

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
    if (!nl.alt) nl.alt = ol.alt;
    nl.literal = ol.literal;
    nl.contractions = ol.contractions;
    nl.note = ol.note;
    if (ol.vars) nl.vars = ol.vars; // rozhodnutí sporných míst (versions.js); nesedí-li už, uklidí se
    if (nl.start == null) nl.start = ol.start;
  }
  return newLines;
}

export async function renderEdit(root, id, nav, draft, versionId = null) {
  const existing = id ? await getSong(id) : null;
  const vmode = versionId != null; // úprava / přidání další verze textu
  const notFound = msg => root.append(el('div', { class: 'view' }, el('p', { class: 'empty', text: msg })));
  if (id && !existing) { notFound('Píseň nenalezena.'); return; }
  const version = !existing ? null : !vmode ? primaryVersion(existing) : existing.versions.find(v => v.id === versionId) || null;
  if (vmode && versionId !== 'new' && (!version || version === primaryVersion(existing))) { notFound('Verze nenalezena.'); return; }
  if (vmode && !version && existing.versions.length >= MAX_VERSIONS) { notFound(`Píseň už má ${MAX_VERSIONS} verze (hlavní a dvě další). Nejdřív některou smaž.`); return; }
  let newAudio = null;          // File vybraný v tomto formuláři
  let removeAudio = false;
  let picked = null;            // text převzatý z internetu: { source, sourceUrl, altText }

  const f = {
    title: el('input', { value: existing?.title || draft?.title || '', required: true, autocomplete: 'off', placeholder: 'Calon Lân' }),
    artist: el('input', { value: existing?.artist || draft?.artist || '', autocomplete: 'off', placeholder: 'Interpret (nepovinné)' }),
    language: el('select', {}, LANGUAGES.map(([code, label]) => el('option', { value: code, text: label }))),
    tags: el('input', { value: (existing?.tags || []).join(', '), autocomplete: 'off', placeholder: 'hymny, lidovky, rugby' }),
    text: el('textarea', { value: version ? (isSynced(version) ? toLrc(existing, version).split('\n').filter(l => !/^\[(ti|ar):/.test(l)).join('\n').trim() : toPlainText(version).trim()) : draft?.text || '',
      placeholder: 'Vlož text písně. Sloky odděl prázdným řádkem.\nFunguje i formát LRC s časy: [00:12.50]Text verše', spellcheck: false }),
    label: el('input', { value: version?.label || '', autocomplete: 'off', placeholder: 'Např. Wicidestun, z videa, ze zpěvníku' }),
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

  const linesToText = lines => lines.map(l => (l.stanza ? '\n' : '') + (l.start != null ? `[${formatMs(l.start)}]` : '') + l.text).join('\n').trim();
  const pickedNote = el('div', { class: 'hint', hidden: true });
  function applyPick(d) {
    if (f.text.value.trim() && !confirm('Nahradit text ve formuláři nalezeným textem?')) return;
    picked = { source: d.source || 'web', sourceUrl: d.sourceUrl || '', altText: d.altText || '' };
    f.text.value = d.timedLines ? linesToText(d.timedLines) : d.text;
    if (vmode && !f.label.value.trim()) {
      let host = '';
      try { host = d.sourceUrl ? new URL(d.sourceUrl).hostname.replace(/^www\./, '') : ''; } catch { /* nic */ }
      f.label.value = (SOURCES.find(x => x.id === d.source) || {}).name || host || '';
    }
    if (!f.title.value.trim() && d.title) f.title.value = d.title;
    if (!f.artist.value.trim() && d.artist) f.artist.value = d.artist;
    if (!f.youtube.value.trim() && d.youtubeId) f.youtube.value = `https://youtu.be/${d.youtubeId}`;
    pickedNote.hidden = false;
    pickedNote.textContent = `Text převzat: ${d.sourceUrl || d.source}${d.altText ? ' (i s překladem ze zdroje)' : ''}${d.timedLines ? ', časy z LRCLIB' : ''}`;
    toast('Text převzat. Zkontroluj ho a ulož.');
  }

  const finder = el('div', { class: 'finder' },
    el('button', { type: 'button', class: 'btn primary', text: '🔍 Najít text na internetu', onclick: () => openSearch({ title: f.title.value, artist: f.artist.value }, applyPick) }),
    el('button', { type: 'button', class: 'btn', text: '🔗 Z odkazu', onclick: () => askUrl(applyPick) }));

  const form = el('form', { class: 'form', onsubmit: e => { e.preventDefault(); save(); } },
    vmode ? el('p', { class: 'hint', text: 'Text písně z jiného zdroje. Porovná se s hlavní verzí a rozdíly rozhodneš poslechem. Učíš se dál hlavní verzi.' }) : null,
    finder,
    ...(vmode ? [field('Název verze', f.label, 'Aby bylo poznat, odkud text je.')] : [
      field('Název písně *', f.title),
      field('Interpret', f.artist),
      el('div', { class: 'row' }, el('div', { class: 'grow' }, field('Jazyk', f.language)), el('div', { class: 'grow' }, field('Štítky', f.tags)))]),
    el('div', { class: 'field' },
      el('span', { text: vmode ? 'Text verze' : 'Text písně' }),
      f.text,
      el('div', { class: 'row' },
        el('div', { class: 'hint grow', text: vmode ? 'Prostý text nebo LRC (s časy půjde poslouchat i nahrávka této verze).' : 'Prostý text nebo LRC. Při úpravě zůstanou překlady a poznámky u veršů, které nezměníš.' }),
        el('button', { type: 'button', class: 'btn small', text: 'Načíst ze souboru', onclick: loadTextFile })),
      pickedNote),
    field('Video na YouTube', f.youtube, vmode ? 'Jen když má tahle verze vlastní video (jinak se poslouchá nahrávka hlavní verze).' : 'Odkaz nebo 11znakové ID videa.'),
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
      (vmode ? version : existing) ? el('button', { type: 'button', class: 'btn danger', text: vmode ? 'Smazat verzi' : 'Smazat', onclick: remove }) : null,
      el('span', { class: 'grow' }),
      el('button', { type: 'button', class: 'btn', text: 'Zrušit', onclick: () => nav.back() }),
      el('button', { type: 'submit', class: 'btn primary', text: vmode ? (version ? 'Uložit' : 'Přidat verzi') : existing ? 'Uložit' : 'Přidat píseň' })));

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
    const title = vmode ? existing.title : f.title.value.trim();
    if (!title) { toast('Vyplň název písně.'); f.title.focus(); return; }
    const ytRaw = f.youtube.value.trim();
    const youtubeId = ytRaw ? extractYoutubeId(ytRaw) : null;
    if (ytRaw && !youtubeId) { toast('Odkaz na YouTube nepoznávám.'); f.youtube.focus(); return; }
    const lines = parseLyrics(f.text.value);
    if (vmode && !lines.length) { toast('Vlož text verze.'); f.text.focus(); return; }

    const song = existing || newSong({ title, lines: [] });
    let v;
    if (vmode) {
      v = version || newVersion([], { label: '' });
      if (!version) song.versions.push(v);
      v.label = f.label.value.trim() || `Verze ${song.versions.indexOf(v) + 1}`;
    } else {
      v = primaryVersion(song);
      Object.assign(song, { title, artist: f.artist.value.trim(), language: f.language.value, tags: parseTags(f.tags.value) });
    }
    if (picked && picked.altText && !attachAlt(lines, picked.altText)) toast('Překlad ze zdroje nesedí počtem řádků na verše, nepřevzal jsem ho.', 3500);
    v.lines = version ? mergeLines(v.lines, lines) : lines;
    v.youtubeId = youtubeId;
    if (picked) { v.source = picked.source; v.sourceUrl = picked.sourceUrl; }

    try {
      if ((newAudio || removeAudio) && v.audio) { await deleteAudioBlob(v.audio.key); v.audio = null; }
      if (newAudio) {
        const key = uid(16);
        await putAudioBlob(key, newAudio);
        v.audio = { key, name: newAudio.name, type: newAudio.type || '', size: newAudio.size };
      }
      if (existing && existing.versions.length > 1) prune(song);
      await saveSong(song);
    } catch (e) {
      toast(e && e.name === 'QuotaExceededError' ? 'V telefonu došlo místo pro uložení.' : 'Uložení se nepovedlo.');
      return;
    }
    if (vmode && !version) { toast('Verze přidána'); nav.replace(`#/compare/${song.id}/${v.id}`); return; }
    toast(existing ? 'Uloženo' : 'Píseň přidána');
    if (existing) nav.back(); else nav.replace(`#/song/${song.id}`);
  }

  async function remove() {
    if (vmode) {
      if (!confirm(`Smazat verzi „${version.label}“${version.audio ? ' i s její nahrávkou' : ''}? Rozhodnutí sporných míst proti ní se zapomenou.`)) return;
      if (version.audio) await deleteAudioBlob(version.audio.key);
      existing.versions = existing.versions.filter(x => x !== version);
      prune(existing);
      await saveSong(existing);
      toast('Verze smazána');
      nav.back();
      return;
    }
    if (!confirm(`Smazat „${existing.title}“ včetně zvukového souboru? Nejde to vrátit.`)) return;
    await deleteSong(existing);
    toast('Smazáno');
    nav.home();
  }

  updateAudio();
  root.append(el('div', { class: 'view' },
    el('header', { class: 'topbar' }, iconBtn('back', 'Zpět', () => nav.back()),
      vmode ? el('h1', {}, el('span', { text: version ? 'Upravit verzi' : 'Přidat verzi textu' }), el('small', { text: existing.title }))
        : el('h1', { text: existing ? 'Upravit píseň' : 'Nová píseň' })),
    form));
  if (draft?.shareUrl) importFromUrl(draft.shareUrl, applyPick);
  else if (draft?.shareText) applyPick({ text: draft.shareText, source: 'sdílení' });
  else if (!existing && !f.title.value) f.title.focus();
  else if (vmode && !version) f.text.focus();
}
