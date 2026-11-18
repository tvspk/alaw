// Test prostředníka (worker/worker.js) bez sítě: fetch je napodobený. Spuštění: node testy/test_worker.mjs
import assert from 'node:assert/strict';
import worker from '../worker/worker.js';

const calls = [];
globalThis.fetch = async (url, init) => {
  calls.push({ url, init });
  if (url.includes('binary')) return new Response(new Uint8Array(10), { headers: { 'Content-Type': 'image/png' } });
  return new Response('<p>ahoj</p>', { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
};

const ORIGIN = 'https://tvspk.github.io';
const req = (u, { method = 'GET', origin = ORIGIN, body } = {}) =>
  new Request(`https://alaw-proxy.example.workers.dev/?url=${encodeURIComponent(u)}`, { method, headers: { Origin: origin, 'Content-Type': 'application/json' }, body });

let r = await worker.fetch(req('https://lyricstranslate.com/en/x.html'));
assert.equal(r.status, 200);
assert.equal(await r.text(), '<p>ahoj</p>');
assert.equal(r.headers.get('Access-Control-Allow-Origin'), ORIGIN);
assert.equal(calls.at(-1).init.headers['User-Agent'].startsWith('AlawLyrics'), true);
console.log('✓ GET z aplikace projde, má CORS a vlastní User-Agent');

r = await worker.fetch(req('https://lyricstranslate.com/', { origin: 'https://evil.example' }));
assert.equal(r.status, 403);
console.log('✓ cizí Origin odmítnut');

r = await worker.fetch(req('http://example.com/'));
assert.equal(r.status, 400);
console.log('✓ jen https');

r = await worker.fetch(req('https://genius.com/', { method: 'POST', body: '{}' }));
assert.equal(r.status, 403);
r = await worker.fetch(req('https://bandcamp.com/api/bcsearch_public_api/1/autocomplete_elastic', { method: 'POST', body: '{"search_text":"x"}' }));
assert.equal(r.status, 200);
assert.equal(calls.at(-1).init.body, '{"search_text":"x"}');
console.log('✓ POST jen na hledání Bandcampu, tělo se předá');

r = await worker.fetch(req('https://example.com/binary.png'));
assert.equal(r.status, 415);
console.log('✓ jen textové odpovědi');

r = await worker.fetch(new Request('https://alaw-proxy.example.workers.dev/?url=x', { method: 'OPTIONS', headers: { Origin: 'http://localhost:8000' } }));
assert.equal(r.status, 204);
assert.equal(r.headers.get('Access-Control-Allow-Origin'), 'http://localhost:8000');
console.log('✓ předběžný dotaz (OPTIONS) z localhostu');
console.log('Prostředník: všechny testy prošly.');
