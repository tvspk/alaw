// Synchronizace mezi zařízeními přes soukromý repozitář GitHubu (vzor: tvspk/gorsaf, tvspk/memochat).
//
// Schránka = SOUKROMÝ repozitář (výchozí <účet>/alaw-sync). V main jen alaw-sync.json = {app, sync:1, created, check};
// check ověřuje párovací kód. Každé zařízení má vlastní větev al-<12 hex> s commitem bez rodičů (force push, historie neroste):
//   state           = [IV 12 B][AES-256-GCM(gzip(JSON))], AAD 'state'
//   a/<klíč>/<i>    = kousky zvukového souboru (≤ 8 MiB), [IV][AES-256-GCM(data)], AAD = cesta
// JSON stavu: { app:'Alaw', v:1, songs:[…], tombs:{id: čas smazání}, files:{klíč zvuku: [sha kousků]}, prog:[…] }
//   prog = pokrok učení po verších (learn.js), přidáno ve 0.4 bez zvýšení v: starší verze ho ignorují a nepřepíšou.
// Klíč: HKDF-SHA-256 z 8 slov párovacího kódu (salt 'Alaw sync v1', info 'state').
//
// Slučování (rozhodnuto se zadavatelem): píseň = položka, NOVĚJŠÍ ÚPRAVA VYHRÁVÁ (updatedAt podle hodin GitHubu,
// vždy vyšší než předchozí verze, při shodě vyhraje „větší“ JSON, aby všechna zařízení skončila stejně).
// Smazání = náhrobek (tombs), vyhrává nad úpravami staršími než smazání. Zvuk se stahuje HNED CELÝ a nezmenšuje se.
// Pokrok učení: každý verš zvlášť, NAPOSLEDY ZMĚNĚNÝ ZÁZNAM VYHRÁVÁ (t podle hodin GitHubu); vynulování = nový záznam,
// takže náhrobky nepotřebuje. Pokrok smazané písně se zahodí.
// Nesynchronizuje se: nastavení zařízení (alaw-prefs), klíč Gemini (alaw-ai), adresa prostředníka.
// Token a 8 slov jsou jen v localStorage 'alaw-sync' tohoto zařízení, nikdy v záloze.
import { db } from './db.js';
import { normalizeSong } from './model.js';
import { normalizeRec, recWins } from './learn.js';
import { WORDS } from './bip39.js';

const CFG_KEY = 'alaw-sync', API = 'https://api.github.com', META = 'alaw-sync.json', APP = 'Alaw', DEFREPO = 'alaw-sync';
const RE_REPO = /^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/, RE_BR = /^al-[a-f0-9]{12}$/, RE_SHA = /^[a-f0-9]{40}$/, RE_KEY = /^[a-f0-9]{8,40}$/;
const PART = () => window.__alawSyncPart || 8 * 1024 * 1024; // velikost kousku zvuku (GitHub bere bloby do 100 MB)
const POLL = 60000, SOON = 15000, BACK = 20000, ERRWAIT = 5 * 60000, RETRY = 30 * 60000;
const HARD = ['token', 'notfound', 'forbidden', 'public', 'meta'];

export class SyncError extends Error { constructor(kind, status = 0) { super(kind); this.kind = kind; this.status = status; } }

export const ERR = {
  offline: 'Bez internetu. Zkusím to později znovu.',
  token: 'Token je neplatný nebo mu vypršela platnost. Vlož nový.',
  notfound: 'Repozitář nejde otevřít. Zkontroluj jeho název a oprávnění tokenu.',
  forbidden: 'Repozitář nejde otevřít. Zkontroluj jeho název a oprávnění tokenu.',
  public: 'Tenhle repozitář je veřejný. Pro synchronizaci musí být soukromý.',
  empty: 'Repozitář je prázdný. Přidej do něj na GitHubu soubor README.',
  meta: 'Ve schránce jsou data jiné aplikace.',
  damaged: 'Data z jiného zařízení nešla přečíst (jiný párovací kód?). Zbytek se synchronizoval.',
  other: 'Synchronizace se nepovedla. Zkusím to později.',
};
export const errText = k => !k ? '' : k.startsWith('http:') ? `GitHub požadavek odmítl (${k.slice(5)}). Zkusím to později.` : ERR[k] || ERR.other;

