// Přepis zpěvu z nahrávky: služby Gemini (ai.js) a Whisper přes Groq (zdarma bez karty, klíč „gsk_…“).
// Klíč Groq je jen v tomto zařízení (localStorage 'alaw-groq'), nezálohuje se a nesynchronizuje.
import { hasAi, transcribeAudio, cleanTranscript } from './ai.js';
import { t } from './i18n.js';
import { toSpeechWav } from './audioprep.js';
import { getPrefs } from './store.js';
import { isAndroid } from './net.js';

const GROQ = 'https://api.groq.com/openai/v1';
const GROQ_KEY = 'alaw-groq';
const GROQ_MAX = () => window.__alawGroqMax || 24 * 1048576; // bezplatný tarif bere soubory do 25 MB
const WHISPER_LANGS = new Set(['cy', 'en', 'br', 'cs']);    // jazyky aplikace, které Whisper zná

export const groqKey = () => { try { return localStorage.getItem(GROQ_KEY) || ''; } catch { return ''; } };
export function setGroqKey(k) { try { k ? localStorage.setItem(GROQ_KEY, k) : localStorage.removeItem(GROQ_KEY); } catch { /* nic */ } }
export const hasGroq = () => !!groqKey();

class SttError extends Error {}

async function groqFetch(path, opts, key, timeout = 180000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  let r;
  try { r = await fetch(`${GROQ}/${path}`, { ...opts, headers: { ...(opts.headers || {}), Authorization: `Bearer ${key}` }, signal: ctrl.signal }); }
  catch (e) { throw new SttError(e.name === 'AbortError' ? t('Groq neodpověděl včas.') : navigator.onLine ? t('Groq neodpovídá.') : t('Jsi offline.')); }
  finally { clearTimeout(timer); }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = data.error?.message || '';
    if (r.status === 401) throw new SttError(t('Klíč pro Groq není platný. Zkopíruj ho z console.groq.com znovu celý (začíná „gsk_“).'));
    if (r.status === 413) throw new SttError(t('Nahrávka je pro Groq moc velká (limit 25 MB).'));
    if (r.status === 429) throw Object.assign(new SttError(t('Groq hlásí vyčerpaný limit bezplatného tarifu. Zkus to za chvíli (nebo zítra).')), { limit: true });
    throw Object.assign(new SttError(t('Chyba Groq {s}', { s: r.status }) + (msg ? `: ${msg.slice(0, 160)}` : '')), { status: r.status, msg });
  }
  return data;
}

// Ověří klíč (seznam modelů).
export async function checkGroq(key) {
  const d = await groqFetch('models', { method: 'GET' }, key, 20000);
  const ids = (d.data || []).map(m => m.id);
  if (!ids.some(id => /^whisper/.test(id))) throw new SttError(t('Klíč funguje, ale Groq nenabízí model Whisper.'));
  return ids;
}

// Úseky Whisperu → verše. Vynechá hudbu bez zpěvu a „halucinace“ (opakování, nejistý text bez řeči).
export function whisperLines(segments) {
  const segs = (Array.isArray(segments) ? segments : []).filter(s => s && typeof s.text === 'string')
    .filter(s => !(s.no_speech_prob > 0.6 && s.avg_logprob < -0.7) && !(s.compression_ratio > 2.6))
    .filter(s => !/^[\s♪♫♬*().,…\-[\]]*$/.test(s.text) && !/^\s*[([].*[)\]]\s*$/.test(s.text));
  let prevEnd = null;
  return cleanTranscript(segs.map(s => {
    const line = { start: +s.start, text: s.text.replace(/[♪♫♬]/g, ''), new_stanza: prevEnd != null && +s.start - prevEnd > 3.5 };
    prevEnd = +s.end;
    return line;
  }));
}

export async function transcribeGroq(blob, { title = '', language = 'cy', name = '' } = {}, onWait = () => {}) {
  const key = groqKey();
  if (!key) throw new SttError(t('Nejdřív vlož klíč pro Groq v Nastavení → Přepis z nahrávky.'));
  let file = blob, fname = /\.\w+$/.test(name) ? name : 'nahravka.mp3';
  if (blob.size > GROQ_MAX()) {
    onWait(t('Připravuji menší kopii nahrávky pro přepis…'));
    file = await toSpeechWav(blob);
    fname = 'nahravka.wav';
    if (file.size > GROQ_MAX()) throw new SttError(t('Nahrávka je na přepis přes Groq moc dlouhá (víc než ~12 minut).'));
  }
  onWait(t('Přepisuji přes Groq (Whisper)…'));
  const send = model => {
    const fd = new FormData();
    fd.append('file', file, fname.replace(/[^\w.-]+/g, '_'));
    fd.append('model', model);
    fd.append('response_format', 'verbose_json');
    fd.append('temperature', '0');
    if (WHISPER_LANGS.has(language)) fd.append('language', language);
    if (title) fd.append('prompt', title.slice(0, 200)); // pravopis názvu a jmen
    return groqFetch('audio/transcriptions', { method: 'POST', body: fd }, key);
  };
  let data;
  try { data = await send('whisper-large-v3'); }
  catch (e) { if (e.status === 404 || (e.status === 400 && /model/i.test(e.msg || ''))) data = await send('whisper-large-v3-turbo'); else throw e; }
  return whisperLines(data.segments);
}

