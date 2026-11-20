// Jazyk rozhraní (čeština / britská angličtina).
//
// Český text je zároveň klíč: t('Uložit') → v angličtině EN['Uložit'], když chybí, zůstane česky.
// Proměnné ve složených závorkách: t('Označeno {n} z {m}', { n, m }).
// Množná čísla: pl(n, '{n} píseň', '{n} písně', '{n} písní') → anglicky EN_PL['{n} píseň'] = [jedno, víc].
// Volba jazyka je jen v zařízení (alaw-prefs.lang), po přepnutí se stránka načte znovu.
// Volání t()/pl() piš vždy s textem v jednoduchých uvozovkách – testy z nich sestavují seznam překladů.
import { EN, EN_PL } from './i18n-en.js';

const PREFS_KEY = 'alaw-prefs';

function readLang() {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
    if (p.lang === 'cs' || p.lang === 'en') return p.lang;
  } catch { /* nevadí */ }
  return /^(cs|sk)\b/i.test(navigator.language || '') ? 'cs' : 'en';
}

export const lang = readLang();
export const isEn = lang === 'en';
export const missing = new Set(); // texty bez překladu (hlásí test)

const fmt = (s, vars) => vars ? s.replace(/\{(\w+)\}/g, (m, k) => (k in vars && vars[k] != null ? String(vars[k]) : m)) : s;

export function t(cs, vars) {
  let s = cs;
  if (isEn) {
    const e = EN[cs];
    if (e == null) missing.add(cs); else s = e;
  }
  return fmt(s, vars);
}

// Čeština: 1 / 2–4 / 0 a 5+; angličtina: 1 / ostatní.
export function pl(n, one, few, many, vars) {
  let s;
  if (isEn) {
    const e = EN_PL[one];
    if (!e) { missing.add(one); s = n === 1 ? one : n >= 2 && n <= 4 ? few : many; }
    else s = n === 1 ? e[0] : e[1];
  } else s = n === 1 ? one : n >= 2 && n <= 4 ? few : many;
  return fmt(s, { n, ...vars });
}

// Výchozí popisky verzí jsou uložené v datech česky („Hlavní“, „Přepis (Whisper) 2“…) – překládají se jen při zobrazení.
export function vlabel(label) {
  if (!isEn || !label) return label;
  const m = String(label).match(/^(.*?)( \d+)?$/);
  const known = { 'Hlavní': t('Hlavní'), 'Původní hlavní': t('Původní hlavní'), 'Přepis (Gemini)': t('Přepis (Gemini)'),
    'Přepis (Whisper)': t('Přepis (Whisper)'), 'Přepis (Bangor)': t('Přepis (Bangor)'), 'Verze': t('Verze') };
  return m[1] in known ? known[m[1]] + (m[2] || '') : label;
}

// Zdroj textu uložený v datech česky (sdílení, nahrávka, přepis) → při zobrazení přeložit.
export const srcLabel = s => ({ 'sdílení': t('sdílení'), 'nahrávka': t('nahrávka'), 'přepis': t('přepis'), 'manual': t('ručně') })[s] || s;

export const locale = isEn ? 'en-GB' : 'cs';
export const collate = (a, b) => String(a).localeCompare(String(b), locale);
// desetinné číslo podle jazyka (čeština čárka, angličtina tečka)
export const dec = (x, digits = 1) => { const s = Number(x).toFixed(digits); return isEn ? s : s.replace('.', ','); };

export const num = x => (isEn ? String(x) : String(x).replace('.', ','));

export function setLang(l) {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
    p.lang = l;
    localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch { /* nevadí */ }
  location.reload();
}

document.documentElement.lang = isEn ? 'en-GB' : 'cs';
window.__alawMissing = missing;
