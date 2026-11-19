// Práce s písněmi nad IndexedDB + nastavení, která platí jen v tomto zařízení (localStorage).
import { db } from './db.js';
import { normalizeSong } from './model.js';
import { stamp, recordDelete, changed } from './sync.js';
import { freshRec } from './learn.js';

export async function listSongs() {
  const songs = (await db.allSongs()).map(normalizeSong).filter(Boolean);
  return songs.sort((a, b) => a.title.localeCompare(b.title, 'cy', { sensitivity: 'base' }));
}

export const getSong = async id => normalizeSong(await db.getSong(id));

export async function saveSong(song) {
  const prev = await db.getSong(song.id);
  song.updatedAt = stamp(Math.max(prev?.updatedAt || 0, song.updatedAt || 0)); // čas podle GitHubu, vždy novější
  await db.putSong(song);
  changed();
  return song;
}

export async function deleteSong(song) {
  for (const v of song.versions) if (v.audio) await db.deleteAudio(v.audio.key);
  await db.deleteSong(song.id);
  await db.deleteProgress((await db.allProgress()).filter(r => r.s === song.id).map(r => r.id));
  await recordDelete(song.id);
  changed();
}

// ---------- pokrok učení (learn.js) ----------
// Mapa klíč verše → záznam pro jednu píseň, nebo pro všechny písně: Map idPísně → Map.
export async function getProgress(songId) {
  const all = await db.allProgress();
  if (songId) return new Map(all.filter(r => r.s === songId).map(r => [r.k, r]));
  const by = new Map();
  for (const r of all) { if (!by.has(r.s)) by.set(r.s, new Map()); by.get(r.s).set(r.k, r); }
  return by;
}

// Uložit záznamy pokroku: razítko času (hodiny GitHubu, vždy novější) + naplánovat synchronizaci.
export async function saveProgress(...recs) {
  for (const r of recs) r.t = stamp(r.t);
  await db.putProgressMany(recs);
  changed();
  return recs;
}

// Vynulovat pokrok veršů (zapíše se jako nový stav, ať se vynulování dostane i do ostatních zařízení).
export async function resetProgress(songId, keys) {
  const cur = await getProgress(songId);
  const recs = keys.filter(k => cur.has(k) && cur.get(k).st !== 'new').map(k => ({ ...freshRec(songId, k), t: cur.get(k).t }));
  if (recs.length) await saveProgress(...recs);
  return recs.length;
}

export const getAudioBlob = key => db.getAudio(key);
export const putAudioBlob = (key, blob) => db.putAudio(key, blob);
export const deleteAudioBlob = key => db.deleteAudio(key);

// Nastavení jen pro toto zařízení (velikost písma, poslední režim…).
const PREFS_KEY = 'alaw-prefs';
const defaults = { exOff: {}, newPerDay: 6, alwaysType: false, autoPlayLine: true, remindHidden: {}, mode: 'read', clozePct: 40, showTr: true, showAlt: true, showLit: false, showContr: true, rate: 1, lyricSize: 1.22, autoScroll: true, source: {} };
let prefs = null;
export function getPrefs() {
  if (!prefs) {
    try { prefs = { ...defaults, ...JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') }; } catch { prefs = { ...defaults }; }
  }
  return prefs;
}
export function setPrefs(patch) {
  Object.assign(getPrefs(), patch);
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch { /* nevadí */ }
}
