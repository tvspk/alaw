// Hledání textu na internetu: dotaz → výsledky ze všech zdrojů → náhled → převzetí do formuláře písně.
import { el, iconBtn, sheet, toast } from './ui.js';
import { t, pl, srcLabel } from './i18n.js';
import { SOURCES, searchAll, loadFromUrl, cleanText } from './sources.js';
import { parseLyrics, borrowTimes, looksLikeLrc, formatMs } from './model.js';
import { isAndroid } from './net.js';
import { setPrefs } from './store.js';

// Výsledek předaný formuláři: { text, title, artist, youtubeId, source, sourceUrl, altText }

// Dotaz pro Google: u velštiny i „geiriau“ (velšsky „slova, text písně“).
export function googleUrl(q) {
  const words = [q.title ? `"${q.title}"` : '', q.artist || '', q.language === 'cy' || !q.language ? 'geiriau lyrics' : 'lyrics'].filter(Boolean).join(' ');
  return `https://www.google.com/search?q=${encodeURIComponent(words)}`;
}

// opts.songId = píseň, ke které text hledáme: když se pak stránka sdílí z prohlížeče do Alaw, nabídne se text k ní.
export function openSearch(initial, onPick, opts = {}) {
  const state = {};          // id zdroje → { status, results, error, kind }
  const q = { title: initial.title || '', artist: initial.artist || '' };

  const titleIn = el('input', { value: q.title, placeholder: t('Název písně'), autocomplete: 'off', enterkeyhint: 'search' });
  const artistIn = el('input', { value: q.artist, placeholder: t('Interpret (nepovinné)'), autocomplete: 'off', enterkeyhint: 'search' });
  const list = el('div', { class: 'results' });
  const google = el('a', { class: 'btn', href: googleUrl(initial), target: '_blank', rel: 'noopener', text: t('🌐 Hledat na Googlu'), onclick: () => {
    google.href = googleUrl({ ...initial, title: titleIn.value.trim() || initial.title, artist: artistIn.value.trim() });
    if (opts.songId) setPrefs({ shareTarget: { id: opts.songId, title: initial.title || titleIn.value.trim(), t: Date.now() } });
  } });
  const elsewhere = el('div', { class: 'search-else' },
    el('div', { class: 'hint', text: isAndroid()
      ? t('Nenašel ses? Hledej na Googlu a stránku s textem pak v prohlížeči sdílej do Alaw (Sdílet → Alaw).')
      : t('Nenašel ses? Hledej na Googlu, zkopíruj adresu stránky s textem a vlož ji přes „Vložit odkaz“.') }),
    el('div', { class: 'row' }, google,
      el('button', { type: 'button', class: 'btn', text: t('🔗 Vložit odkaz'), onclick: () => askUrl(d => { close(); onPick(d); }) })));
  const overlay = el('div', { class: 'overlay' });
  const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = e => { if (e.key === 'Escape' && !document.querySelector('.sheet')) close(); };
  document.addEventListener('keydown', onKey);

  const form = el('form', { class: 'search-form', onsubmit: e => { e.preventDefault(); run(); } },
    el('div', { class: 'row' }, el('label', { class: 'field grow' }, titleIn), el('label', { class: 'field grow' }, artistIn)),
    el('button', { type: 'submit', class: 'btn primary', text: t('Hledat') }));

  overlay.append(el('div', { class: 'view' },
    el('header', { class: 'topbar' }, iconBtn('back', t('Zpět'), close), el('h1', { text: t('Najít text') })),
    form, elsewhere, list));
  document.body.append(overlay);

  function run() {
    q.title = titleIn.value.trim();
    q.artist = artistIn.value.trim();
    if (!q.title) { toast(t('Napiš aspoň název písně.')); titleIn.focus(); return; }
    document.activeElement?.blur?.();
    for (const k of Object.keys(state)) delete state[k];
    searchAll(q, (id, st) => { state[id] = st; draw(); });
  }

  function draw() {
    const groups = SOURCES.filter(s => state[s.id]).map(s => {
      const st = state[s.id];
      let body;
      if (st.status === 'loading') body = el('div', { class: 'src-status', text: t('Hledám…') });
      else if (st.status === 'error') body = el('div', { class: 'src-status err', text: st.kind === 'proxy' ? t('Na počítači potřebuje prostředníka – viz Nastavení.') : st.error });
      else if (!st.results.length) body = el('div', { class: 'src-status', text: t('Nic nenalezeno.') });
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
        r.synced ? el('span', { class: 'badge', text: t('⏱ s časy') }) : null,
        r.altText ? el('span', { class: 'badge', text: t('🌐 s překladem') }) : null,
        r.youtubeId ? el('span', { class: 'badge', text: t('▶ video') }) : null));
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
    const closeLoading = sheet(() => el('div', { class: 'sub', text: t('Načítám text…') }));
    try { data = await r.load(); } catch (e) { closeLoading(); toast(t('Nepodařilo se načíst: {e}', { e: e.message }), 4000); return; }
    closeLoading();
    if (!data.text) { toast(t('Tahle stránka text nemá.')); return; }
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
    el('h3', { text: [picked.title, picked.artist].filter(Boolean).join(' – ') || t('Nalezený text') }),
    el('div', { class: 'sub' }, pl(lines.length, '{n} verš', '{n} verše', '{n} veršů') + ' · ', picked.sourceUrl ? el('a', { href: picked.sourceUrl, target: '_blank', rel: 'noopener', text: t('zdroj') }) : srcLabel(picked.source),
      looksLikeLrc(picked.text) ? ' · ' + t('⏱ s časy') : '', picked.altText ? ' · ' + t('🌐 s překladem') : '', picked.youtubeId ? ' · ' + t('▶ video') : ''),
    el('pre', { class: 'lyrics-preview', text: lines.map(l => (l.stanza ? '\n' : '') + (l.start != null ? `${formatMs(l.start, false)}  ` : '') + l.text).join('\n') }),
    best ? el('label', { class: 'check', style: { margin: '10px 0' } }, useTimes,
      el('span', { text: t('Doplnit časy z LRCLIB ({l}): sedí {n} z {m} veršů', { l: best.label, n: best.res.matched, m: best.res.total }) })) : null,
    el('div', { class: 'row end' },
      el('button', { type: 'button', class: 'btn', text: t('Zpět'), onclick: close }),
      el('button', { type: 'button', class: 'btn primary', text: t('Použít tento text'), onclick: () => {
        close();
        onUse({ ...picked, timedLines: best && useTimes.checked ? best.res.lines : null });
      } }))));
}

