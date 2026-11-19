// Sekce Synchronizace v Nastavení: průvodce nastavením, párovací kód (8 slov + QR), skenování QR, stav.
import { el, sheet, toast } from './ui.js';
import * as sync from './sync.js';

const when = t => new Date(t).toLocaleString('cs-CZ', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' });

function wordsEl(code) {
  return el('ol', { class: 'sy-words' }, code.split(' ').map(w => el('li', { text: w })));
}

// Tlačítko „Zobrazit QR kód“: QR obsahuje jen ALAW: + 8 slov (žádný token), za 2 minuty se samo skryje.
function qrPart(code) {
  if (!window.GSQR) return [];
  const box = el('div', { class: 'sy-qr', hidden: true });
  let t = 0;
  const b = el('button', { type: 'button', class: 'btn', text: 'Zobrazit QR kód', onclick: () => {
    clearTimeout(t);
    if (!box.hidden) { box.hidden = true; box.replaceChildren(); b.textContent = 'Zobrazit QR kód'; return; }
    try { box.replaceChildren(el('div', { class: 'sy-qrimg', html: window.GSQR.svg(sync.qrText(code), 'M') }), el('p', { class: 'hint', text: 'Na druhém zařízení ťukni na „Naskenovat QR kód“. Kód se za 2 minuty sám skryje.' })); }
    catch (e) { console.warn('qr', e); return; }
    box.hidden = false; b.textContent = 'Skrýt QR kód';
    t = setTimeout(() => { box.hidden = true; box.replaceChildren(); b.textContent = 'Zobrazit QR kód'; }, 120000);
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
    const go = el('button', { type: 'submit', class: 'btn primary', text: 'Připojit' });
    return el('form', { class: 'form', onsubmit: async e => {
      e.preventDefault();
      go.disabled = true; go.textContent = 'Ověřuji…'; err.hidden = true;
      try {
        const r = await sync.setupConnect(token.value, repo.value);
        close();
        if (r.needCode) askCode(onDone); else newCodeScreen(r.code, onDone);
      } catch (x) { go.disabled = false; go.textContent = 'Připojit'; showErr(err, x); }
    } },
      el('h3', { text: 'Nastavit synchronizaci' }),
      el('div', { class: 'sub', text: 'Vlož token pro schránku (začíná github_pat_) a název soukromého repozitáře.' }),
      el('label', { class: 'field' }, el('span', { text: 'Token' }), token),
      el('label', { class: 'field' }, el('span', { text: 'Repozitář' }), repo),
      err,
      el('div', { class: 'row end' }, el('button', { type: 'button', class: 'btn', text: 'Zrušit', onclick: close }), go));
  });
  setTimeout(() => token.focus(), 50);
}

function newCodeScreen(code, onDone) {
  const err = errBox();
  const [qb, qbox] = qrPart(code);
  sheet(close => {
    const go = el('button', { type: 'button', class: 'btn primary', text: 'Mám je zapsaná', onclick: async () => {
      go.disabled = true; go.textContent = 'Zakládám schránku…';
      try {
        const r = await sync.setupCreate();
        close();
        if (r.needCode) { askCode(onDone); return; }
        toast(r.ok ? 'Synchronizace je zapnutá.' : 'Synchronizace je zapnutá, první pokus se nepovedl – zkusím to znovu.', 3500);
        onDone();
      } catch (x) { go.disabled = false; go.textContent = 'Mám je zapsaná'; showErr(err, x); }
    } });
    return el('div', {},
      el('h3', { text: 'Párovací kód' }),
      el('div', { class: 'sub', text: 'Tohle je párovací kód pro všechna tvoje zařízení. Zapiš si těchto 8 slov (nejlépe do správce hesel). Zadáš je na dalších zařízeních. Nikomu je neposílej.' }),
      wordsEl(code), err,
      el('div', { class: 'row' }, go, qb || null),
      qbox || null);
  });
}

function askCode(onDone) {
  const ta = el('textarea', { class: 'short', rows: 3, spellcheck: false, autocapitalize: 'off', autocomplete: 'off', placeholder: 'osm slov z prvního zařízení' });
  const err = errBox();
  let closeIt;
  const go = el('button', { type: 'button', class: 'btn primary', text: 'Pokračovat' });
  const submit = async () => {
    go.disabled = true; err.hidden = true;
    try {
      const r = await sync.setupJoin(ta.value);
      if (r.bad) { go.disabled = false; showErr(err, 'Kód nesedí. Zkontroluj všech 8 slov.'); return; }
      closeIt();
      toast(r.ok ? 'Synchronizace je zapnutá, písně se stahují.' : 'Synchronizace je zapnutá, první pokus se nepovedl – zkusím to znovu.', 3500);
      onDone();
    } catch (x) { go.disabled = false; showErr(err, x); }
  };
  go.onclick = submit;
  closeIt = sheet(close => el('div', { class: 'form' },
    el('h3', { text: 'Párovací kód' }),
    el('div', { class: 'sub', text: 'Schránka už je založená. Zadej 8 slov párovacího kódu z prvního zařízení, nebo ho naskenuj jako QR kód. Z každého slova stačí první 4 písmena.' }),
    el('label', { class: 'field' }, ta), err,
    el('div', { class: 'row' }, go,
      window.GSQR ? el('button', { type: 'button', class: 'btn', text: 'Naskenovat QR kód', onclick: () => scan(code => { ta.value = code; submit(); }) }) : null,
      el('button', { type: 'button', class: 'btn', text: 'Zrušit', onclick: close }))));
}

// Kamera: zadní, BarcodeDetector, kde je, jinak dekodér z qr.js.
function scan(onCode) {
  const video = el('video', { playsinline: true, muted: true, autoplay: true });
  video.setAttribute('playsinline', '');
  const st = el('p', { class: 'hint', text: 'Spouštím kameru…' });
  const cam = { done: false, t: 0, stream: null, det: null };
  const stop = () => { cam.done = true; clearTimeout(cam.t); if (cam.stream) cam.stream.getTracks().forEach(t => { try { t.stop(); } catch { /* nic */ } }); };
  const closeIt = sheet(close => el('div', {},
    el('h3', { text: 'Naskenovat QR kód' }),
    el('div', { class: 'sub', text: 'Na druhém zařízení otevři Nastavení → Párovací kód → Zobrazit QR kód a namiř na něj kameru.' }),
    el('div', { class: 'sy-cam' }, video, el('div', { class: 'sy-frame' })), st,
    el('div', { class: 'row end' }, el('button', { type: 'button', class: 'btn', text: 'Zrušit', onclick: () => { stop(); close(); } }))));
  const say = (s, bad) => { if (!cam.done) { st.textContent = s; st.classList.toggle('sy-err', !!bad); } };
  (async () => {
    if (!navigator.mediaDevices?.getUserMedia) { say('Kamera tu není k dispozici. Opiš 8 slov.', 1); return; }
    try { cam.stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } } }); }
    catch (e) { say(e && (e.name === 'NotAllowedError' || e.name === 'SecurityError') ? 'Alaw nesmí používat kameru. Povol ji v nastavení telefonu, nebo opiš 8 slov.' : 'Kamera tu není k dispozici. Opiš 8 slov.', 1); return; }
    if (cam.done || !document.contains(video)) { stop(); return; }
    try { if ('BarcodeDetector' in window && (await BarcodeDetector.getSupportedFormats()).includes('qr_code')) cam.det = new BarcodeDetector({ formats: ['qr_code'] }); } catch { cam.det = null; }
    video.srcObject = cam.stream;
    try { await video.play(); } catch { /* nic */ }
    say('Hledám kód…');
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
          let t = null;
          if (cam.det) { try { const r = await cam.det.detect(cv); if (r && r[0] && r[0].rawValue) t = r[0].rawValue; } catch { cam.det = null; } }
          if (t == null && window.GSQR) t = window.GSQR.decode(ctx.getImageData(0, 0, w, h), 80);
          if (t != null && !cam.done) {
            const code = sync.codeFromQr(t);
            if (code) { stop(); closeIt(); onCode(code); return; }
            say('Tohle není párovací kód Alaw.', 1);
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
    el('h3', { text: 'Párovací kód' }),
    el('div', { class: 'sub', text: 'Tenhle kód zadej na dalším zařízení při nastavení synchronizace. Nikomu ho neposílej.' }),
    wordsEl(code),
    el('div', { class: 'row' }, qb || null, el('button', { type: 'button', class: 'btn', text: 'Zavřít', onclick: close })),
    qbox || null));
}

