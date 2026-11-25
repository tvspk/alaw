// Zpěvník (0.17, obrazovka #/book): vybrané písně s textem (a překladem pod verši) k tisku nebo uložení do PDF.
// Počítač: tisk prohlížeče (Uložit jako PDF). Android: systémový tisk přes most AlawAndroid.print.
import { el, fill, iconBtn } from './ui.js';
import { t, pl, collate } from './i18n.js';
import { listSongs, getPrefs, setPrefs } from './store.js';
import { primaryVersion, trOf } from './model.js';

const KEY = 'alaw-book'; // vybrané písně (sessionStorage, ať přežijí obnovení stránky)
export function setBookSongs(ids) { try { sessionStorage.setItem(KEY, JSON.stringify(ids)); } catch { /* nic */ } }
function bookIds() { try { return JSON.parse(sessionStorage.getItem(KEY) || 'null'); } catch { return null; } }

export async function renderBook(root, nav) {
  const ids = bookIds();
  const all = await listSongs();
  const songs = all.filter(s => primaryVersion(s).lines.length && (!ids || ids.includes(s.id)))
    .sort((a, b) => collate(a.title, b.title));
  const o = { tr: 'cs', lit: false, page: true, toc: true, title: t('Zpěvník'), ...(getPrefs().book || {}) };
  const save = () => setPrefs({ book: { tr: o.tr, lit: o.lit, page: o.page, toc: o.toc } });

  const book = el('div', { class: 'book' });
  function draw() {
    const head = el('div', { class: 'b-cover' }, el('h1', { text: o.title || t('Zpěvník') }));
    const toc = o.toc && songs.length > 1 ? el('ol', { class: 'b-toc' }, songs.map(s => el('li', {}, el('span', { text: s.title }), s.artist ? el('small', { text: ` – ${s.artist}` }) : null))) : null;
    const items = songs.map(s => {
      const v = primaryVersion(s);
      return el('section', { class: 'b-song' + (o.page ? ' b-page' : '') },
        el('h2', { text: s.title }), s.artist ? el('div', { class: 'b-artist', text: s.artist }) : null,
        el('div', { class: 'b-lines' }, v.lines.map(l => {
          const x = o.tr ? trOf(l, o.tr) : null;
          const tr = x && (o.lit ? x.literal || x.translation : x.translation);
          return el('div', { class: 'b-line' + (l.stanza ? ' stanza' : '') }, el('div', { class: 'b-text', text: l.text }), tr ? el('div', { class: 'b-tr', text: tr }) : null);
        })));
    });
    fill(book, head, toc, items);
  }

  const opt = (label, cur, val, set) => el('button', { type: 'button', class: 'btn small' + (cur() === val ? ' primary' : ''), text: label, onclick: () => { set(val); save(); drawTools(); draw(); } });
  const tools = el('div', { class: 'no-print b-tools' });
  const titleIn = el('input', { value: o.title, 'aria-label': t('Název zpěvníku'), oninput: () => { o.title = titleIn.value; draw(); } });
  function drawTools() {
    const ck = (label, key) => el('label', { class: 'check' }, el('input', { type: 'checkbox', checked: o[key], onchange: e => { o[key] = e.target.checked; save(); draw(); } }), el('span', { text: label }));
    fill(tools,
      el('p', { class: 'hint', text: pl(songs.length, '{n} píseň', '{n} písně', '{n} písní') + ' · ' + t('řazeno podle názvu') }),
      el('label', { class: 'field' }, el('span', { text: t('Název zpěvníku') }), titleIn),
      el('div', { class: 'row', style: { flexWrap: 'wrap', gap: '6px', margin: '8px 0' } },
        el('span', { text: t('Překlad pod verši:') }),
        opt(t('bez'), () => o.tr, null, v => { o.tr = v; }), opt(t('čeština'), () => o.tr, 'cs', v => { o.tr = v; }), opt(t('angličtina'), () => o.tr, 'en', v => { o.tr = v; })),
      o.tr ? ck(t('Doslovný překlad místo běžného (kde je)'), 'lit') : null,
      ck(t('Každá píseň na novou stránku'), 'page'),
      ck(t('Obsah na začátku'), 'toc'),
      el('div', { class: 'row', style: { marginTop: '12px' } },
        el('button', { type: 'button', class: 'btn primary', text: t('🖨 Uložit jako PDF / vytisknout'), onclick: print })),
      el('p', { class: 'hint', text: window.AlawAndroid?.print ? t('Otevře se tisk Androidu – nahoře vyber „Uložit jako PDF“.') : t('Otevře se tisk prohlížeče – jako tiskárnu vyber „Uložit jako PDF“.') }));
  }
  function print() {
    const prevTitle = document.title;
    document.title = o.title || 'Alaw'; // název souboru PDF
    if (window.AlawAndroid?.print) window.AlawAndroid.print(document.title);
    else window.print();
    setTimeout(() => { document.title = prevTitle; }, 1000);
  }

  root.append(el('div', { class: 'view book-view' },
    el('header', { class: 'topbar no-print' }, iconBtn('back', t('Zpět'), () => nav.back()), el('h1', { text: t('Zpěvník') })),
    songs.length ? tools : el('p', { class: 'empty', text: t('Žádná z vybraných písní nemá text.') }),
    book));
  drawTools(); draw();
}
