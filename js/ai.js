import { t, isEn } from './i18n.js';
import { toSpeechWav } from './audioprep.js';
import { trOf, setTr } from './model.js';

// Gemini: český překlad veršů, doslovný překlad, hovorové zkratky, vysvětlení verše a přepis textu z nahrávky.
// Klíč je uložený jen v tomto zařízení (localStorage 'alaw-ai'), nezálohuje se a nesynchronizuje.
const KEY = 'alaw-ai';
const API = 'https://generativelanguage.googleapis.com/v1beta';

export function aiConfig() {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; }
}
export function setAiConfig(cfg) {
  if (!cfg || !cfg.key) localStorage.removeItem(KEY);
  else localStorage.setItem(KEY, JSON.stringify(cfg));
}
export const hasAi = () => !!aiConfig().key;

class AiError extends Error {}

// Klíč: starší formát „AIza…“ i nový „AQ.…“. Posílá se v hlavičce; kdyby ji Google odmítl (401), zkusí se parametr ?key=.
// Jak dlouho čekat na jednu odpověď (Google při přetížení odpověď někdy jen zdržuje, místo aby vrátil chybu).
const TIMEOUT = () => window.__alawAiTimeout || 45000;

async function call(path, body, key, timeout = TIMEOUT()) {
  let r;
  const send = async viaQuery => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    try {
      return await fetch(`${API}/${path}${viaQuery ? `${path.includes('?') ? '&' : '?'}key=${encodeURIComponent(key)}` : ''}`, {
        method: body ? 'POST' : 'GET',
        headers: viaQuery ? { 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: body ? JSON.stringify(body) : undefined,
        signal: ctrl.signal,
      });
    } finally { clearTimeout(timer); }
  };
  try {
    r = await send(false);
    if (r.status === 401) r = await send(true);
  } catch (e) {
    if (e.name === 'AbortError') throw Object.assign(new AiError(t('Gemini neodpověděl včas (přetížení).')), { retry: 'busy' });
    throw new AiError(navigator.onLine ? t('Gemini neodpovídá.') : t('Jsi offline.'));
  }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = data.error?.message || '';
    if ((r.status === 400 && /API key/i.test(msg)) || r.status === 401) throw new AiError(t('Klíč pro Gemini není platný. Zkopíruj ho z Google AI Studia znovu celý (začíná „AQ.“ nebo „AIza“).'));
    if (r.status === 403) throw new AiError(t('Klíč pro Gemini nemá přístup (zkontroluj ho v Google AI Studiu).'));
    if (r.status === 404) throw Object.assign(new AiError(t('Model Gemini nenalezen. V Nastavení klíč ulož znovu, vybere se aktuální model.')), { retry: 'model' });
    // přetížení: Google ho hlásí různými kódy (5xx, někdy i 4xx) se zprávou „high demand / overloaded / try again“
    if (r.status >= 500 || /high demand|overload|unavailable|try again|capacity/i.test(msg) || /UNAVAILABLE|RESOURCE_EXHAUSTED/.test(data.error?.status || '') && r.status !== 429) {
      throw Object.assign(new AiError(t('Gemini je teď přetížený ({s}). Zkus to za pár minut.', { s: r.status })), { retry: 'busy' });
    }
    if (r.status === 429) throw Object.assign(new AiError(t('Gemini hlásí vyčerpaný denní limit bezplatného klíče. Zkus to zítra, nebo si v Google AI Studiu zapni placení.')), { retry: 'model' });
    throw new AiError(t('Chyba Gemini {s}', { s: r.status }) + (msg ? `: ${msg.slice(0, 160)}` : ''));
  }
  return data;
}

