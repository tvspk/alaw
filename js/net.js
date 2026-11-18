// Stahování z cizích webů. Tři cesty podle toho, kde aplikace běží:
//  1) Android (APK): nativní stahování přes most window.AlawAndroid – žádná omezení CORS, běžné domácí připojení.
//  2) Prohlížeč, web dovoluje přímý přístup (CORS): rovnou fetch (LRCLIB, wiki API, WordPress API).
//  3) Prohlížeč, ostatní weby: přes vlastního prostředníka na Cloudflare Workers (adresa v Nastavení).
import { getPrefs } from './store.js';

// Weby, které z prohlížeče jdou přímo (posílají Access-Control-Allow-Origin).
const CORS_OK = new Set(['lrclib.net', 'welshlyrics.fandom.com', 'cy.wikisource.org', 'welearnwelsh.com']);
const CORS_OK_PATH = { 'welearnwelsh.com': /^\/wp-json\// };

export class NetError extends Error {
  constructor(message, kind = 'error', status = 0) { super(message); this.kind = kind; this.status = status; }
}

export const isAndroid = () => !!(window.AlawAndroid && typeof window.AlawAndroid.fetch === 'function');

// ---------- Android ----------
let nextId = 1;
const pending = new Map();
window.__alawNet = (id, json) => {
  const p = pending.get(id);
  if (!p) return;
  pending.delete(id);
  try {
    const r = JSON.parse(json);
    if (r.error) p.reject(new NetError(r.error, 'offline'));
    else p.resolve(r);
  } catch (e) { p.reject(e); }
};

function androidFetch(req, timeout) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    const timer = setTimeout(() => { pending.delete(id); reject(new NetError('Vypršel čas.', 'timeout')); }, timeout);
    pending.set(id, { resolve: r => { clearTimeout(timer); resolve(r); }, reject: e => { clearTimeout(timer); reject(e); } });
    window.AlawAndroid.fetch(id, JSON.stringify(req));
  });
}

// ---------- společné rozhraní ----------

// request(url, { method, headers, body, type: 'text' | 'json', timeout }) → { status, text, json, url }
export async function request(url, opts = {}) {
  const { method = 'GET', headers = {}, body = null, type = 'text', timeout = 20000 } = opts;
  const u = new URL(url);
  let res;
  if (isAndroid()) {
    res = await androidFetch({ url, method, headers, body }, timeout);
  } else {
    const direct = CORS_OK.has(u.hostname) && (!CORS_OK_PATH[u.hostname] || CORS_OK_PATH[u.hostname].test(u.pathname));
    let target = url;
    const init = { method, headers: { ...headers }, body };
    if (!direct) {
      const proxy = (getPrefs().proxyUrl || '').trim().replace(/\/+$/, '');
      if (!proxy) throw new NetError('Tenhle zdroj na počítači potřebuje prostředníka (Nastavení → Hledání textů).', 'proxy');
      target = `${proxy}/?url=${encodeURIComponent(url)}`;
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    try {
      const r = await fetch(target, { ...init, signal: ctrl.signal });
      res = { status: r.status, text: await r.text(), url: r.headers.get('x-final-url') || url };
    } catch (e) {
      throw new NetError(e.name === 'AbortError' ? 'Vypršel čas.' : navigator.onLine ? 'Web neodpovídá.' : 'Jsi offline.', e.name === 'AbortError' ? 'timeout' : 'offline');
    } finally { clearTimeout(timer); }
  }
  if (res.status === 403 || res.status === 429 || res.status === 503) throw new NetError(`Web nás nepustil (${res.status}).`, 'blocked', res.status);
  if (res.status === 404) throw new NetError('Nenalezeno (404).', 'notfound', 404);
  if (res.status >= 400 || res.status === 0) throw new NetError(`Chyba ${res.status}.`, 'error', res.status);
  if (type === 'json') {
    try { res.json = JSON.parse(res.text); } catch { throw new NetError('Web vrátil nečekanou odpověď.', 'error'); }
  }
  return res;
}

export const getJson = (url, opts = {}) => request(url, { ...opts, type: 'json' }).then(r => r.json);
export const getText = (url, opts = {}) => request(url, opts).then(r => r.text);
export const getHtml = async (url, opts = {}) => {
  const r = await request(url, opts);
  const doc = new DOMParser().parseFromString(r.text, 'text/html');
  return { doc, url: r.url || url, text: r.text };
};