// Text z odkazu (vložená adresa nebo sdílení z prohlížeče).
export async function importFromUrl(url, onPick) {
  const closeLoading = sheet(() => el('div', { class: 'sub', text: t('Načítám stránku…') }));
  let data;
  try { data = await loadFromUrl(url); } catch (e) {
    closeLoading();
    toast(e.kind === 'proxy' ? t('Na počítači to potřebuje prostředníka (Nastavení → Hledání textů).') : t('Nepodařilo se: {e}', { e: e.message }), 4500);
    return;
  }
  closeLoading();
  showPreview({ ...data, text: cleanText(data.text), sourceUrl: data.url }, [], onPick);
}

export function askUrl(onPick) {
  const input = el('input', { type: 'url', inputmode: 'url', placeholder: 'https://…', autocomplete: 'off' });
  sheet(close => el('form', { class: 'form', onsubmit: e => { e.preventDefault(); const v = input.value.trim(); if (!v) return; close(); importFromUrl(v, onPick); } },
    el('h3', { text: t('Text z odkazu') }),
    el('div', { class: 'sub', text: isAndroid() ? t('Vlož adresu stránky s textem. Příště můžeš stránku rovnou sdílet z prohlížeče do Alaw.') : t('Vlož adresu stránky s textem písně.') }),
    el('label', { class: 'field' }, input),
    el('div', { class: 'row end' }, el('button', { type: 'button', class: 'btn', text: t('Zrušit'), onclick: close }), el('button', { type: 'submit', class: 'btn primary', text: t('Načíst') }))));
  setTimeout(() => input.focus(), 50);
}