// Ověří klíč a vybere nejnovější stabilní model „flash“ (názvy modelů se mění, proto se nezadávají natvrdo).
// Vrací { model, models }: models = záložní pořadí (novější flash, starší flash, pak flash-lite).
export async function pickModel(key) {
  const data = await call('models?pageSize=1000', null, key);
  const all = (data.models || [])
    .filter(m => (m.supportedGenerationMethods || []).includes('generateContent'))
    .map(m => m.name.replace(/^models\//, ''));
  const ver = n => parseFloat(n.match(/gemini-([\d.]+)/)[1]);
  const byVer = re => all.filter(n => re.test(n)).sort((a, b) => ver(b) - ver(a));
  const models = [...byVer(/^gemini-[\d.]+-flash$/).slice(0, 3), ...byVer(/^gemini-[\d.]+-flash-lite$/).slice(0, 1)];
  if (!models.length) models.push('gemini-flash-latest');
  return { model: models[0], models };
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Při přetížení (503) zkusí každý model víckrát s rostoucí pauzou, pak další model v pořadí.
// user = text, nebo pole částí ({ text } | { inline_data } | { file_data }). opts.timeout, opts.recitation = hláška při odmítnutí.
async function generate(system, user, schema, onWait = () => {}, opts = {}) {
  let { key, model, models } = aiConfig();
  if (!key) throw new AiError(t('Nejdřív vlož klíč pro Gemini v Nastavení.'));
  if (!models) { // klíč uložený starší verzí: doplnit záložní modely
    try { ({ model, models } = await pickModel(key)); setAiConfig({ key, model, models }); } catch { /* zkusí uložený model */ }
  }
  const order = [...new Set([model, ...(models || [])].filter(Boolean))];
  if (!order.length) order.push('gemini-flash-latest');
  const body = {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: 'user', parts: typeof user === 'string' ? [{ text: user }] : user }],
    generationConfig: { temperature: 0.2, responseMimeType: 'application/json', responseSchema: schema },
  };
  // překlad nepotřebuje dlouhé „přemýšlení“ modelu – zrychlí odpověď; když to model nezná, zkusí se bez toho
  if (localStorage.getItem('alaw-ai-nothink') !== '0') body.generationConfig.thinkingConfig = { thinkingLevel: 'low' };
  let data, lastErr;
  outer: for (const m of order) {
    for (const pause of [0, 2000, 5000]) {
      if (pause) { onWait(t('Gemini je přetížený, zkouším znovu ({m})…', { m })); await sleep(pause); }
      const started = Date.now();
      const tick = setInterval(() => onWait(t('Čekám na Gemini ({m})… {s} s', { m, s: Math.round((Date.now() - started) / 1000) })), 1000);
      try { data = await call(`models/${m}:generateContent`, body, key, opts.timeout); break outer; }
      catch (e) {
        lastErr = e;
        if (body.generationConfig.thinkingConfig && /thinking/i.test(e.message)) { // model volbu nezná
          delete body.generationConfig.thinkingConfig;
          localStorage.setItem('alaw-ai-nothink', '0');
          try { data = await call(`models/${m}:generateContent`, body, key, opts.timeout); break outer; } catch (e2) { lastErr = e2; if (e2.retry !== 'busy') throw e2; continue; }
        }
        if (e.retry === 'model') continue outer;
        if (e.retry !== 'busy') throw e;
      } finally { clearInterval(tick); }
    }
    onWait(t('Zkouším jiný model Gemini…'));
  }
  if (!data) throw new AiError(`${lastErr.message} ` + t('(zkoušené modely: {m})', { m: order.join(', ') }));
  const cand = data.candidates?.[0];
  if (!cand) throw new AiError(t('Gemini nevrátil odpověď') + (data.promptFeedback?.blockReason ? ` (${data.promptFeedback.blockReason}).` : '.'));
  if (cand.finishReason === 'RECITATION') throw Object.assign(new AiError(opts.recitation || t('Gemini odmítl odpovědět (ochrana autorských práv). Zkus přeložit méně veršů najednou.')), { kind: 'recitation' });
  const text = (cand.content?.parts || []).map(p => p.text || '').join('');
  try { return JSON.parse(text); } catch { throw new AiError(t('Gemini vrátil nečitelnou odpověď.')); }
}

const S = (type, extra = {}) => ({ type, ...extra });

const TRANSLATE_PROMPT = `Jsi expert na lingvistiku a překlad písňových textů do češtiny.
Dostaneš metadata písně a očíslované verše v původním jazyce (nejčastěji velština).
Ke každému verši doplň:
1. "literal": doslovný překlad do češtiny, který kopíruje stavbu a slovosled originálu (aby student viděl, jak je věta poskládaná).
2. "translation": přirozený, srozumitelný český překlad v kontextu celé písně.
3. "contractions": jen hovorové zkráceniny, stažené tvary, elize s apostrofem, hovorově spojená slova a nářeční tvary
   (např. velšsky "'di" → "wedi", "ti'n" → "ti yn", "dwi" → "rydw i", "'da" → "gyda", "moyn" → "eisiau", "'na" → "dyna").
   U každé: "short" přesně jak je v textu, "full" plný spisovný tvar, "note" krátké české vysvětlení (max. 10 slov).
Pravidla:
- Prosté počáteční mutace souhlásek (např. "Nghymru" → "Cymru", "gath" → "cath") do "contractions" NEPIŠ.
- Když verš žádné zkráceniny nemá, vrať prázdné pole.
- Vrať všechny verše se stejným "id", jaké dostaneš. Původní text neopakuj.`;

// Anglické rozhraní: překlad a vysvětlení do britské angličtiny (pole translation = překlad do jazyka rozhraní).
const TRANSLATE_PROMPT_EN = `You are an expert linguist and translator of song lyrics into British English.
You will receive song metadata and numbered lines in the original language (most often Welsh).
For each line provide:
1. "literal": a word-for-word English translation that follows the structure and word order of the original (so the learner can see how the sentence is built).
2. "translation": a natural, clear British English translation in the context of the whole song.
3. "contractions": only colloquial contractions, shortened forms, elisions with an apostrophe, words run together in speech and dialect forms
   (e.g. in Welsh "'di" → "wedi", "ti'n" → "ti yn", "dwi" → "rydw i", "'da" → "gyda", "moyn" → "eisiau", "'na" → "dyna").
   For each: "short" exactly as in the text, "full" the full standard form, "note" a short English explanation (10 words at most).
Rules:
- Do NOT list simple initial consonant mutations (e.g. "Nghymru" → "Cymru", "gath" → "cath") under "contractions".
- If a line has no contractions, return an empty array.
- Return every line with the same "id" you received. Do not repeat the original text.`;

// Přeloží verše do jazyka lang (cs/en, výchozí jazyk rozhraní): ty bez překladu v tom jazyce, nebo všechny při overwrite.
// Překlad v druhém jazyce zůstane. onProgress(hotovo, celkem).
export async function translateVersion(song, version, { lang = isEn ? 'en' : 'cs', overwrite = false, onProgress = () => {}, onWait = () => {} } = {}) {
  const todo = version.lines.filter(l => l.text.trim() && (overwrite || !trOf(l, lang).translation));
  const BATCH = 12;
  let done = 0;
  onProgress(0, todo.length);
  for (let i = 0; i < todo.length; i += BATCH) {
    const chunk = todo.slice(i, i + BATCH);
    // kontext: celá píseň (kvůli smyslu), k překladu jen tahle dávka
    const payload = {
      title: song.title, artist: song.artist, language: song.language,
      whole_song: version.lines.map(l => l.text).join('\n'),
      lines: chunk.map(l => ({ id: l.id, original: l.text })),
    };
    const res = await generate(lang === 'en' ? TRANSLATE_PROMPT_EN : TRANSLATE_PROMPT, JSON.stringify(payload), S('OBJECT', {
      properties: {
        lines: S('ARRAY', { items: S('OBJECT', {
          properties: {
            id: S('STRING'), literal: S('STRING'), translation: S('STRING'),
            contractions: S('ARRAY', { items: S('OBJECT', { properties: { short: S('STRING'), full: S('STRING'), note: S('STRING') }, required: ['short', 'full', 'note'] }) }),
          },
          required: ['id', 'literal', 'translation', 'contractions'],
        }) }),
      },
      required: ['lines'],
    }), onWait);
    const byId = new Map((res.lines || []).map(x => [String(x.id), x]));
    for (const l of chunk) {
      const x = byId.get(l.id);
      if (!x) continue;
      setTr(l, lang, {
        translation: String(x.translation || '').trim(),
        literal: String(x.literal || '').trim(),
        contractions: (x.contractions || []).filter(c => c && c.short).map(c => ({ short: String(c.short), full: String(c.full || ''), note: String(c.note || '') })),
      });
      done++;
    }
    onProgress(Math.min(i + BATCH, todo.length), todo.length);
  }
  return done;
}

const EXPLAIN_PROMPT = `Jsi trpělivý učitel jazyka (hlavně velštiny) pro českého studenta, který se učí písně nazpaměť.
Dostaneš jeden verš písně a kontext. Vysvětli ho česky:
- "words": každé slovo verše popořadě: "word" přesně jak je v textu, "base" základní (slovníkový) tvar, "meaning" český význam,
  "grammar" krátká poznámka (mutace a co ji způsobila, tvar slovesa, zkrácenina…), prázdný řetězec, když není co dodat.
- "note": 1–3 věty k verši jako celku (idiom, gramatika, výslovnost, pomůcka k zapamatování).`;

const EXPLAIN_PROMPT_EN = `You are a patient language teacher (mainly Welsh) for an English-speaking learner who is memorising songs.
You will receive one line of a song and its context. Explain it in British English:
- "words": every word of the line in order: "word" exactly as in the text, "base" the basic (dictionary) form, "meaning" the English meaning,
  "grammar" a short note (mutation and what caused it, verb form, contraction…), or an empty string if there is nothing to add.
- "note": 1–3 sentences about the line as a whole (idiom, grammar, pronunciation, a memory aid).`;

export async function explainLine(song, version, line) {
  return generate(isEn ? EXPLAIN_PROMPT_EN : EXPLAIN_PROMPT, JSON.stringify({
    title: song.title, artist: song.artist, language: song.language, line: line.text,
    context: version.lines.map(l => l.text).join('\n'),
  }), S('OBJECT', {
    properties: {
      words: S('ARRAY', { items: S('OBJECT', { properties: { word: S('STRING'), base: S('STRING'), meaning: S('STRING'), grammar: S('STRING') }, required: ['word', 'base', 'meaning', 'grammar'] }) }),
      note: S('STRING'),
    },
    required: ['words', 'note'],
  }));
}

// ---------- přepis textu z nahrávky ----------

const INLINE_MAX = () => window.__alawInlineMax || 14 * 1048576; // base64 zvětší o třetinu, celý požadavek smí mít 20 MB
const AUDIO_MIME = { 'audio/mpeg': 'audio/mp3', 'audio/x-wav': 'audio/wav', 'audio/wave': 'audio/wav', 'audio/vnd.wave': 'audio/wav', 'audio/x-flac': 'audio/flac', 'audio/x-m4a': 'audio/aac', 'audio/mp4': 'audio/aac' };
const EXT_MIME = { mp3: 'audio/mp3', wav: 'audio/wav', flac: 'audio/flac', ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg', m4a: 'audio/aac', aac: 'audio/aac', aiff: 'audio/aiff' };
export function audioMime(type, name = '') {
  if (AUDIO_MIME[type]) return AUDIO_MIME[type];
  if (type && type.startsWith('audio/')) return type;
  const ext = (String(name).match(/\.(\w+)$/) || [])[1];
  return EXT_MIME[ext && ext.toLowerCase()] || 'audio/mp3';
}

const blobToB64 = blob => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = rej; r.readAsDataURL(blob); });

