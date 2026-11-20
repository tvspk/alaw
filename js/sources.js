// Zdroje textů písní. Každý zdroj umí search(dotaz) → výsledky; výsledek má load() → { text, altText, youtubeId, url, synced }.
//  text     = text písně (prostý, nebo LRC s časy), sloky oddělené prázdným řádkem
//  altText  = překlad ze zdroje (obvykle anglický), řádek po řádku k textu – nepovinné
import { getJson, getHtml, request } from './net.js';
import { t } from './i18n.js';
import { fold, extractYoutubeId } from './model.js';

const UA_HEADER = { 'Api-User-Agent': 'AlawLyrics/0.2 (https://github.com/tvspk/alaw)' };

// ---------- úprava textu ----------

export function cleanText(raw) {
  const lines = String(raw || '')
    .replace(/\r\n?/g, '\n')
    .replace(/[  ​]/g, ' ')
    .replace(/[‘’′`´]/g, "'")
    .replace(/[“”″]/g, '"')
    .split('\n')
    .map(l => l.replace(/[ \t]+/g, ' ').trim());
  const out = [];
  for (const l of lines) {
    if (!l && (!out.length || out[out.length - 1] === '')) continue;
    out.push(l);
  }
  while (out.length && out[out.length - 1] === '') out.pop();
  return out.join('\n');
}

const BLOCK = new Set(['P', 'DIV', 'LI', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'TR', 'BLOCKQUOTE', 'SECTION', 'ARTICLE', 'PRE', 'UL', 'OL', 'TABLE', 'FIGURE']);

// Text prvku s řádky podle <br> a blokových prvků; prázdné bloky (odstavce) oddělí sloky.
export function elementText(el) {
  let out = '';
  const walk = node => {
    for (const n of node.childNodes) {
      if (n.nodeType === 3) out += n.nodeValue.replace(/\s*\n\s*/g, ' ');
      else if (n.nodeType === 1) {
        const tag = n.tagName;
        if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT' || tag === 'BUTTON') continue;
        if (tag === 'BR') { out += '\n'; continue; }
        const block = BLOCK.has(tag);
        if (block) out += '\n';
        walk(n);
        if (block) out += tag === 'P' || n.classList?.contains('par') || n.classList?.contains('emptyline') ? '\n\n' : '\n';
      }
    }
  };
  walk(el);
  return cleanText(out);
}

// Odstraní wiki značky z textu písně.
export function wikiToText(w) {
  let s = String(w || '');
  s = s.replace(/<ref[^>]*>[\s\S]*?<\/ref>|<ref[^>]*\/>/gi, '');
  s = s.replace(/<!--[\s\S]*?-->/g, '');
  s = s.replace(/\[\[(?:File|Image|Delwedd|Ffeil|Category|Categori|Categories)[^\]]*\]\]/gi, '');
  s = s.replace(/\[\[[^\]|]*\|([^\]]*)\]\]/g, '$1').replace(/\[\[([^\]]*)\]\]/g, '$1');
  s = s.replace(/\[https?:\/\/\S+\s([^\]]*)\]/g, '$1');
  s = s.replace(/'''''|'''|''/g, '');
  s = s.replace(/<br\s*\/?>/gi, '\n').replace(/<\/?(poem|center|div|span|p|small|big|i|b|u|s)[^>]*>/gi, '');
  s = s.replace(/^[:*#;]+\s*/gm, '');
  s = s.replace(/__[A-Z]+__/g, '');
  return cleanText(s);
}

// Najde šablonu {{Název|a=b|…}} a vrátí její parametry (správně i s vnořenými {{ }} a [[ ]]).
export function wikiTemplate(text, name) {
  const re = new RegExp(`\\{\\{\\s*${name}\\s*[|}]`, 'i');
  const m = re.exec(text);
  if (!m) return null;
  let i = m.index + 2, depth = 0, cur = '';
  const parts = [];
  for (; i < text.length; i++) {
    const two = text.slice(i, i + 2);
    if (two === '{{' || two === '[[') { depth++; cur += two; i++; continue; }
    if (two === '}}' && depth === 0) { parts.push(cur); break; }
    if (two === '}}' || two === ']]') { depth--; cur += two; i++; continue; }
    if (text[i] === '|' && depth === 0) { parts.push(cur); cur = ''; continue; }
    cur += text[i];
  }
  const params = { _: [] };
  parts.slice(1).forEach(p => {
    const eq = p.indexOf('=');
    if (eq > 0 && /^[\w\s-]+$/.test(p.slice(0, eq))) params[p.slice(0, eq).trim().toLowerCase()] = p.slice(eq + 1).trim();
    else params._.push(p.trim());
  });
  return params;
}

// ---------- podobnost výsledku s dotazem ----------

const words = s => fold(s).replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean);
export function similarity(a, b) {
  const A = words(a), B = words(b);
  if (!A.length || !B.length) return 0;
  const setB = new Set(B);
  const common = A.filter(w => setB.has(w)).length;
  let s = (2 * common) / (A.length + B.length);
  if (fold(a).replace(/\W/g, '') === fold(b).replace(/\W/g, '')) s = 1;
  return s;
}
export function score(r, q) {
  const t = similarity(r.title, q.title);
  if (!q.artist) return t;
  return t * 0.75 + similarity(r.artist || '', q.artist) * 0.25;
}

const firstLines = (text, n = 2) => cleanText(text).replace(/^\[[^\]]*\]/gm, '').split('\n').filter(Boolean).slice(0, n).join(' / ');

// ---------- jednotlivé zdroje ----------

const lrclib = {
  id: 'lrclib', name: 'LRCLIB', note: t('texty s časy'),
  async search(q) {
    const p = new URLSearchParams(q.artist ? { track_name: q.title, artist_name: q.artist } : { q: q.title });
    let list = await getJson(`https://lrclib.net/api/search?${p}`);
    if (!list.length && q.artist) list = await getJson(`https://lrclib.net/api/search?${new URLSearchParams({ q: `${q.artist} ${q.title}` })}`);
    const seen = new Set();
    return list.filter(x => !x.instrumental && (x.syncedLyrics || x.plainLyrics)).filter(x => {
      const k = fold(x.plainLyrics || x.syncedLyrics).slice(0, 200);
      if (seen.has(k)) return false;
      seen.add(k); return true;
    }).map(x => ({
      title: x.trackName, artist: x.artistName, detail: [x.albumName, x.duration ? `${Math.floor(x.duration / 60)}:${String(Math.round(x.duration % 60)).padStart(2, '0')}` : ''].filter(Boolean).join(' · '),
      synced: !!x.syncedLyrics, dur: Number.isFinite(x.duration) ? x.duration : null, preview: firstLines(x.plainLyrics || x.syncedLyrics.replace(/\[\d+:[\d.]+\]/g, '')),
      url: `https://lrclib.net/api/get/${x.id}`,
      load: async () => ({ text: x.syncedLyrics || x.plainLyrics, synced: !!x.syncedLyrics, plain: x.plainLyrics || '', url: `https://lrclib.net/api/get/${x.id}` }),
    }));
  },
};

// MediaWiki (Welsh Lyrics wiki na Fandomu, velšská Wikisource): hledání + obsah všech nalezených stránek jedním dotazem.
async function mediawikiSearch(base, q, parse, pageUrl) {
  const api = `${base}?format=json&formatversion=2&origin=*`;
  const s = await getJson(`${api}&action=query&list=search&srlimit=10&srnamespace=0&srsearch=${encodeURIComponent([q.title, q.artist].filter(Boolean).join(' '))}`, { headers: UA_HEADER });
  const titles = (s.query?.search || []).map(x => x.title).filter(t => !/^(Recently Added|Main Page|Hafan)/i.test(t));
  if (!titles.length) return [];
  const c = await getJson(`${api}&action=query&prop=revisions&rvprop=content&rvslots=main&titles=${encodeURIComponent(titles.join('|'))}`, { headers: UA_HEADER });
  const pages = (c.query?.pages || []).filter(p => p.revisions);
  pages.sort((a, b) => titles.indexOf(a.title) - titles.indexOf(b.title));
  return pages.map(p => {
    const parsed = parse(p.revisions[0].slots.main.content, p.title);
    if (!parsed || !parsed.text) return null;
    const url = pageUrl(p.title);
    return { ...parsed, preview: firstLines(parsed.text), url, load: async () => ({ ...parsed, url }) };
  }).filter(Boolean);
}

function parseWelshLyricsWiki(wt, pageTitle) {
  if (/^#(REDIRECT|AILGYFEIRIO)/i.test(wt)) return null;
  const song = wikiTemplate(wt, 'Song') || {};
  const lyr = wikiTemplate(wt, 'Lyrics');
  let text = lyr ? (lyr.cymraeg || lyr.welsh || lyr.lyrics || lyr._[0] || '') : '';
  if (!text) return null;
  const alt = lyr.saesneg || lyr.english || lyr._[1] || '';
  const yt = (wt.match(/<youtube[^>]*>([^<]+)<\/youtube>/i) || [])[1] || (wikiTemplate(wt, 'youtube') || { _: [] })._[0];
  const m = pageTitle.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
  return {
    title: m ? m[1] : pageTitle,
    artist: wikiToText(song.singer || song.artist || (m ? m[2] : '')),
    detail: [song.released && song.released !== 'Unknown' ? song.released : '', song.genre].filter(Boolean).join(' · '),
    text: wikiToText(text), altText: alt ? wikiToText(alt) : '', youtubeId: extractYoutubeId(yt || ''),
  };
}

const welshWiki = {
  id: 'welshlyrics', name: 'Welsh Lyrics wiki', note: 'welshlyrics.fandom.com',
  search: q => mediawikiSearch('https://welshlyrics.fandom.com/api.php', q, parseWelshLyricsWiki,
    t => `https://welshlyrics.fandom.com/wiki/${encodeURIComponent(t.replace(/ /g, '_'))}`),
};

const GENERIC_CATS = /^(emynau|caneuon|cerddi|barddoniaeth|llenyddiaeth|tudalennau|testunau|hymns|songs|poems)/i;
function parseWikisource(wt, pageTitle) {
  const poem = wt.match(/<poem[^>]*>([\s\S]*?)<\/poem>/i);
  if (!poem) return null;
  const cats = [...wt.matchAll(/\[\[\s*(?:Categori|Category)\s*:\s*([^\]|]+)/gi)].map(m => m[1].trim());
  const author = cats.find(c => !GENERIC_CATS.test(c)) || '';
  return { title: pageTitle, artist: author, detail: cats.filter(c => GENERIC_CATS.test(c)).join(', '), text: wikiToText(poem[1]) };
}

const wikisource = {
  id: 'wikisource', name: 'Wicidestun', note: t('velšská Wikisource – hymny a lidovky'),
  search: q => mediawikiSearch('https://cy.wikisource.org/w/api.php', { title: q.title }, parseWikisource,
    t => `https://cy.wikisource.org/wiki/${encodeURIComponent(t.replace(/ /g, '_'))}`),
};

// lyricstranslate.com
async function loadLyricsTranslate(url) {
  const { doc } = await getHtml(url);
  const body = doc.querySelector('#song-body');
  if (!body) throw new Error(t('Na stránce jsem text nenašel.'));
  body.querySelectorAll('[id^="adngin"], script, .emptyline').forEach(n => n.remove());
  const stanzas = [...body.querySelectorAll('.par')].map(p => [...p.children].map(d => cleanText(d.textContent)).filter(Boolean).join('\n'));
  const text = stanzas.length ? stanzas.join('\n\n') : elementText(body);
  const yt = doc.querySelector('lite-youtube[videoid]')?.getAttribute('videoid') || doc.querySelector('[youtube]')?.getAttribute('youtube');
  const h = (doc.querySelector('title')?.textContent || '').replace(/\s+lyrics.*$/i, '');
  const [artist, title] = h.includes(' - ') ? [h.slice(0, h.indexOf(' - ')), h.slice(h.indexOf(' - ') + 3)] : ['', h];
  return { text: cleanText(text), youtubeId: extractYoutubeId(yt || ''), url, title: title.trim(), artist: artist.trim() };
}

const lyricsTranslate = {
  id: 'lyricstranslate', name: 'LyricsTranslate', note: t('velšská scéna, často s překlady'),
  async search(q) {
    const { doc } = await getHtml(`https://lyricstranslate.com/en/site-search?query=${encodeURIComponent([q.artist, q.title].filter(Boolean).join(' '))}`);
    return [...doc.querySelectorAll('.block-search-res__item')].map(it => {
      const a = it.querySelector('a.block-1-table__title');
      if (!a || !it.querySelector('.table__langs')) return null; // bez jazyka = stránka interpreta, ne píseň
      const url = new URL(a.getAttribute('href'), 'https://lyricstranslate.com').href;
      return {
        title: cleanText(a.textContent), artist: cleanText(it.querySelector('.block-1-table__author')?.textContent || ''),
        detail: cleanText(it.querySelector('.table__langs')?.textContent || ''), url, load: () => loadLyricsTranslate(url),
      };
    }).filter(Boolean);
  },
};

// Bandcamp: hledání přes jejich veřejné API, text je v JSONu stránky skladby.
async function loadBandcamp(url) {
  const { doc } = await getHtml(url);
  const raw = doc.querySelector('[data-tralbum]')?.getAttribute('data-tralbum');
  let lyrics = '';
  if (raw) {
    try {
      const d = JSON.parse(raw);
      lyrics = d.current?.lyrics || (d.trackinfo || []).map(t => t.lyrics).find(Boolean) || '';
    } catch { /* nic */ }
  }
  if (!lyrics) lyrics = doc.querySelector('.lyricsText') ? elementText(doc.querySelector('.lyricsText')) : '';
  return { text: cleanText(lyrics), url };
}

const bandcamp = {
  id: 'bandcamp', name: 'Bandcamp', note: t('texty přímo od interpretů'),
  async search(q) {
    const r = await request('https://bandcamp.com/api/bcsearch_public_api/1/autocomplete_elastic', {
      method: 'POST', type: 'json', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ search_text: [q.artist, q.title].filter(Boolean).join(' '), search_filter: 't', full_page: false, fan_id: null }),
    });
    const items = (r.json.auto?.results || []).filter(x => x.type === 't' && x.item_url_path).slice(0, 6);
    // Bandcamp má text jen u části skladeb: rovnou zjistíme, které ho mají.
    const loaded = await Promise.all(items.map(x => loadBandcamp(x.item_url_path).catch(() => null)));
    return items.map((x, i) => loaded[i] && loaded[i].text ? {
      title: x.name, artist: x.band_name, detail: x.album_name || '', url: x.item_url_path,
      preview: firstLines(loaded[i].text), load: async () => loaded[i],
    } : null).filter(Boolean);
  },
};

// welearnwelsh.com: WordPress, texty ve dvou sloupcích (velšsky | anglicky).
async function loadWelearnwelsh(url) {
  const { doc } = await getHtml(url);
  const content = doc.querySelector('.entry-content, article') || doc.body;
  for (const cols of content.querySelectorAll('.wp-block-columns')) {
    const c = cols.querySelectorAll(':scope > .wp-block-column');
    if (c.length >= 2 && c[0].querySelectorAll('br').length >= 3) {
      return { text: elementText(c[0]), altText: elementText(c[1]), url, title: cleanText(doc.querySelector('h1')?.textContent || '') };
    }
  }
  // Jinak: odstavce pod nadpisem „… Welsh Lyrics“, překlad pod nadpisem „… English Translation“.
  const section = re => {
    const h = [...content.querySelectorAll('h2, h3, h4')].find(x => re.test(x.textContent));
    if (!h) return '';
    const parts = [];
    for (let n = h.nextElementSibling; n && !/^H[2-4]$/.test(n.tagName); n = n.nextElementSibling) {
      if (n.tagName === 'P' && n.querySelector('br')) parts.push(elementText(n));
    }
    return parts.join('\n\n');
  };
  const text = section(/lyrics|geiriau/i);
  if (text) return { text, altText: section(/translation|english|cyfieithiad/i), url, title: cleanText(doc.querySelector('h1')?.textContent || '') };
  const g = genericExtract(doc);
  if (!g) throw new Error(t('Na stránce jsem text nenašel.'));
  return { text: g, url };
}

const welearnwelsh = {
  id: 'welearnwelsh', name: 'We Learn Welsh', note: t('známé písně s anglickým překladem'),
  async search(q) {
    const list = await getJson(`https://welearnwelsh.com/wp-json/wp/v2/search?per_page=10&search=${encodeURIComponent(q.title)}`);
    return list.filter(x => /lyrics|geiriau/i.test(`${x.url} ${x.title}`)).map(x => {
      const t = cleanText(new DOMParser().parseFromString(x.title, 'text/html').documentElement.textContent);
      const quoted = t.match(/[‘“'"]([^‘’“”'"]{2,60})[’”'"]/);
      return { title: quoted ? quoted[1] : t.split(/\s+[–-]\s+/)[0], artist: '', detail: t, url: x.url, load: () => loadWelearnwelsh(x.url) };
    });
  },
};

// Genius
async function loadGenius(url) {
  const { doc } = await getHtml(url);
  const boxes = [...doc.querySelectorAll('[data-lyrics-container="true"]')];
  if (!boxes.length) throw new Error(t('Na stránce jsem text nenašel.'));
  boxes.forEach(b => b.querySelectorAll('[data-exclude-from-selection="true"]').forEach(n => n.remove()));
  const text = boxes.map(elementText).join('\n')
    .split('\n').map(l => (/^\[.*\]$/.test(l.trim()) ? '' : l)).join('\n');
  return { text: cleanText(text), url };
}

const genius = {
  id: 'genius', name: 'Genius', note: t('hlavně anglické písně'),
  async search(q) {
    const d = await getJson(`https://genius.com/api/search/multi?per_page=5&q=${encodeURIComponent([q.artist, q.title].filter(Boolean).join(' '))}`);
    const hits = (d.response?.sections || []).filter(s => s.type === 'song').flatMap(s => s.hits || []);
    return hits.map(h => h.result).filter(r => r && r.url && r.lyrics_state !== 'unreleased').map(r => ({
      title: r.title, artist: r.primary_artist?.name || r.artist_names || '', detail: r.release_date_for_display || '', url: r.url, load: () => loadGenius(r.url),
    }));
  },
};

// AZLyrics: adresa se dá odvodit z interpreta a názvu.
const azSlug = s => fold(s).replace(/^the\s+/, '').replace(/[^a-z0-9]/g, '');
async function loadAz(url) {
  const r = await request(url);
  const m = r.text.match(/<!--\s*Usage of azlyrics\.com content[\s\S]*?-->([\s\S]*?)<\/div>/i);
  if (!m) throw new Error(t('Na stránce jsem text nenašel.'));
  const doc = new DOMParser().parseFromString(`<div>${m[1]}</div>`, 'text/html');
  return { text: elementText(doc.body.firstChild), url };
}
const azlyrics = {
  id: 'azlyrics', name: 'AZLyrics', note: t('jen s interpretem, hlavně anglické písně'),
  async search(q) {
    if (!q.artist) return [];
    const url = `https://www.azlyrics.com/lyrics/${azSlug(q.artist)}/${azSlug(q.title)}.html`;
    let loaded;
    try { loaded = await loadAz(url); } catch (e) { if (e.kind === 'notfound') return []; throw e; }
    return [{ title: q.title, artist: q.artist, url, preview: firstLines(loaded.text), load: async () => loaded }];
  },
};

export const SOURCES = [lrclib, welshWiki, lyricsTranslate, wikisource, bandcamp, welearnwelsh, genius, azlyrics];

// ---------- obecné čtení stránky (sdílený odkaz, neznámý web) ----------

export function genericExtract(doc) {
  const root = doc.body.cloneNode(true);
  root.querySelectorAll('script, style, noscript, nav, header, footer, aside, form, iframe, svg, button, [role=navigation], .comments, #comments').forEach(n => n.remove());
  // Kandidát = blok s mnoha krátkými řádky (verše). Vyhraje nejmenší blok, který má skoro nejvíc veršů –
  // aby se nevybral celý obsah stránky i s okolním textem.
  const cands = [];
  for (const el of root.querySelectorAll('div, p, pre, td, article, section, blockquote')) {
    const text = elementText(el);
    const lines = text.split('\n').filter(Boolean);
    if (lines.length < 4) continue;
    const lyricish = lines.filter(l => { const n = l.split(' ').length; return n <= 14 && l.length <= 90; }).length;
    const ratio = lyricish / lines.length;
    if (ratio < 0.75) continue;
    cands.push({ text, score: lyricish * ratio });
  }
  if (!cands.length) return null;
  const max = Math.max(...cands.map(c => c.score));
  return cands.filter(c => c.score >= max * 0.85).sort((a, b) => a.text.length - b.text.length)[0].text;
}

const loaders = [
  [/(^|\.)welshlyrics\.fandom\.com$/, async u => {
    const title = decodeURIComponent(new URL(u).pathname.replace(/^\/wiki\//, '')).replace(/_/g, ' ');
    const d = await getJson(`https://welshlyrics.fandom.com/api.php?format=json&formatversion=2&origin=*&action=parse&prop=wikitext&page=${encodeURIComponent(title)}`, { headers: UA_HEADER });
    const p = parseWelshLyricsWiki(d.parse.wikitext, d.parse.title);
    if (!p) throw new Error(t('Stránka nemá text písně.'));
    return { ...p, url: u, source: 'welshlyrics' };
  }],
  [/^cy\.wikisource\.org$/, async u => {
    const title = decodeURIComponent(new URL(u).pathname.replace(/^\/wiki\//, '')).replace(/_/g, ' ');
    const d = await getJson(`https://cy.wikisource.org/w/api.php?format=json&formatversion=2&origin=*&action=parse&prop=wikitext&page=${encodeURIComponent(title)}`, { headers: UA_HEADER });
    const p = parseWikisource(d.parse.wikitext, d.parse.title);
    if (!p) throw new Error(t('Stránka nemá text básně.'));
    return { ...p, url: u, source: 'wikisource' };
  }],
  [/(^|\.)lyricstranslate\.com$/, async u => ({ ...(await loadLyricsTranslate(u)), source: 'lyricstranslate' })],
  [/\.bandcamp\.com$/, async u => ({ ...(await loadBandcamp(u)), source: 'bandcamp' })],
  [/(^|\.)welearnwelsh\.com$/, async u => ({ ...(await loadWelearnwelsh(u)), source: 'welearnwelsh' })],
  [/(^|\.)genius\.com$/, async u => ({ ...(await loadGenius(u)), source: 'genius' })],
  [/(^|\.)azlyrics\.com$/, async u => ({ ...(await loadAz(u)), source: 'azlyrics' })],
];

// Načte text z libovolného odkazu (sdílení z prohlížeče, vložená adresa).
export async function loadFromUrl(url) {
  const u = new URL(url.trim());
  if (!/^https?:$/.test(u.protocol)) throw new Error(t('Odkaz musí začínat http(s)://'));
  const known = loaders.find(([re]) => re.test(u.hostname));
  if (known) return known[1](u.href);
  const { doc } = await getHtml(u.href);
  const text = genericExtract(doc);
  if (!text) throw new Error(t('Na stránce jsem nenašel nic, co vypadá jako text písně.'));
  const yt = [...doc.querySelectorAll('iframe[src*="youtube"], a[href*="youtu"]')].map(n => extractYoutubeId(n.getAttribute('src') || n.getAttribute('href'))).find(Boolean);
  return { text, url: u.href, title: cleanText(doc.querySelector('h1')?.textContent || doc.title || ''), youtubeId: yt || null, source: u.hostname.replace(/^www\./, '') };
}

// Prohledá všechny zdroje najednou. onUpdate(id, { status: 'loading'|'done'|'error', results, error }) se volá průběžně.
export function searchAll(q, onUpdate, sources = SOURCES) {
  return Promise.all(sources.map(async s => {
    onUpdate(s.id, { status: 'loading', results: [] });
    try {
      const raw = await s.search(q);
      const results = raw.map(r => ({ ...r, source: s.id, sourceName: s.name, score: score(r, q) }))
        .filter(r => r.score >= 0.34)
        .sort((a, b) => b.score - a.score || (b.synced ? 1 : 0) - (a.synced ? 1 : 0))
        .slice(0, 5);
      onUpdate(s.id, { status: 'done', results });
    } catch (e) {
      onUpdate(s.id, { status: 'error', results: [], error: e.message || String(e), kind: e.kind || 'error' });
    }
  }));
}
