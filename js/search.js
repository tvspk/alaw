// Hledání textu na internetu: dotaz → výsledky ze všech zdrojů → náhled → převzetí do formuláře písně.
import { el, iconBtn, sheet, toast } from './ui.js';
import { SOURCES, searchAll, loadFromUrl, cleanText } from './sources.js';
import { parseLyrics, borrowTimes, looksLikeLrc, formatMs } from './model.js';
import { isAndroid } from './net.js';

// Výsledek předaný formuláři: { text, title, artist, youtubeId, source, sourceUrl, altText }

export function openSearch(initial, onPick) {
  const state = {};          // id zdroje → { status, results, error, kind }
  const q = { title: initial.title || '', artist: initial.artist || '' };

  const titleIn = el('input', { value: q.title, placeholder: 'Název písně', autocomplete: 'off', enterkeyhint: 'search' });
  const artistIn = el('input', { value: q.artist, placeholder: 'Interpret (nepovinné)', autocomplete: 'off', enterkeyhint: 'search' });
  const list = el('div', { class: 'results' });
  const overlay = el('div', { class: 'overlay' });
  const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = e => { if (e.key === 'Escape' && !document.querySelector('.sheet')) close(); };
  document.addEventListener('keydown', onKey);

  const form = el('form', { class: 'search-form', onsubmit: e => { e.preventDefault(); run(); } },
    el('div', { class: 'row' }, el('label', { class: 'field grow' }, titleIn), el('label', { class: 'field grow' }, artistIn)),
    el('button', { type: 'submit', class: 'btn primary', text: 'Hledat' }));

  overlay.append(el('div', { class: 'view' },
    el('header', { class: 'topbar' }, iconBtn('back', 'Zpět', close), el('h1', { text: 'Najít text' })),
    form, list));
  document.body.append(overlay);

  function run() {
    q.title = titleIn.value.trim();
    q.artist = artistIn.value.trim();
    if (!q.title) { toast('Napiš aspoň název písně.'); titleIn.focus(); return; }
    document.activeElement?.blur?.();
    for (const k of Object.keys(state)) delete state[k];
    searchAll(q, (id, st) => { state[id] = st; draw(); });
  }

  function draw() {
    const groups = SOURCES.filter(s => state[s.id]).map(s => {
      const st = state[s.id];
      let body;
      if (st.status === 'loading') body = el('div', { class: 'src-status', text: 'Hledám…' });
      else if (st.status === 'error') body = el('div', { class: 'src-status err', text: st.kind === 'proxy' ? 'Na počítači potřebuje prostředníka – viz Nastavení.' : st.error });
      else if (!st.results.length) body = el('div', { class: 'src-status', text: 'Nic nenalezeno.' });
      else body = el('div', {}, st.results.map(r => resultCard(r)));
      return el('section', { class: 'src' + (st.status === 'done' && !st.results.length ? ' empty-src' : '') },
        el('h2', {}, s.name, el('small', { text: s.note })), body);
    });
    // zdroje s výsledky nahoru, prázdné a chybové dolů
    const rank = g => g.classList.contains('empty-src') || g.querySelector('.err') ? 1 : 0;
    groups.sort((a, b) => rank(a) - rank(b));
    list.replaceChildren(...groups);
  }

  function resultCard(r) {
    return el('button', { type: 'button', class: 'result', onclick: () => preview(r) },
      el('div', { class: 'r-title' }, r.title, r.artist ? el('span', { text: ` – ${r.artist}` }) : null),
      r.detail ? el('div', { class: 'r-detail', text: r.detail }) : null,
      r.preview ? el('div', { class: 'r-preview', text: r.preview }) : null,
      el('div', { class: 'r-badges' },
        r.synced ? el('span', { class: 'badge', text: '⏱ s časy' }) : null,
        r.altText ? el('span', { class: 'badge', text: '🌐 s překladem' }) : null,
        r.youtubeId ? el('span', { class: 'badge', text: '▶ video' }) : null));
  }

  // Časované texty z LRCLIB pro tutéž píseň – kandidáti na převzetí časů.
  async function timingCandidates() {
    const out = [];
    for (const r of state.lrclib?.results || []) {
      if (!r.synced) continue;
      const l = await r.load();
      out.push({ label: [r.artist, r.detail].filter(Boolean).join(' · '), lines: parseLyrics(l.text) });
    }
    return out;
  }

  async function preview(r) {
    let data;
    const closeLoading = sheet(() => el('div', { class: 'sub', text: 'Načítám text…' }));
    try { data = await r.load(); } catch (e) { closeLoading(); toast(`Nepodařilo se načíst: ${e.message}`, 4000); return; }
    closeLoading();
    if (!data.text) { toast('Tahle stránka text nemá.'); return; }
    const picked = { ...data, title: data.title || r.title, artist: data.artist || r.artist, source: r.source, sourceUrl: data.url || r.url };
    showPreview(picked, r.source === 'lrclib' ? [] : await timingCandidates().catch(() => []), d => { close(); onPick(d); });
  }
}