// ---------- nastavení synchronizace v zařízení ----------
let cfg = load(), key = null, busy = false, again = false, soonT = null, progress = '';
const listeners = new Set();
export const onStatus = fn => { listeners.add(fn); return () => listeners.delete(fn); };
const emit = () => listeners.forEach(fn => { try { fn(); } catch { /* nic */ } });

function load() {
  try {
    const c = JSON.parse(localStorage.getItem(CFG_KEY));
    if (c && RE_REPO.test(c.repo || '') && RE_BR.test(c.branch || '') && typeof c.token === 'string' && typeof c.code === 'string') {
      for (const k of ['seen', 'files', 'remote']) if (!c[k] || typeof c[k] !== 'object' || Array.isArray(c[k])) c[k] = {};
      return c;
    }
  } catch { /* nic */ }
  return null;
}
function save() { try { if (cfg) localStorage.setItem(CFG_KEY, JSON.stringify(cfg)); else localStorage.removeItem(CFG_KEY); } catch { /* nic */ } }

export const isOn = () => !!(cfg && key);
export const status = () => ({ on: !!cfg, busy, progress, lastSync: cfg?.lastSync || 0, lastError: cfg?.lastError || null, devices: cfg ? Object.keys(cfg.seen).length + 1 : 0, repo: cfg?.repo || '' });
export const pairingCode = () => cfg?.code || '';

// Čas změny podle hodin GitHubu (rozjeté hodiny zařízení nevadí); vždy vyšší než předchozí verze položky.
export function stamp(prev = 0) {
  let skew = 0;
  try { skew = (JSON.parse(localStorage.getItem(CFG_KEY)) || {}).skew || 0; } catch { /* nic */ }
  return Math.max(Math.round(Date.now() - skew), (prev || 0) + 1);
}

// ---------- šifrování ----------
const enc = s => new TextEncoder().encode(s);
async function derive(code) {
  const ikm = await crypto.subtle.importKey('raw', enc(code), 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: enc('Alaw sync v1'), info: enc('state') }, ikm, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
async function seal(k, name, u8) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc(name) }, k, u8));
  const o = new Uint8Array(12 + ct.length); o.set(iv); o.set(ct, 12); return o;
}
async function open(k, name, u8) {
  if (!(u8 instanceof Uint8Array) || u8.length < 28) throw new Error('short');
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: u8.slice(0, 12), additionalData: enc(name) }, k, u8.subarray(12)));
}
async function zip(u8, on) {
  const s = new Blob([u8]).stream().pipeThrough(on ? new CompressionStream('gzip') : new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(s).arrayBuffer());
}
function b64(u8) { let s = ''; for (let i = 0; i < u8.length; i += 32768) s += String.fromCharCode.apply(null, u8.subarray(i, i + 32768)); return btoa(s); }
function unb64(s) { const b = atob(s), u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; }
const hash = s => { let x = 2166136261; for (let i = 0; i < s.length; i++) x = Math.imul(x ^ s.charCodeAt(i), 16777619); return (x >>> 0).toString(36) + '.' + s.length; };

// ---------- párovací kód: 8 slov BIP39, stačí první 4 písmena ----------
export const newCode = () => [...crypto.getRandomValues(new Uint16Array(8))].map(x => WORDS[x & 2047]).join(' ');
export function parseCode(s) {
  const ws = String(s || '').toLowerCase().replace(/[^a-z]+/g, ' ').trim().split(' ').filter(Boolean);
  if (ws.length !== 8) return null;
  const out = [];
  for (const w of ws) {
    const m = WORDS.includes(w) ? w : w.length >= 4 ? WORDS.find(x => x.startsWith(w.slice(0, 4))) : null;
    if (!m) return null;
    out.push(m);
  }
  return out.join(' ');
}
export const QR_PREFIX = 'ALAW:';
export const qrText = code => QR_PREFIX + code.toUpperCase();
export const codeFromQr = t => { const s = String(t || '').trim(); return s.slice(0, QR_PREFIX.length).toUpperCase() === QR_PREFIX ? parseCode(s.slice(QR_PREFIX.length)) : null; };
const CHECK = 'Alaw sync check';
const checkBlob = async k => b64(await seal(k, 'check', enc(CHECK)));
const checkOk = async (k, c) => { try { return new TextDecoder().decode(await open(k, 'check', unb64(c))) === CHECK; } catch { return false; } };

