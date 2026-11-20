// Sekce Synchronizace v Nastavení: průvodce nastavením, párovací kód (8 slov + QR), skenování QR, stav.
import { helpTitle } from './help.js';
import { el, sheet, toast } from './ui.js';
import { t, locale } from './i18n.js';
import * as sync from './sync.js';

const when = ms => new Date(ms).toLocaleString(locale, { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' });

function wordsEl(code) {
  return el('ol', { class: 'sy-words' }, code.split(' ').map(w => el('li', { text: w })));
}

// Tlačítko „Zobrazit QR kód“: QR obsahuje jen ALAW: + 8 slov (žádný token), za 2 minuty se samo skryje.
function qrPart(code) {
  if (!window.GSQR) return [];
  const box = el('div', { class: 'sy-qr', hidden: true });
  let timer = 0;
  const b = el('button', { type: 'button', class: 'btn', text: t('Zobrazit QR kód'), onclick: () => {
    clearTimeout(timer);
    if (!box.hidden) { box.hidden = true; box.replaceChildren(); b.textContent = t('Zobrazit QR kód'); return; }
    try { box.replaceChildren(el('div', { class: 'sy-qrimg', html: window.GSQR.svg(sync.qrText(code), 'M') }), el('p', { class: 'hint', text: t('Na druhém zařízení ťukni na „Naskenovat QR kód“. Kód se za 2 minuty sám skryje.') })); }
    catch (e) { console.warn('qr', e); return; }
    box.hidden = false; b.textContent = t('Skrýt QR kód');
    timer = setTimeout(() => { box.hidden = true; box.replaceChildren(); b.textContent = t('Zobrazit QR kód'); }, 120000);
  } });
  return [b, box];
}

function errBox() { return el('p', { class: 'sy-err', hidden: true }); }
function showErr(box, e) { box.textContent = typeof e === 'string' ? e : sync.errText(e instanceof sync.SyncError ? e.kind : 'other'); box.hidden = false; }

// ---------- průvodce ----------
function setup(onDone) {
  const token = el('input', { type: 'password', placeholder: 'github_pat_…', autocomplete: 'off', spellcheck: false, autocapitalize: 'off' });
  const repo = el('input', { value: 'alaw-sync', autocomplete: 'off', spellcheck: false, autocapitalize: 'off' });
  const err = errBox();
  sheet(close => {
    const go = el('button', { type: 'submit', class: 'btn primary', text: t('Připojit') });
    return el('form', { class: 'form', onsubmit: async e => {
      e.preventDefault();
      go.disabled = true; go.textContent = t('Ověřuji…'); err.hidden = true;
      try {
        const r = await sync.setupConnect(token.value, repo.value);
        close();
        if (r.needCode) askCode(onDone); else newCodeScreen(r.code, onDone);
      } catch (x) { go.disabled = false; go.textContent = t('Připojit'); showErr(err, x); }
    } },
      el('h3', { text: t('Nastavit synchronizaci') }),
      el('div', { class: 'sub', text: t('Vlož token pro schránku (začíná github_pat_) a název soukromého repozitáře.') }),
      el('label', { class: 'field' }, el('span', { text: 'Token' }), token),
      el('label', { class: 'field' }, el('span', { text: t('Repozitář') }), repo),
      err,
      el('div', { class: 'row end' }, el('button', { type: 'button', class: 'btn', text: t('Zrušit'), onclick: close }), go));
  });
  setTimeout(() => token.focus(), 50);
}

function newCodeScreen(code, onDone) {
  const err = errBox();
  const [qb, qbox] = qrPart(code);
  sheet(close => {
    const go = el('button', { type: 'button', class: 'btn primary', text: t('Mám je zapsaná'), onclick: async () => {
      go.disabled = true; go.textContent = t('Zakládám schránku…');
      try {
        const r = await sync.setupCreate();
        close();
        if (r.needCode) { askCode(onDone); return; }
        toast(r.ok ? t('Synchronizace je zapnutá.') : t('Synchronizace je zapnutá, první pokus se nepovedl – zkusím to znovu.'), 3500);
        onDone();
      } catch (x) { go.disabled = false; go.textContent = t('Mám je zapsaná'); showErr(err, x); }
    } });
    return el('div', {},
      el('h3', { text: t('Párovací kód') }),
      el('div', { class: 'sub', text: t('Tohle je párovací kód pro všechna tvoje zařízení. Zapiš si těchto 8 slov (nejlépe do správce hesel). Zadáš je na dalších zařízeních. Nikomu je neposílej.') }),
      wordsEl(code), err,
      el('div', { class: 'row' }, go, qb || null),
      qbox || null);
  });
}

function askCode(onDone) {
  const ta = el('textarea', { class: 'short', rows: 3, spellcheck: false, autocapitalize: 'off', autocomplete: 'off', placeholder: t('osm slov z prvního zařízení') });
  const err = errBox();
  let closeIt;
  const go = el('button', { type: 'button', class: 'btn primary', text: t('Pokračovat') });
  const submit = async () => {
    go.disabled = true; err.hidden = true;
    try {
      const r = await sync.setupJoin(ta.value);
      if (r.bad) { go.disabled = false; showErr(err, t('Kód nesedí. Zkontroluj všech 8 slov.')); return; }
      closeIt();
      toast(r.ok ? t('Synchronizace je zapnutá, písně se stahují.') : t('Synchronizace je zapnutá, první pokus se nepovedl – zkusím to znovu.'), 3500);
      onDone();
    } catch (x) { go.disabled = false; showErr(err, x); }
  };
  go.onclick = submit;
  closeIt = sheet(close => el('div', { class: 'form' },
    el('h3', { text: t('Párovací kód') }),
    el('div', { class: 'sub', text: t('Schránka už je založená. Zadej 8 slov párovacího kódu z prvního zařízení, nebo ho naskenuj jako QR kód. Z každého slova stačí první 4 písmena.') }),
    el('label', { class: 'field' }, ta), err,
    el('div', { class: 'row' }, go,
      window.GSQR ? el('button', { type: 'button', class: 'btn', text: t('Naskenovat QR kód'), onclick: () => scan(code => { ta.value = code; submit(); }) }) : null,
      el('button', { type: 'button', class: 'btn', text: t('Zrušit'), onclick: close }))));
}

// Kamera: zadní, BarcodeDetector, kde je, jinak dekodér z qr.js.
function scan(onCode) {
  const video = el('video', { playsinline: true, muted: true, autoplay: true });
  video.setAttribute('playsinline', '');
  const st = el('p', { class: 'hint', text: t('Spouštím kameru…') });
  const cam = { done: false, t: 0, stream: null, det: null };
  const stop = () => { cam.done = true; clearTimeout(cam.t); if (cam.stream) cam.stream.getTracks().forEach(tr => { try { tr.stop(); } catch { /* nic */ } }); };
  const closeIt = sheet(close => el('div', {},
    el('h3', { text: t('Naskenovat QR kód') }),
    el('div', { class: 'sub', text: t('Na druhém zařízení otevři Nastavení → Párovací kód → Zobrazit QR kód a namiř na něj kameru.') }),
    el('div', { class: 'sy-cam' }, video, el('div', { class: 'sy-frame' })), st,
    el('div', { class: 'row end' }, el('button', { type: 'button', class: 'btn', text: t('Zrušit'), onclick: () => { stop(); close(); } }))));
  const say = (s, bad) => { if (!cam.done) { st.textContent = s; st.classList.toggle('sy-err', !!bad); } };
  (async () => {
    if (!navigator.mediaDevices?.getUserMedia) { say(t('Kamera tu není k dispozici. Opiš 8 slov.'), 1); return; }
    try { cam.stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } } }); }
    catch (e) { say(e && (e.name === 'NotAllowedError' || e.name === 'SecurityError') ? t('Alaw nesmí používat kameru. Povol ji v nastavení telefonu, nebo opiš 8 slov.') : t('Kamera tu není k dispozici. Opiš 8 slov.'), 1); return; }
    if (cam.done || !document.contains(video)) { stop(); return; }
    try { if ('BarcodeDetector' in window && (await BarcodeDetector.getSupportedFormats()).includes('qr_code')) cam.det = new BarcodeDetector({ formats: ['qr_code'] }); } catch { cam.det = null; }
    video.srcObject = cam.stream;
    try { await video.play(); } catch { /* nic */ }
    say(t('Hledám kód…'));
    const cv = document.createElement('canvas');
    const tick = async () => {
      if (cam.done) return;
      if (!document.contains(video)) { stop(); return; }
      if (video.readyState >= 2 && video.videoWidth) {
        try {
          const k = Math.min(1, 800 / Math.max(video.videoWidth, video.videoHeight));
          const w = cv.width = Math.round(video.videoWidth * k), h = cv.height = Math.round(video.videoHeight * k);
          const ctx = cv.getContext('2d', { willReadFrequently: true });
          ctx.drawImage(video, 0, 0, w, h);
          let found = null;
          if (cam.det) { try { const r = await cam.det.detect(cv); if (r && r[0] && r[0].rawValue) found = r[0].rawValue; } catch { cam.det = null; } }
          if (found == null && window.GSQR) found = window.GSQR.decode(ctx.getImageData(0, 0, w, h), 80);
          if (found != null && !cam.done) {
            const code = sync.codeFromQr(found);
            if (code) { stop(); closeIt(); onCode(code); return; }
            say(t('Tohle není párovací kód Alaw.'), 1);
          }
        } catch (e) { console.warn('qr', e); }
      }
      cam.t = setTimeout(tick, 150);
    };
    tick();
  })();
}