// Náhled nalezeného textu s volbou „doplnit časy z LRCLIB“.
export function showPreview(picked, timing, onUse) {
  const lines = parseLyrics(picked.text);
  let best = null;
  if (!looksLikeLrc(picked.text)) {
    for (const t of timing) {
      const res = borrowTimes(lines, t.lines);
      if (res.matched >= Math.max(3, lines.length * 0.5) && (!best || res.matched > best.res.matched)) best = { ...t, res };
    }
  }
  const useTimes = el('input', { type: 'checkbox', checked: !!best });
  sheet(close => el('div', {},
    el('h3', { text: [picked.title, picked.artist].filter(Boolean).join(' – ') || 'Nalezený text' }),
    el('div', { class: 'sub' }, `${lines.length} veršů · `, picked.sourceUrl ? el('a', { href: picked.sourceUrl, target: '_blank', rel: 'noopener', text: 'zdroj' }) : picked.source,
      looksLikeLrc(picked.text) ? ' · ⏱ s časy' : '', picked.altText ? ' · 🌐 s překladem' : '', picked.youtubeId ? ' · ▶ video' : ''),
    el('pre', { class: 'lyrics-preview', text: lines.map(l => (l.stanza ? '\n' : '') + (l.start != null ? `${formatMs(l.start, false)}  ` : '') + l.text).join('\n') }),
    best ? el('label', { class: 'check', style: { margin: '10px 0' } }, useTimes,
      el('span', { text: `Doplnit časy z LRCLIB (${best.label}): sedí ${best.res.matched} z ${best.res.total} veršů` })) : null,
    el('div', { class: 'row end' },
      el('button', { type: 'button', class: 'btn', text: 'Zpět', onclick: close }),
      el('button', { type: 'button', class: 'btn primary', text: 'Použít tento text', onclick: () => {
        close();
        onUse({ ...picked, timedLines: best && useTimes.checked ? best.res.lines : null });
      } }))));
}

// Text z odkazu (vložená adresa nebo sdílení z prohlížeče).
export async function importFromUrl(url, onPick) {
  const closeLoading = sheet(() => el('div', { class: 'sub', text: 'Načítám stránku…' }));
  let data;
  try { data = await loadFromUrl(url); } catch (e) {
    closeLoading();
    toast(e.kind === 'proxy' ? 'Na počítači to potřebuje prostředníka (Nastavení → Hledání textů).' : `Nepodařilo se: ${e.message}`, 4500);
    return;
  }
  closeLoading();
  showPreview({ ...data, text: cleanText(data.text), sourceUrl: data.url }, [], onPick);
}

export function askUrl(onPick) {
  const input = el('input', { type: 'url', inputmode: 'url', placeholder: 'https://…', autocomplete: 'off' });
  sheet(close => el('form', { class: 'form', onsubmit: e => { e.preventDefault(); const v = input.value.trim(); if (!v) return; close(); importFromUrl(v, onPick); } },
    el('h3', { text: 'Text z odkazu' }),
    el('div', { class: 'sub', text: isAndroid() ? 'Vlož adresu stránky s textem. Příště můžeš stránku rovnou sdílet z prohlížeče do Alaw.' : 'Vlož adresu stránky s textem písně.' }),
    el('label', { class: 'field' }, input),
    el('div', { class: 'row end' }, el('button', { type: 'button', class: 'btn', text: 'Zrušit', onclick: close }), el('button', { type: 'submit', class: 'btn primary', text: 'Načíst' }))));
  setTimeout(() => input.focus(), 50);
}
