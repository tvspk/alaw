// Nápověda „?“ u klíčů a přístupů v Nastavení: malé kulaté tlačítko → spodní panel s pár kroky, odkazy a poznámkou.
// Postupy služeb ověřené 20. 11. 2026 (názvy tlačítek na webech služeb se mění – jsou psané obecně, anglicky jak je služba ukazuje).
import { el, sheet } from './ui.js';
import { t } from './i18n.js';

export function helpBtn(topic) {
  return el('button', { type: 'button', class: 'help-btn', 'aria-label': t('Nápověda'), title: t('Nápověda'), text: '?', 'data-help': topic,
    onclick: e => { e.preventDefault(); e.stopPropagation(); openHelp(topic); } });
}

// Nadpis sekce s otazníkem vpravo vedle textu.
export const helpTitle = (tag, text, topic, props = {}) =>
  el(tag, { ...props, class: [props.class, 'has-help'].filter(Boolean).join(' ') }, el('span', { text }), helpBtn(topic));

export function openHelp(topic) {
  const h = TOPICS[topic]?.();
  if (!h) return null;
  return sheet(close => el('div', { class: 'help', 'data-topic': topic },
    el('h3', { text: h.title }),
    el('ol', { class: 'help-steps' }, h.steps.map(s => el('li', { text: s }))),
    h.links?.length ? el('div', { class: 'row help-links' }, h.links.map(l =>
      el('a', { class: 'btn small', href: l.href, target: '_blank', rel: 'noopener', text: l.text }))) : null,
    h.note ? el('p', { class: 'help-note', text: h.note }) : null,
    el('div', { class: 'row end' }, el('button', { type: 'button', class: 'btn', text: t('Zavřít'), onclick: close }))));
}

const KEEP = () => t('Klíč zůstává jen v tomto zařízení – nikomu ho neposílej. Na dalším zařízení vlož stejný klíč.');

const TOPICS = {
  gemini: () => ({
    title: t('Jak získat klíč Gemini'),
    steps: [
      t('Otevři Google AI Studio (tlačítko níže) a přihlas se účtem Google. Poprvé odsouhlas podmínky.'),
      t('Na stránce s klíči (API Keys) klikni na „Create API key“. Když se ptá na projekt, nech založit nový.'),
      t('Zkopíruj celý klíč – začíná „AQ.“ nebo „AIza“. Pokud tam už nějaký klíč je, můžeš použít ten.'),
      t('Vlož ho sem do pole Klíč API a klikni na Uložit a ověřit.'),
    ],
    links: [{ href: 'https://aistudio.google.com/apikey', text: t('Otevřít Google AI Studio') }],
    note: t('Zdarma a bez platební karty, s denním limitem. ') + KEEP(),
  }),
  groq: () => ({
    title: t('Jak získat klíč Groq'),
    steps: [
      t('Otevři konzoli Groq (tlačítko níže) a přihlas se – Googlem, GitHubem nebo e-mailem.'),
      t('Na stránce API Keys klikni na „Create API Key“, napiš libovolný název (třeba Alaw) a potvrď.'),
      t('Klíč hned zkopíruj (začíná „gsk_“) – Groq ho ukáže jen jednou. Když ho ztratíš, prostě vytvoř nový.'),
      t('Vlož ho sem do pole Klíč Groq a klikni na Uložit a ověřit.'),
    ],
    links: [{ href: 'https://console.groq.com/keys', text: t('Otevřít konzoli Groq') }],
    note: t('Zdarma a bez platební karty, s limitem počtu přepisů za minutu a za den. ') + KEEP(),
  }),
  bangor: () => ({
    title: t('Jak spustit Bangor na počítači'),
    steps: [
      t('Klikni na Stáhnout program (Windows) a stažený zip rozbal (pravým tlačítkem → Extrahovat vše).'),
      t('V rozbalené složce dvakrát klikni na alaw-bangor.bat. Když Windows ukáže, že ochránil počítač, klikni na Další informace → Přesto spustit.'),
      t('Poprvé se doinstaluje Python a stáhne model (asi 1,6 GB) – může to trvat i desítky minut. Počkej, až okno napíše „Program běží“, a nech ho otevřené.'),
      t('Tady klikni na Zapnout a ověřit. Když se prohlížeč zeptá na přístup k zařízením v místní síti nebo k aplikacím v tomto zařízení, povol ho.'),
      t('Příště už stačí před přepisem spustit alaw-bangor.bat – start je hned.'),
    ],
    note: t('Bez klíče, zdarma a bez limitů; nahrávky neopouštějí počítač. Bez grafické karty NVIDIA přepis běží na procesoru – pomaleji, ale funguje.'),
  }),
  sync: () => ({
    title: t('Jak nastavit synchronizaci'),
    steps: [
      t('Na github.com (přihlášený) založ nový repozitář: „+“ → New repository. Název třeba alaw-sync, zvol Private, zaškrtni „Add a README file“ a klikni na Create repository.'),
      t('Vytvoř token (tlačítko níže, nebo profil → Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token).'),
      t('Token pojmenuj a zvol platnost. U Repository access vyber „Only select repositories“ a svůj repozitář, v Permissions přidej Contents s „Read and write“. Klikni na Generate token.'),
      t('Token zkopíruj (začíná „github_pat_“). Tady klikni na Nastavit synchronizaci a vlož token a název repozitáře.'),
      t('Aplikace ukáže 8 slov párovacího kódu – zapiš si je. Na dalším zařízení vlož stejný token a repozitář a pak 8 slov, nebo naskenuj QR kód.'),
    ],
    links: [{ href: 'https://github.com/new', text: t('Nový repozitář') },
      { href: 'https://github.com/settings/personal-access-tokens/new', text: t('Nový token') }],
    note: t('Zdarma. Data jsou šifrovaná 8 slovy, GitHub je nepřečte. Až tokenu vyprší platnost, aplikace požádá o nový. Token ani slova nikomu neposílej.'),
  }),
  proxy: () => ({
    title: t('Jak založit prostředníka'),
    steps: [
      t('Založ si zdarma účet na Cloudflare a přihlas se (tlačítko níže).'),
      t('Vlevo otevři Workers & Pages → Create → Create Worker (šablona Hello World). Název alaw-proxy, pak Deploy.'),
      t('Klikni na Edit code, smaž ukázkový kód a vlož celý obsah souboru worker.js z Alaw (druhé tlačítko níže). Pak Deploy.'),
      t('Zkopíruj adresu workeru (https://alaw-proxy.….workers.dev), vlož ji sem do pole Adresa prostředníka a klikni na Uložit a vyzkoušet.'),
    ],
    links: [{ href: 'https://dash.cloudflare.com', text: t('Otevřít Cloudflare') },
      { href: 'https://github.com/tvspk/alaw/blob/main/worker/worker.js', text: t('Soubor worker.js') }],
    note: t('Zdarma. Potřebuje ho jen prohlížeč na počítači – v telefonu (APK) hledá Alaw ve všech zdrojích přímo.'),
  }),
};
export const HELP_TOPICS = Object.keys(TOPICS);
