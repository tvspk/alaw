// Gemini: český překlad veršů, doslovný překlad, hovorové zkratky a vysvětlení verše.
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
async function call(path, body, key) {
  let r;
  const send = viaQuery => fetch(`${API}/${path}${viaQuery ? `${path.includes('?') ? '&' : '?'}key=${encodeURIComponent(key)}` : ''}`, {
    method: body ? 'POST' : 'GET',
    headers: viaQuery ? { 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: body ? JSON.stringify(body) : undefined,
  });
  try {
    r = await send(false);
    if (r.status === 401) r = await send(true);
  } catch { throw new AiError(navigator.onLine ? 'Gemini neodpovídá.' : 'Jsi offline.'); }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = data.error?.message || '';
    if ((r.status === 400 && /API key/i.test(msg)) || r.status === 401) throw new AiError('Klíč pro Gemini není platný. Zkopíruj ho z Google AI Studia znovu celý (začíná „AQ.“ nebo „AIza“).');
    if (r.status === 403) throw new AiError('Klíč pro Gemini nemá přístup (zkontroluj ho v Google AI Studiu).');
    if (r.status === 404) throw Object.assign(new AiError('Model Gemini nenalezen. V Nastavení klíč ulož znovu, vybere se aktuální model.'), { retry: 'model' });
    // přetížení: Google ho hlásí různými kódy (5xx, někdy i 4xx) se zprávou „high demand / overloaded / try again“
    if (r.status >= 500 || /high demand|overload|unavailable|try again|capacity/i.test(msg) || /UNAVAILABLE|RESOURCE_EXHAUSTED/.test(data.error?.status || '') && r.status !== 429) {
      throw Object.assign(new AiError(`Gemini je teď přetížený (${r.status}). Zkus to za pár minut.`), { retry: 'busy' });
    }
    if (r.status === 429) throw Object.assign(new AiError('Gemini hlásí vyčerpaný denní limit bezplatného klíče. Zkus to zítra, nebo si v Google AI Studiu zapni placení.'), { retry: 'model' });
    throw new AiError(`Chyba Gemini ${r.status}${msg ? `: ${msg.slice(0, 160)}` : ''}`);
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
async function generate(system, user, schema, onWait = () => {}) {
  let { key, model, models } = aiConfig();
  if (!key) throw new AiError('Nejdřív vlož klíč pro Gemini v Nastavení.');
  if (!models) { // klíč uložený starší verzí: doplnit záložní modely
    try { ({ model, models } = await pickModel(key)); setAiConfig({ key, model, models }); } catch { /* zkusí uložený model */ }
  }
  const order = [...new Set([model, ...(models || [])].filter(Boolean))];
  if (!order.length) order.push('gemini-flash-latest');
  const body = {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: 'user', parts: [{ text: user }] }],
    generationConfig: { temperature: 0.2, responseMimeType: 'application/json', responseSchema: schema },
  };
  let data, lastErr;
  outer: for (const m of order) {
    for (const pause of [0, 2000, 5000]) {
      if (pause) { onWait(`Gemini je přetížený, zkouším znovu (${m})…`); await sleep(pause); }
      try { data = await call(`models/${m}:generateContent`, body, key); break outer; }
      catch (e) {
        lastErr = e;
        if (e.retry === 'model') continue outer;
        if (e.retry !== 'busy') throw e;
      }
    }
    onWait('Zkouším jiný model Gemini…');
  }
  if (!data) throw new AiError(`${lastErr.message} (zkoušené modely: ${order.join(', ')})`);
  const cand = data.candidates?.[0];
  if (!cand) throw new AiError('Gemini nevrátil odpověď' + (data.promptFeedback?.blockReason ? ` (${data.promptFeedback.blockReason}).` : '.'));
  if (cand.finishReason === 'RECITATION') throw new AiError('Gemini odmítl odpovědět (ochrana autorských práv). Zkus přeložit méně veršů najednou.');
  const text = (cand.content?.parts || []).map(p => p.text || '').join('');
  try { return JSON.parse(text); } catch { throw new AiError('Gemini vrátil nečitelnou odpověď.'); }
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

// Přeloží verše (ty bez překladu, nebo všechny při overwrite). onProgress(hotovo, celkem).
export async function translateVersion(song, version, { overwrite = false, onProgress = () => {}, onWait = () => {} } = {}) {
  const todo = version.lines.filter(l => l.text.trim() && (overwrite || !l.translation));
  const BATCH = 40;
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
    const res = await generate(TRANSLATE_PROMPT, JSON.stringify(payload), S('OBJECT', {
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
      l.translation = String(x.translation || '').trim();
      l.literal = String(x.literal || '').trim();
      l.contractions = (x.contractions || []).filter(c => c && c.short).map(c => ({ short: String(c.short), full: String(c.full || ''), note: String(c.note || '') }));
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

export async function explainLine(song, version, line) {
  return generate(EXPLAIN_PROMPT, JSON.stringify({
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
