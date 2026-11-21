# Alaw

Alaw (velšsky „melodie“): texty písní (hlavně velšských) a jejich učení nazpaměť. Webová aplikace (PWA) pro Android i počítač, funguje offline.

*Alaw (Welsh for ‘melody’): song lyrics, mainly Welsh, and learning them by heart. Available in Czech and British English – switch CZ | EN on the home screen.*

## Co umí (verze 0.11)

- **Překlad česky i anglicky** (0.11): u verše může být český i anglický překlad (i doslovný a zkratky); AI překládá do jazyka
  rozhraní, druhý jazyk na vyžádání (Nastavení → Překlady pomocí AI). V písni přepínač CZ / EN u tlačítka Překlad.
- **Stažení textu** (nabídka písně → Stáhnout text…): s časy (.lrc), bez časů (.txt), jen překlad (.txt) a text s překladem
  pod každým veršem (.txt), překlad v češtině i angličtině.
- **Čeština a britská angličtina** (0.10): přepínač CZ | EN v záhlaví knihovny, volba platí pro zařízení (výchozí podle jazyka
  prohlížeče/telefonu). Data písní se nepřekládají; AI překlad a vysvětlení verše vznikají v jazyce rozhraní.
- Knihovna písní s hledáním (i v textu, bez ohledu na stříšky), štítky a filtrem jazyka.
- Přidání písně: prostý text nebo LRC s časy, sloky oddělené prázdným řádkem, načtení ze souboru.
- Nahrávka: video z YouTube nebo vlastní zvukový soubor (mp3, m4a, ogg, wav, flac…) uložený v zařízení.
- Přehrávač: zpomalení 0,75× / 0,5×, skok o 5 s zpět, ťuknutí na verš = přehrát od něj, zvýraznění aktuálního verše.
- Smyčka jednoho verše nebo úseku veršů.
- Časování veršů ťukáním do rytmu (s krokem zpět a posunem všech časů).
- Režimy učení: Číst, Mizení (nastavitelné procento skrytých slov), Písmena (jen první písmeno); ťuknutím slovo odkryješ.
- U každého verše překlad, doslovný překlad, hovorové zkratky a vlastní poznámka.
- **Učení naostro** (tlačítko „Učit se“ v písni): nové verše po dvojicích (přečíst a poslechnout), pak podle prvních písmen,
  „jak verš zní?“ (vybav si verš po předchozím) a u dobře známých veršů psaní zpaměti (stříšky, velikost písmen,
  interpunkce ani drobný překlep nevadí). Po každém cvičení hodnocení Znovu / Těžké / Dobře / Snadno a opakování
  v intervalech (1 den, 3, 8…). Refrén se stejným textem se učí jednou. Nových veršů denně nastavitelně (výchozí 6).
- **Další cvičení v lekci** (aplikace je střídá sama podle síly verše, nevyhovující jdou vypnout v Nastavení → Učení):
  doplň slovo z nabídky, skládání slov verše, bliknutí, výběr ze tří („který verš následuje?“), z češtiny do velštiny,
  napřeskáčku („co je před tímto veršem?“) a diktát (jen u načasovaných veršů). Špatné možnosti jsou ze stejné písně.
- **Procvičit celou píseň** (tlačítko 🎯 v písni): skládání sloky, rozmazávání (po kolech, s časy i smyčka sloky),
  tahák pro zpěv (první slovo nebo první písmena veršů) a zkouška celé písně (co nevíš, vrátí se do opakování).
- **Mapa písně** (režim Mapa): co umíš, co se učíš, co je k opakování a kdy; ťuknutím procvičíš jeden verš.
  Na úvodní obrazovce proužek pokroku u písní a nenápadná připomínka, když verše jiné písně začínají slábnout.
- **Verze textu a sporná místa** (nabídka písně → Přidat verzi textu z jiného zdroje): k hlavní verzi až dvě další
  (z hledání, odkazu nebo vložené), každá může mít vlastní YouTube nebo nahrávku. Porovnání po slovech (velikost písmen,
  interpunkce, stříšky ani jiné zalomení řádků se nepočítají), rozdílná slova zvýrazněná, poslech verše ve smyčce 0,75×
  (nenačasovaný verš jde načasovat dvěma ťuknutími). Rozhodnutí: ✓ platí hlavní / ✓ platí druhá (opraví hlavní verzi,
  pokrok verše zůstane) / ⚠ nejisté – u nejistých míst uzná psaní zpaměti obě znění. ⚠ u verše v písni vede na porovnání.
- **Písně z nahrávek** (Nastavení → Záloha a import, nebo odkaz v prázdné knihovně a ve formuláři nové písně): víc mp3/wav…
  najednou (na počítači i celá složka). Název a interpret z názvu souboru „Interpret - Název“ (číslo stopy se vynechá),
  jinak z údajů v souboru (ID3, INFO ve wav), před přidáním jdou opravit. Písně vzniknou s nahrávkou, bez textu.
