// Vyrovnání hlasitosti pro náhodné přehrávání (0.17). Nahrávky z různých zdrojů hrají různě nahlas:
// z dekódovaného zvuku se změří hlasitost hlasitých úseků (okna 0,4 s, relativní práh −10 dB jako u LUFS)
// a hlasité nahrávky se ztlumí na společnou úroveň (zesílit přes audio.volume nejde, tiché zůstanou na 100 %).
// Výsledek se pamatuje jen v tomto zařízení (localStorage['alaw-loud'], klíč nahrávky → dB).
const KEY = 'alaw-loud';
const TARGET = -16;            // dBFS, cílová hlasitost
const MIN_VOL = 0.18;          // nejvýš ~ −15 dB
const MAX_BYTES = 80 * 1048576; // větší soubory se neměří (dekódování by zabralo moc paměti)

let cache = null;
function load() {
  if (!cache) { try { cache = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { cache = {}; } }
  return cache;
}
function store(key, db) {
  load()[key] = Math.round(db * 10) / 10;
  try { localStorage.setItem(KEY, JSON.stringify(cache)); } catch { /* plno – nevadí */ }
}

export const known = key => key in load();
export function volumeFor(key) {
  const db = load()[key];
  if (db == null || !Number.isFinite(db)) return 1;
  return Math.max(MIN_VOL, Math.min(1, 10 ** ((TARGET - db) / 20)));
}

// Hlasitost z PCM vzorků (pole kanálů Float32Array) v dBFS; čistá funkce kvůli testu.
export function loudnessDb(channels, rate) {
  const win = Math.max(1, Math.round(rate * 0.4));
  const n = channels[0].length;
  const energies = [];
  for (let i = 0; i + win <= n; i += win) {
    let e = 0;
    for (const ch of channels) for (let j = i; j < i + win; j++) e += ch[j] * ch[j];
    e /= win * channels.length;
    if (e > 1e-7) energies.push(e); // absolutní práh ~ −70 dB (ticho)
  }
  if (!energies.length) return null;
  const mean = energies.reduce((a, b) => a + b, 0) / energies.length;
  const loud = energies.filter(e => e >= mean * 0.1);
  return 10 * Math.log10(loud.reduce((a, b) => a + b, 0) / loud.length);
}

const busy = new Set();
// Změří nahrávku (když ještě není změřená); vrací hlasitost pro audio.volume, nebo null.
export async function measure(key, blob) {
  if (known(key)) return volumeFor(key);
  if (!blob || blob.size > MAX_BYTES || busy.has(key)) return null;
  const Ctx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (!Ctx) return null;
  busy.add(key);
  try {
    const buf = await new Ctx(1, 8000, 8000).decodeAudioData(await blob.arrayBuffer());
    const chans = Array.from({ length: Math.min(2, buf.numberOfChannels) }, (_, i) => buf.getChannelData(i));
    const db = loudnessDb(chans, buf.sampleRate);
    if (db == null) return null;
    store(key, db);
    return volumeFor(key);
  } catch { return null; } finally { busy.delete(key); }
}
