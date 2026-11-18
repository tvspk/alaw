# Prostředník pro hledání textů (Cloudflare Workers)

Potřebuje ho jen webová verze na počítači. Aplikace pro Android stahuje stránky sama.

## Nasazení (jednou, zdarma)

1. Přihlas se na https://dash.cloudflare.com
2. Vlevo **Compute (Workers)** → **Workers & Pages** → **Create** → **Create Worker** (šablona *Hello World*).
3. Název `alaw-proxy` → **Deploy**.
4. **Edit code** → smaž ukázkový kód, vlož celý obsah `worker.js` → **Deploy**.
5. Adresu workeru (např. `https://alaw-proxy.<tvoje-jméno>.workers.dev`) vlož v Alaw: **Nastavení → Hledání textů → Uložit a vyzkoušet**.

Prostředník přijme jen požadavky z aplikace Alaw (`tvspk.github.io`, `localhost`), jen https a jen textové stránky.
Test bez sítě: `node testy/test_worker.mjs`.