// Velký soubor přes Files API (multipart: jeden požadavek, odpověď = popis souboru). Google by ho za 48 h smazal sám,
// mažeme ho hned po přepisu.
async function uploadFile(key, blob, mime, name, onWait) {
  onWait(t('Nahrávám nahrávku do Gemini ({mb} MB)…', { mb: Math.max(1, Math.round(blob.size / 1048576)) }));
  const boundary = 'alaw' + Math.random().toString(36).slice(2);
  const meta = JSON.stringify({ file: { display_name: String(name || 'alaw').slice(0, 100) } });
  const body = new Blob([`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: ${mime}\r\n\r\n`, blob, `\r\n--${boundary}--\r\n`]);
  let r;
  try {
    r = await fetch('https://generativelanguage.googleapis.com/upload/v1beta/files?uploadType=multipart', {
      method: 'POST', headers: { 'x-goog-api-key': key, 'X-Goog-Upload-Protocol': 'multipart', 'Content-Type': `multipart/related; boundary=${boundary}` }, body,
    });
  } catch { throw new AiError(navigator.onLine ? t('Nahrávku se nepodařilo nahrát do Gemini.') : t('Jsi offline.')); }
  const data = await r.json().catch(() => ({}));
  if (!r.ok || !data.file || !data.file.uri) throw new AiError(t('Nahrání do Gemini se nepovedlo ({s}).', { s: `${r.status}${data.error?.message ? `: ${data.error.message.slice(0, 120)}` : ''}` }));
  let file = data.file;
  for (let i = 0; i < 60 && file.state === 'PROCESSING'; i++) {
    onWait(t('Gemini zpracovává nahrávku…'));
    await sleep(window.__alawAiPoll ?? 2000);
    file = await call(file.name, null, key);
  }
  if (file.state === 'FAILED') throw new AiError(t('Gemini nahrávku nepřijal (neumí ji přečíst).'));
  return file;
}
function deleteFile(key, name) {
  if (!/^files\/[\w-]+$/.test(name || '')) return;
  fetch(`${API}/${name}`, { method: 'DELETE', headers: { 'x-goog-api-key': key } }).catch(() => {});
}