- **Najít texty** (proužek v knihovně „N písní nemá text“): hledání v LRCLIB podle názvu, interpreta a délky nahrávky,
  ✓ jistá shoda (název sedí a délka ±3 s), převzetí po jedné nebo všech jistých; časy jen když délka sedí. Co nenajde,
  „Hledat jinde“ ve všech zdrojích. U písně bez textu tlačítko „Najít text“.
  Načtení **souboru s odkazy** na stránky s texty (třeba od Clauda): texty se stáhnou z odkazů, nefunkční odkaz → LRCLIB.
- **Hledat na Googlu** (v okně hledání): otevře Google s dotazem; stránku pak sdílíš do Alaw (Android) nebo vložíš odkaz
  („🔗 Vložit odkaz“). Sdílená stránka se nabídne k písni, ke které se text hledal (3 hodiny).
- **Přepis textu z nahrávky** (Gemini nebo Whisper přes Groq – zdarma bez karty; klíče v Nastavení → Přepis z nahrávky; na počítači s Windows i **velšský model z Bangoru** – program `bangor/`, ve vydání `alaw-bangor.zip`): u písně bez textu, v nabídce písně a hromadně v Najít texty
  („Přepsat nenalezené z nahrávek“). Verše i s časy začátků; bez textu = hlavní verze, s textem = další verze k porovnání
  (a nenačasovaný text si z přepisu převezme časy u shodných veršů). Velké nahrávky se pro přepis posílají jako zmenšená kopie
  (mono 16 kHz; uložená nahrávka se nemění). Přepis oběma službami = dvě verze, rozdíly ukážou nejistá místa.
- **Časy veršů z nahrávky (Bangor):** u písní, které mají text a nahrávku, ale ne časy, Bangor nahrávku přepíše se slovy a aplikace podle shodných slov doplní, kdy který verš začíná (ostatní dopočítá). Nabídka písně → „Doplnit časy z nahrávky (Bangor)“, hromadně Nastavení → Bangor → „⏱ Doplnit časy z nahrávek“.
- **Výměna hlavní verze** (Porovnat verze → nabídka → Udělat hlavní verzí): pokrok veršů se převede na nové znění,
  nahrávka přejde na novou hlavní verzi, když vlastní nemá.
- **Hromadné mazání** v knihovně (☑ → označit písně → Smazat), i s nahrávkami a pokrokem; přenese se do ostatních zařízení.
- Záloha do JSON (volitelně se zvukem, vždy s pokrokem učení) a import, včetně JSON z projektu „Lyrics Trainer“.
- **Hledání textů** najednou v LRCLIB (i s časy), Welsh Lyrics wiki (welshlyrics.fandom.com, často s anglickým překladem a videem),
  LyricsTranslate, Wicidestun (velšská Wikisource), Bandcamp, We Learn Welsh, Genius a AZLyrics. Náhled, převzetí do písně,
  doplnění časů z LRCLIB podle shodných veršů, anglický překlad ze zdroje u veršů.
- **Text z odkazu** a **sdílení z prohlížeče** (Android: Sdílet → Alaw): z neznámé stránky se vybere blok, který vypadá jako text písně;
  známé weby mají vlastní čtení (mj. **Musixmatch** – jen z odkazu, hledání tam chce přihlášení).
- **Překlady přes Gemini** (vlastní klíč, uložený jen v zařízení): volný a doslovný překlad (česky, nebo anglicky při EN), hovorové zkratky,
  vysvětlení verše slovo po slovu.
- **Aplikace pro Android (APK)**: stejná aplikace ve WebView, stahuje stránky sama (bez prostředníka), ukládání souborů,
  tlačítko Zpět, nabídka nové verze. Vydává se automaticky přes GitHub Actions (`android/verze.txt`).
- **Synchronizace** mezi telefonem a počítačem přes vlastní soukromý repozitář na GitHubu, šifrovaně (AES-256-GCM,
  párovací kód 8 slov, i jako QR). Písně, překlady, časy, nahrávky i pokrok učení; novější úprava vyhrává.

## Spuštění na počítači

```
python3 -m http.server 8000
```
a otevřít http://localhost:8000

## Vývoj

- Bez sestavování: čisté HTML, CSS a JavaScript (ES moduly) v `index.html`, `css/`, `js/`.
- Po každé změně souborů spusť `python3 scripts/build_sw.py` (aktualizuje seznam souborů a verzi v `sw.js`).
- Testy: `python3 testy/test_zaklad.py`, `python3 testy/test_verze.py`, `python3 testy/test_hledani.py`, `python3 testy/test_hromadne.py`, `python3 testy/test_prepis.py`, `python3 testy/test_anglictina.py` (angličtina: slovník + obrazovky), `python3 testy/test_preklady.py` (dva překlady, export; Playwright, Chromium jako Pixel 7, bez sítě),
  `python3 testy/test_sync.py` (napodobený GitHub), `node testy/test_worker.mjs`. Kontrola zdrojů proti skutečným webům: `python3 testy/zdroje_naostro.py`.
- APK: `sh android/build.sh` (nástroje z npm, Java 17). Prostředník pro počítač: `worker/` (návod v `worker/README.md`).