// ---------- Bangor: velšský Whisper na tomto počítači (program bangor/alaw_bangor.py) ----------
// Jen na počítači (v APK ne). Zapíná se v Nastavení po úspěšném ověření (prefs.bangor = true).
export const BANGOR = 'http://127.0.0.1:8765';
const BANGOR_ZIP = 'https://github.com/tvspk/alaw/releases/latest/download/alaw-bangor.zip';
export const bangorZip = () => BANGOR_ZIP;
export const bangorPossible = () => !isAndroid();
export const hasBangor = () => bangorPossible() && !!getPrefs().bangor;
const BANGOR_LANGS = new Set(['cy', 'en']);
const bangorDown = () => Object.assign(new SttError(t('Program pro přepis Bangor na tomto počítači neběží. Spusť alaw-bangor.bat, počkej na „Program běží“ a zkus to znovu.')), { stop: true });

async function bangorFetch(path, opts = {}, timeout = 8000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  let r;
  // targetAddressSpace: Chrome se jednou zeptá na povolení přístupu k aplikacím v tomto zařízení
  try { r = await fetch(BANGOR + path, { ...opts, targetAddressSpace: 'loopback', cache: 'no-store', signal: ctrl.signal }); }
  catch { throw bangorDown(); }
  finally { clearTimeout(timer); }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new SttError(t('Bangor: {e}', { e: data.error || r.status })), { status: r.status });
  return data;
}

// Stav programu: { ready, stage, device, model, busy } (vyhodí chybu, když neběží).
export async function checkBangor() {
  const h = await bangorFetch('/health', {}, 4000);
  if (h.app !== 'alaw-bangor') throw bangorDown();
  return h;
}

const sleep = ms => new Promise(res => setTimeout(res, ms));
const POLL = () => window.__alawBangorPoll || 2000;

// Úloha v programu Bangor → úseky přepisu (s words = i časy jednotlivých slov).
async function bangorJob(blob, { title = '', language = 'cy', name = '' } = {}, onWait = () => {}, words = false) {
  let h = await checkBangor();
  if (words && !h.words) throw Object.assign(new SttError(t('Program Bangor na počítači je starší verze a časy slov neumí. V Nastavení → Bangor stáhni program znovu, rozbal ho přes starý, zavři okno starého programu a spusť alaw-bangor.bat.')), { stop: true });
  while (!h.ready) {
    if (h.stage === 'error') throw new SttError(t('Program Bangor nemohl připravit model: {e}', { e: h.error || '' }));
    onWait(h.stage === 'download' ? t('Program Bangor stahuje model (poprvé asi 1,6 GB)…') : t('Program Bangor načítá model…'));
    await sleep(POLL() * 2);
    h = await checkBangor();
  }
  onWait(t('Posílám nahrávku programu Bangor…'));
  const q = new URLSearchParams({ prompt: title.slice(0, 200), name });
  if (BANGOR_LANGS.has(language)) q.set('language', language);
  if (words) q.set('words', '1');
  const { id } = await bangorFetch(`/transcribe?${q}`, { method: 'POST', body: blob, headers: { 'Content-Type': 'application/octet-stream' } }, 600000);
  let fails = 0;
  for (;;) {
    await sleep(POLL());
    let j;
    try { j = await bangorFetch(`/jobs/${id}`); fails = 0; }
    catch (e) { if (e.status || ++fails >= 5) throw e; continue; }
    if (j.state === 'done') return j.segments || [];
    if (j.state === 'error') throw new SttError(t('Bangor: {e}', { e: j.error || '?' }));
    onWait(j.state === 'queued' ? t('Čekám, až program Bangor dokončí předchozí přepis…')
      : t('Přepisuji přes Bangor ({d})… {p} %', { d: h.device === 'gpu' ? t('grafická karta') : t('procesor'), p: Math.round((j.progress || 0) * 100) }));
  }
}

export async function transcribeBangor(blob, opts = {}, onWait = () => {}) {
  return whisperLines(await bangorJob(blob, opts, onWait));
}

// Časy slov z nahrávky (pro doplnění časů k hotovému textu): [{ w, s, e }] (s, e v ms).
export async function bangorWords(blob, opts = {}, onWait = () => {}) {
  const segs = await bangorJob(blob, opts, onWait, true);
  return segs.filter(g => !(g.no_speech_prob > 0.6 && g.avg_logprob < -0.7) && !(g.compression_ratio > 2.6))
    .flatMap(g => g.words || [])
    .filter(w => w && typeof w.word === 'string' && w.word.trim() && Number.isFinite(+w.start))
    .map(w => ({ w: w.word.trim(), s: Math.round(+w.start * 1000), e: Math.round((Number.isFinite(+w.end) ? +w.end : +w.start) * 1000) }));
}

// ---------- výběr služby ----------
export const ENGINES = {
  gemini: { label: 'Gemini', ok: hasAi, run: transcribeAudio },
  groq: { label: 'Whisper (Groq)', short: 'Whisper', ok: hasGroq, run: transcribeGroq },
  bangor: { get label() { return t('Bangor (na tomto PC)'); }, short: 'Bangor', ok: hasBangor, run: transcribeBangor, local: true },
};
export const engineName = k => ENGINES[k]?.short || ENGINES[k]?.label || k;
export const availableEngines = () => Object.keys(ENGINES).filter(k => ENGINES[k].ok());
export function defaultEngine() {
  const av = availableEngines();
  const p = getPrefs().stt;
  return av.includes(p) ? p : av[0] || null;
}