function showCode() {
  const code = sync.pairingCode();
  if (!code) return;
  const [qb, qbox] = qrPart(code);
  sheet(close => el('div', {},
    el('h3', { text: t('Párovací kód') }),
    el('div', { class: 'sub', text: t('Tenhle kód zadej na dalším zařízení při nastavení synchronizace. Nikomu ho neposílej.') }),
    wordsEl(code),
    el('div', { class: 'row' }, qb || null, el('button', { type: 'button', class: 'btn', text: t('Zavřít'), onclick: close })),
    qbox || null));
}

function askToken() {
  const token = el('input', { type: 'password', placeholder: 'github_pat_…', autocomplete: 'off', spellcheck: false });
  const err = errBox();
  sheet(close => el('form', { class: 'form', onsubmit: async e => {
    e.preventDefault(); err.hidden = true;
    try { await sync.newToken(token.value); close(); toast(t('Token uložen.')); } catch (x) { showErr(err, x); }
  } },
    el('h3', { text: t('Vložit nový token') }),
    el('label', { class: 'field' }, el('span', { text: 'Token' }), token), err,
    el('div', { class: 'row end' }, el('button', { type: 'button', class: 'btn', text: t('Zrušit'), onclick: close }), el('button', { type: 'submit', class: 'btn primary', text: t('Uložit') }))));
}