function askToken() {
  const token = el('input', { type: 'password', placeholder: 'github_pat_…', autocomplete: 'off', spellcheck: false });
  const err = errBox();
  sheet(close => el('form', { class: 'form', onsubmit: async e => {
    e.preventDefault(); err.hidden = true;
    try { await sync.newToken(token.value); close(); toast('Token uložen.'); } catch (x) { showErr(err, x); }
  } },
    el('h3', { text: 'Vložit nový token' }),
    el('label', { class: 'field' }, el('span', { text: 'Token' }), token), err,
    el('div', { class: 'row end' }, el('button', { type: 'button', class: 'btn', text: 'Zrušit', onclick: close }), el('button', { type: 'submit', class: 'btn primary', text: 'Uložit' }))));
}

// Sekce do Nastavení. Vrací [prvek, úklid].
export function syncSection() {
  const box = el('section', { class: 'section', id: 'sync' });
  const draw = () => {
    const s = sync.status();
    box.replaceChildren(el('h2', { text: 'Synchronizace' }));
    if (!s.on) {
      box.append(
        el('p', { text: 'Písně, překlady, časy i nahrávky se přenášejí mezi telefonem a počítačem, šifrovaně přes tvůj soukromý repozitář na GitHubu. Každé zařízení se nastaví jednou.' }),
        el('button', { type: 'button', class: 'btn primary', text: 'Nastavit synchronizaci', onclick: () => setup(draw) }),
        el('p', { class: 'hint', style: { marginTop: '10px' }, text: 'Bez synchronizace se vše ukládá jen v tomto zařízení.' }));
      return;
    }
    const bad = !s.busy && s.lastError && s.lastError !== 'damaged';
    const line = s.busy ? (s.progress || 'Synchronizuji…') : bad ? sync.errText(s.lastError)
      : (s.lastSync ? `Naposledy: ${when(s.lastSync)}` : 'Zatím nesynchronizováno.') + (s.lastError === 'damaged' ? ` ${sync.ERR.damaged}` : '');
    box.append(
      el('p', { class: bad ? 'sy-err' : '', text: line }),
      el('p', { class: 'hint', text: `Spárovaných zařízení: ${s.devices}` }),
      el('div', { class: 'row' },
        el('button', { type: 'button', class: 'btn small primary', text: 'Synchronizovat teď', disabled: s.busy, onclick: async () => { const ok = await sync.syncNow(true); if (ok) toast('Synchronizováno'); } }),
        el('button', { type: 'button', class: 'btn small', text: 'Párovací kód', onclick: showCode }),
        s.lastError === 'token' ? el('button', { type: 'button', class: 'btn small', text: 'Vložit nový token', onclick: askToken }) : null,
        el('button', { type: 'button', class: 'btn small danger', text: 'Vypnout v tomto zařízení', onclick: () => {
          if (!confirm('Vypnout synchronizaci v tomto zařízení? Písně tady zůstanou, ostatní zařízení se synchronizují dál.')) return;
          sync.turnOff(); toast('Synchronizace je v tomto zařízení vypnutá.');
        } })),
      el('p', { class: 'hint', style: { marginTop: '10px' }, text: 'Písně se ukládají v tomto zařízení a synchronizují se šifrovaně přes GitHub. Nastavení zobrazení a klíč Gemini zůstávají jen tady.' }));
  };
  draw();
  const off = sync.onStatus(draw);
  return [box, off];
}
