// Alaw – prostředník pro hledání textů z prohlížeče na počítači (Cloudflare Workers, zdarma).
// Webová aplikace se nesmí sama ptát cizích webů (CORS), tak se ptá přes tohle: /?url=<adresa stránky>
// Pravidla: jen požadavky z aplikace Alaw (Origin), jen https, GET (POST jen na hledání Bandcampu), jen texty, max. 4 MB.
// Nasazení: Cloudflare → Workers & Pages → Create → Worker → vložit tento soubor → Deploy.

const ALLOWED_ORIGINS = [/^https:\/\/tvspk\.github\.io$/, /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/];
const POST_ALLOWED = ['https://bandcamp.com/api/bcsearch_public_api/1/autocomplete_elastic'];
const MAX_BYTES = 4 * 1024 * 1024;
const UA = 'AlawLyrics/0.2 (+https://github.com/tvspk/alaw)';

function cors(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Api-User-Agent',
    'Access-Control-Expose-Headers': 'X-Final-Url',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function fail(status, message, origin) {
  return new Response(message, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', ...(origin ? cors(origin) : {}) } });
}

export default {
  async fetch(request) {
    const origin = request.headers.get('Origin') || '';
    if (!ALLOWED_ORIGINS.some(re => re.test(origin))) return fail(403, 'Jen pro aplikaci Alaw.');
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin) });
    if (request.method !== 'GET' && request.method !== 'POST') return fail(405, 'Nepovolená metoda.', origin);

    const target = new URL(request.url).searchParams.get('url');
    let url;
    try { url = new URL(target); } catch { return fail(400, 'Chybí nebo je neplatný parametr url.', origin); }
    if (url.protocol !== 'https:') return fail(400, 'Jen https.', origin);
    if (request.method === 'POST' && !POST_ALLOWED.includes(url.origin + url.pathname)) return fail(403, 'POST jen pro hledání na Bandcampu.', origin);

    const init = {
      method: request.method,
      headers: { 'User-Agent': UA, Accept: 'text/html,application/json;q=0.9,*/*;q=0.5', 'Accept-Language': 'cy,en;q=0.8' },
      redirect: 'follow',
    };
    if (request.method === 'POST') {
      init.headers['Content-Type'] = request.headers.get('Content-Type') || 'application/json';
      init.body = await request.text();
      if (init.body.length > 10000) return fail(413, 'Příliš velký dotaz.', origin);
    }

    let res;
    try { res = await fetch(url.href, init); } catch (e) { return fail(502, `Web neodpovídá: ${e.message}`, origin); }
    const type = res.headers.get('Content-Type') || '';
    if (type && !/text\/|json|xml/i.test(type)) return fail(415, 'Jen textové stránky.', origin);
    const len = +res.headers.get('Content-Length') || 0;
    if (len > MAX_BYTES) return fail(413, 'Stránka je příliš velká.', origin);
    const body = await res.arrayBuffer();
    if (body.byteLength > MAX_BYTES) return fail(413, 'Stránka je příliš velká.', origin);

    return new Response(body, {
      status: res.status,
      headers: { 'Content-Type': type || 'text/plain; charset=utf-8', 'X-Final-Url': res.url || url.href, 'Cache-Control': 'no-store', ...cors(origin) },
    });
  },
};