// Sekce do Nastavení. Vrací [prvek, úklid].
export function syncSection() {
  const box = el('section', { class: 'section', id: 'sync' });
  const draw = () => {
    const s = sync.status();
    box.replaceChildren(helpTitle('h2', t('Synchronizace'), 'sync'));
    if (!s.on) {
      box.append(
        el('p', { text: t('Písně, překlady, časy i nahrávky se přenášejí mezi telefonem a počítačem, šifrovaně přes tvůj soukromý repozitář na GitHubu. Každé zařízení se nastaví jednou.') }),
        el('button', { type: 'button', class: 'btn primary', text: t('Nastavit synchronizaci'), onclick: () => setup(draw) }),
        el('p', { class: 'hint', style: { marginTop: '10px' }, text: t('Bez synchronizace se vše ukládá jen v tomto zařízení.') }));
      return;
    }
    const bad = !s.busy && s.lastError && s.lastError !== 'damaged';
    const line = s.busy ? (s.progress || t('Synchronizuji…')) : bad ? sync.errText(s.lastError)
      : (s.lastSync ? t('Naposledy: {w}', { w: when(s.lastSync) }) : t('Zatím nesynchronizováno.')) + (s.lastError === 'damaged' ? ` ${sync.errText('damaged')}` : '');
    box.append(
      el('p', { class: bad ? 'sy-err' : '', text: line }),
      el('p', { class: 'hint', text: t('Spárovaných zařízení: {n}', { n: s.devices }) }),
      el('div', { class: 'row' },
        el('button', { type: 'button', class: 'btn small primary', text: t('Synchronizovat teď'), disabled: s.busy, onclick: async () => { const ok = await sync.syncNow(true); if (ok) toast(t('Synchronizováno')); } }),
        el('button', { type: 'button', class: 'btn small', text: t('Párovací kód'), onclick: showCode }),
        s.lastError === 'token' ? el('button', { type: 'button', class: 'btn small', text: t('Vložit nový token'), onclick: askToken }) : null,
        el('button', { type: 'button', class: 'btn small danger', text: t('Vypnout v tomto zařízení'), onclick: () => {
          if (!confirm(t('Vypnout synchronizaci v tomto zařízení? Písně tady zůstanou, ostatní zařízení se synchronizují dál.'))) return;
          sync.turnOff(); toast(t('Synchronizace je v tomto zařízení vypnutá.'));
        } })),
      el('p', { class: 'hint', style: { marginTop: '10px' }, text: t('Písně se ukládají v tomto zařízení a synchronizují se šifrovaně přes GitHub. Nastavení zobrazení a klíč Gemini zůstávají jen tady.') }));
  };
  draw();
  const off = sync.onStatus(draw);
  return [box, off];
}
