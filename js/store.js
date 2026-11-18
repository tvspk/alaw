// Práce s písněmi nad IndexedDB + nastavení, která platí jen v tomto zařízení (localStorage).
import { db } from './db.js';
import { normalizeSong } from './model.js';

export async function listSongs() {
  const songs = (await db.allSongs()).map(normalizeSong).filter(Boolean);
  return songs.sort((a, b) => a.title.localeCompare(b.title, 'cy', { sensitivity: 'base' }));
}

export const getSong = async id => normalizeSong(await db.getSong(id));

export async function saveSong(song) {
  song.updatedAt = Date.now();
  await db.putSong(song);
  return song;
}

export async function deleteSong(song) {
  for (const v of song.versions) if (v.audio) await db.deleteAudio(v.audio.key);
  await db.deleteSong(song.id);
}

export const getAudioBlob = key => db.getAudio(key);
export const putAudioBlob = (key, blob) => db.putAudio(key, blob);
export const deleteAudioBlob = key => db.deleteAudio(key);

// Nastavení jen pro toto zařízení (velikost písma, poslední režim…).
const PREFS_KEY = 'alaw-prefs';
const defaults = { mode: 'read', clozePct: 40, showTr: true, showAlt: true, showLit: false, showContr: true, rate: 1, lyricSize: 1.22, autoScroll: true, source: {} };
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