const TRANSCRIBE_PROMPT = `Jsi pečlivý přepisovatel zpívaných textů. Dostaneš nahrávku písně a její název.
Přepiš PŘESNĚ to, co se zpívá, v jazyce zpěvu (nejčastěji velština), se správným pravopisem a diakritikou (â, ŵ, ŷ…).
- Každý zpívaný verš (řádek textu) zvlášť, v pořadí, jak zazní. Opakované refrény a verše piš pokaždé znovu.
- "start": čas začátku verše v sekundách od začátku nahrávky (desetinné číslo).
- "new_stanza": true u prvního verše nové sloky nebo refrénu, jinak false.
- Nepřekládej, nic nevysvětluj, nepiš popisy hudby ani mluvčích. Nesrozumitelné slovo nahraď „…“.
- Když v nahrávce nikdo nezpívá, vrať prázdné pole.`;

// Přepíše zpívaný text z nahrávky. Vrací [{ start (ms|null), text, stanza }].
export async function transcribeAudio(blob, { title = '', artist = '', language = 'cy', name = '' } = {}, onWait = () => {}) {
  const { key } = aiConfig();
  if (!key) throw new AiError(t('Nejdřív vlož klíč pro Gemini v Nastavení.'));
  let mime = audioMime(blob.type, name);
  if (blob.size > INLINE_MAX()) { // velká nahrávka (WAV): nejdřív zkusit menší kopii (mono 16 kHz), jinak Files API
    onWait(t('Připravuji menší kopii nahrávky pro přepis…'));
    try { const small = await toSpeechWav(blob); if (small.size < blob.size) { blob = small; mime = 'audio/wav'; } } catch { /* zkusí se původní soubor */ }
  }
  let file = null, audioPart;
  if (blob.size <= INLINE_MAX()) audioPart = { inline_data: { mime_type: mime, data: await blobToB64(blob) } };
  else { file = await uploadFile(key, blob, mime, name || title, onWait); audioPart = { file_data: { mime_type: file.mimeType || mime, file_uri: file.uri } }; }
  try {
    const res = await generate(TRANSCRIBE_PROMPT, [audioPart, { text: JSON.stringify({ title, artist, language }) }], S('OBJECT', {
      properties: { lines: S('ARRAY', { items: S('OBJECT', { properties: { start: S('NUMBER'), text: S('STRING'), new_stanza: S('BOOLEAN') }, required: ['start', 'text'] }) }) },
      required: ['lines'],
    }), onWait, { timeout: 240000, recitation: t('Gemini přepis odmítl (ochrana autorských práv u známé písně). Zkus najít text na internetu.') });
    return cleanTranscript(res.lines);
  } finally { if (file) deleteFile(key, file.name); }
}

// Úklid odpovědi: prázdné verše pryč; časy jen když jsou všechny a rostou (jinak si je model vymyslel → bez časů).
export function cleanTranscript(lines) {
  const out = (Array.isArray(lines) ? lines : []).map(l => ({
    text: String(l?.text || '').replace(/\s+/g, ' ').trim(),
    start: l && Number.isFinite(+l.start) && +l.start >= 0 && l.start !== null && l.start !== '' ? Math.round(+l.start * 1000) : null,
    stanza: !!l?.new_stanza,
  })).filter(l => l.text && !/^[….\s]+$/.test(l.text)).slice(0, 400);
  const times = out.map(l => l.start);
  const ok = times.every(t => t != null) && times.every((t, i) => !i || t >= times[i - 1]);
  if (!ok) for (const l of out) l.start = null;
  if (out.length) out[0].stanza = false;
  return out;
}