// ---------- GitHub ----------
async function gh(token, method, path, body, raw) {
  let r;
  try {
    r = await fetch(API + path, {
      method, cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer',
      headers: { Authorization: 'Bearer ' + token, Accept: raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch { throw new SyncError('offline'); }
  if (r.status === 401) throw new SyncError('token', 401);
  if (!r.ok) throw new SyncError(r.status === 404 ? 'notfound' : r.status === 403 ? 'forbidden' : r.status === 409 ? 'empty' : 'http', r.status);
  if (raw) return new Uint8Array(await r.arrayBuffer());
  if (r.status === 204) return null;
  try { return await r.json(); } catch { throw new SyncError('http', r.status); }
}

async function checkRepo(token, input) {
  let repo = String(input || '').trim().replace(/^https:\/\/github\.com\//, '').replace(/\.git$/, '').replace(/\/+$/, '');
  if (!repo.includes('/')) {
    const u = await gh(token, 'GET', '/user');
    if (!u || typeof u.login !== 'string') throw new SyncError('http');
    repo = `${u.login}/${repo || DEFREPO}`;
  }
  if (!RE_REPO.test(repo)) throw new SyncError('notfound');
  const info = await gh(token, 'GET', '/repos/' + repo);
  if (!info || info.private !== true) throw new SyncError('public');
  return info.full_name && RE_REPO.test(info.full_name) ? info.full_name : repo;
}
async function readMeta(token, repo) {
  let r;
  try { r = await gh(token, 'GET', `/repos/${repo}/contents/${META}`); } catch (e) { if (e.kind === 'notfound') return null; throw e; }
  try {
    const m = JSON.parse(new TextDecoder().decode(unb64(String(r.content || '').replace(/\s+/g, ''))));
    if (m && m.app === APP && m.sync === 1 && typeof m.check === 'string') return m;
  } catch { /* nic */ }
  throw new SyncError('meta');
}

// ---------- nastavení (průvodce v Nastavení volá tyto kroky) ----------
const pend = {};
// 1) token + repozitář → { needCode: true } (schránka existuje, zadat kód) nebo { code } (nový kód k zapsání)
export async function setupConnect(token, repoInput) {
  for (const k in pend) delete pend[k];
  token = String(token || '').trim();
  if (!/^[A-Za-z0-9_]{20,255}$/.test(token)) throw new SyncError('token');
  const repo = await checkRepo(token, repoInput);
  const meta = await readMeta(token, repo);
  Object.assign(pend, { token, repo, meta });
  if (meta) return { needCode: true, repo };
  pend.code = newCode();
  return { code: pend.code, repo };
}
// 2a) první zařízení: „Mám je zapsaná“ → založí schránku. Když ji mezitím založilo jiné zařízení, vrátí { needCode: true }.
export async function setupCreate() {
  const k = await derive(pend.code);
  const content = b64(enc(JSON.stringify({ app: APP, sync: 1, created: new Date().toISOString(), check: await checkBlob(k) }, null, 1)));
  try { await gh(pend.token, 'PUT', `/repos/${pend.repo}/contents/${META}`, { message: 'Alaw sync', content }); }
  catch (x) {
    const m = await readMeta(pend.token, pend.repo).catch(() => null);
    if (!m) throw x;
    pend.meta = m; delete pend.code;
    return { needCode: true };
  }
  return start(k);
}
// 2b) další zařízení: kód z prvního zařízení
export async function setupJoin(codeInput) {
  const code = parseCode(codeInput);
  if (!code) return { bad: true };
  const k = await derive(code);
  if (!await checkOk(k, pend.meta.check)) return { bad: true };
  pend.code = code;
  return start(k);
}
async function start(k) {
  const branch = 'al-' + [...crypto.getRandomValues(new Uint8Array(6))].map(b => b.toString(16).padStart(2, '0')).join('');
  cfg = { repo: pend.repo, branch, token: pend.token, code: pend.code, seen: {}, files: {}, remote: {}, lastSync: 0, lastAttempt: 0, lastError: null, skew: 0 };
  key = k;
  save();
  for (const x in pend) delete pend[x];
  emit();
  const ok = await syncNow(true);
  return { ok };
}
export async function newToken(token) {
  token = String(token || '').trim();
  if (!cfg || !/^[A-Za-z0-9_]{20,255}$/.test(token)) throw new SyncError('token');
  const repo = await checkRepo(token, cfg.repo), m = await readMeta(token, repo);
  if (!m || !await checkOk(key, m.check)) throw new SyncError('meta');
  cfg.token = token; cfg.lastError = null; cfg.lastAttempt = 0; save(); emit();
  syncNow(false);
}
export function turnOff() { clearTimeout(soonT); cfg = null; key = null; save(); emit(); }

// ---------- jedna synchronizace ----------
const tombsGet = async () => (await db.getMeta('tombs')) || {};

// Zaznamená smazání písně (volá store.deleteSong).
export async function recordDelete(id) {
  const t = await tombsGet();
  t[id] = stamp(t[id]);
  await db.putMeta('tombs', t);
}

function audioKeys(songs) {
  const keys = new Map();
  for (const s of songs) for (const v of s.versions) if (v.audio && RE_KEY.test(v.audio.key)) keys.set(v.audio.key, v.audio);
  return keys;
}

// quick = při odchodu z aplikace: jen nahrát vlastní stav, nic nestahovat (co nejméně požadavků, než Android aplikaci uspí)
export async function syncNow(manual = false, quick = false) {
  if (!isOn()) return false;
  if (busy) { if (quick) again = true; return false; }
  busy = true; again = false;
  const c = cfg, P = '/repos/' + c.repo;
  c.lastAttempt = Date.now(); save(); setProgress('Synchronizuji…');
  let ok = false, damaged = false;
  const changed = new Set();
  try {
    // 1) větve ostatních zařízení
    const short = quick && !manual && !!c.upHash;
    const refs = short ? [] : await gh(c.token, 'GET', `${P}/git/matching-refs/heads/al-`);
    let own = short ? 'kept' : null;
    const present = new Set(), fresh = [];
    for (const ref of Array.isArray(refs) ? refs : []) {
      const br = String(ref.ref || '').replace(/^refs\/heads\//, ''), cs = ref.object && ref.object.sha;
      if (!RE_BR.test(br) || !RE_SHA.test(cs || '')) continue;
      if (br === c.branch) { own = cs; continue; }
      present.add(br);
      if (quick || (!manual && c.seen[br] === cs)) continue;
      try {
        const cm = await gh(c.token, 'GET', `${P}/git/commits/${cs}`), ts = cm && cm.tree && cm.tree.sha;
        if (!RE_SHA.test(ts || '')) throw new SyncError('http');
        const tr = await gh(c.token, 'GET', `${P}/git/trees/${ts}`);
        const e = (Array.isArray(tr.tree) ? tr.tree : []).find(x => x.path === 'state' && x.type === 'blob' && RE_SHA.test(x.sha || ''));
        if (!e) continue;
        const d = JSON.parse(new TextDecoder().decode(await zip(await open(key, 'state', await gh(c.token, 'GET', `${P}/git/blobs/${e.sha}`, null, true)), false)));
        if (!d || d.app !== APP || d.v !== 1 || !Array.isArray(d.songs)) throw new Error('shape');
        fresh.push({ br, cs, d });
      } catch (e) { if (e instanceof SyncError) throw e; console.warn('sync: nečitelná data', br, e); damaged = true; }
    }
    if (c !== cfg) return false;

    // 2) sloučení: novější úprava vyhrává, náhrobky mažou starší úpravy
    const tombs = await tombsGet();
    for (const { d } of fresh) {
      if (d.tombs && typeof d.tombs === 'object') for (const [id, t] of Object.entries(d.tombs)) if (typeof id === 'string' && id.length <= 40 && +t > 0 && +t > (tombs[id] || 0)) tombs[id] = +t;
      if (d.files && typeof d.files === 'object') for (const [k, shas] of Object.entries(d.files)) {
        if (RE_KEY.test(k) && Array.isArray(shas) && shas.length && shas.length < 200 && shas.every(s => RE_SHA.test(s))) c.remote[k] = shas.slice();
      }
    }
    const local = new Map((await db.allSongs()).map(s => [s.id, s]));
    for (const { d } of fresh) {
      for (const raw of d.songs) {
        const s = normalizeSong(raw);
        if (!s) continue;
        if (tombs[s.id] && tombs[s.id] >= s.updatedAt) continue;
        const l = local.get(s.id);
        const win = !l || s.updatedAt > l.updatedAt || (s.updatedAt === l.updatedAt && JSON.stringify(s) > JSON.stringify(l));
        if (win) { await db.putSong(s); local.set(s.id, s); changed.add(s.id); }
      }
    }
    for (const [id, t] of Object.entries(tombs)) {
      const l = local.get(id);
      if (l && l.updatedAt <= t) { await db.deleteSong(id); local.delete(id); changed.add(id); }
    }
    await db.putMeta('tombs', tombs);

    // pokrok učení: po záznamech, naposledy změněný vyhrává
    const prog = new Map((await db.allProgress()).map(r => [r.id, r]));
    const take = new Map();
    for (const { d } of fresh) {
      if (!Array.isArray(d.prog)) continue;
      for (const raw of d.prog) {
        const r = normalizeRec(raw);
        if (!r || !local.has(r.s)) continue;
        if (recWins(r, take.get(r.id) || prog.get(r.id))) take.set(r.id, r);
      }
    }
    if (take.size) {
      await db.putProgressMany([...take.values()]);
      for (const r of take.values()) { prog.set(r.id, r); changed.add(r.s); }
    }
    for (const { br, cs } of fresh) c.seen[br] = cs;
    if (!short) for (const br in c.seen) if (!present.has(br)) delete c.seen[br];
    save();

    // 3) zvuk: chybějící soubory stáhnout hned celé, nepoužívané v zařízení smazat
    const songs = [...local.values()];
    const needed = audioKeys(songs);
    const have = new Set(await db.audioKeys());
    if (!quick) {
      let i = 0;
      for (const [k, meta] of needed) {
        if (have.has(k) || !c.remote[k]) continue;
        i++;
        const shas = c.remote[k], parts = [];
        for (let j = 0; j < shas.length; j++) {
          setProgress(`Stahuji nahrávku „${meta.name || k}“${shas.length > 1 ? ` (${j + 1}/${shas.length})` : ''}…`);
          parts.push(await open(key, `a/${k}/${j}`, await gh(c.token, 'GET', `${P}/git/blobs/${shas[j]}`, null, true)));
        }
        await db.putAudio(k, new Blob(parts, { type: meta.type || 'audio/mpeg' }));
        have.add(k);
        changed.add(k);
      }
      for (const k of have) if (!needed.has(k)) await db.deleteAudio(k);
    }

    // 4) vlastní stav: nahrát jen při změně
    const files = {};
    for (const [k] of needed) {
      if (c.files[k]) { files[k] = c.files[k]; continue; }
      if (c.remote[k]) { files[k] = c.remote[k]; continue; }   // už je ve schránce od jiného zařízení
      if (!have.has(k) || quick) continue;                     // nahraje se při příští úplné synchronizaci
      const blob = await db.getAudio(k);
      if (!blob) continue;
      const n = Math.max(1, Math.ceil(blob.size / PART())), shas = [];
      for (let j = 0; j < n; j++) {
        setProgress(`Nahrávám nahrávku „${needed.get(k).name || k}“${n > 1 ? ` (${j + 1}/${n})` : ''}…`);
        const part = new Uint8Array(await blob.slice(j * PART(), (j + 1) * PART()).arrayBuffer());
        const r = await gh(c.token, 'POST', `${P}/git/blobs`, { content: b64(await seal(key, `a/${k}/${j}`, part)), encoding: 'base64' });
        shas.push(r.sha);
      }
      files[k] = shas; c.files[k] = shas; save();   // zapamatovat, ať se po přerušení nenahrává znovu
    }
    for (const k of Object.keys(c.files)) if (!needed.has(k)) delete c.files[k];
    const live = Object.fromEntries(Object.entries(tombs).filter(([, t]) => Date.now() - t < 400 * 86400e3));
    const progOut = [...prog.values()].filter(r => r.t > 0 && local.has(r.s)).sort((a, b) => (a.id < b.id ? -1 : 1));
    const body = JSON.stringify({ app: APP, v: 1, songs: songs.sort((a, b) => (a.id < b.id ? -1 : 1)), tombs: live, files, prog: progOut });
    const hs = hash(body);
    if (hs !== c.upHash || !own) {
      setProgress('Nahrávám změny…');
      const blob = await gh(c.token, 'POST', `${P}/git/blobs`, { content: b64(await seal(key, 'state', await zip(enc(body), true))), encoding: 'base64' });
      const tree = [{ path: 'state', mode: '100644', type: 'blob', sha: blob.sha }];
      for (const [k, shas] of Object.entries(files)) shas.forEach((sha, j) => tree.push({ path: `a/${k}/${j}`, mode: '100644', type: 'blob', sha }));
      const tr = await gh(c.token, 'POST', `${P}/git/trees`, { tree });
      const t0 = Date.now();
      const cm = await gh(c.token, 'POST', `${P}/git/commits`, { message: 'Alaw sync', tree: tr.sha, parents: [] });
      const sd = Date.parse(((cm && cm.committer) || {}).date || '');
      if (isFinite(sd)) c.skew = Math.round((t0 + Date.now()) / 2 - sd);
      if (own && own !== 'kept') await gh(c.token, 'PATCH', `${P}/git/refs/heads/${c.branch}`, { sha: cm.sha, force: true });
      else if (own === 'kept') {
        try { await gh(c.token, 'PATCH', `${P}/git/refs/heads/${c.branch}`, { sha: cm.sha, force: true }); }
        catch (e) { if (e.kind !== 'notfound' && e.status !== 422) throw e; await gh(c.token, 'POST', `${P}/git/refs`, { ref: 'refs/heads/' + c.branch, sha: cm.sha }); }
      } else await gh(c.token, 'POST', `${P}/git/refs`, { ref: 'refs/heads/' + c.branch, sha: cm.sha });
      c.upHash = hs;
    }
    c.lastSync = Date.now();
    c.lastError = damaged ? 'damaged' : null;
    ok = true;
  } catch (e) {
    console.warn('sync', e);
    c.lastError = e instanceof SyncError ? (e.kind === 'http' && e.status ? 'http:' + e.status : e.kind) : 'other';
  } finally {
    busy = false;
    if (cfg === c) save();
    setProgress('');
    if (again) { again = false; if (document.hidden) setTimeout(() => syncNow(false, true), 0); }
  }
  if (changed.size) window.dispatchEvent(new CustomEvent('alaw-synced', { detail: { changed: [...changed] } }));
  return ok;
}

function setProgress(s) { progress = s; emit(); }

// ---------- kdy synchronizovat ----------
function maybe(gap) {
  if (!isOn() || busy || navigator.onLine === false) return;
  const e = cfg.lastError;
  const wait = HARD.includes(e) ? RETRY : e && e !== 'damaged' ? Math.max(gap, ERRWAIT) : gap;
  if (Date.now() - (cfg.lastAttempt || 0) >= wait) syncNow(false);
}
// po změně (uložení písně): za 15 s, dávka změn = jedno nahrání
export function changed() {
  if (!isOn()) return;
  if (soonT) return;
  soonT = setTimeout(() => { soonT = null; if (busy) changed(); else maybe(0); }, SOON);
}
function leave() {
  if (!isOn() || navigator.onLine === false) return;
  const e = cfg.lastError;
  if (HARD.includes(e) && Date.now() - (cfg.lastAttempt || 0) < RETRY) return;
  clearTimeout(soonT); soonT = null;
  syncNow(false, true);
}

export async function boot() {
  if (!cfg) return;
  try { key = await derive(cfg.code); } catch (e) { console.warn('sync key', e); return; }
  emit();
  setTimeout(() => maybe(0), 1500);
}
document.addEventListener('visibilitychange', () => {
  if (!isOn()) return;
  if (document.hidden) leave(); else setTimeout(() => maybe(BACK), 300);
});
window.addEventListener('online', () => setTimeout(() => maybe(0), 2000));
setInterval(() => { if (!document.hidden) maybe(POLL); }, 10000);
