# Vypíše všechny texty z t(…) a pl(n, …) v js/*.js jako JSON {"t": [...], "pl": [[jedno, 2–4, 5+], ...]} (pro test_anglictina.py).
# Spuštění: python3 testy/i18n_klice.py <kořen repozitáře>
import re, json, sys
from pathlib import Path
root = Path(sys.argv[1])
S = r"'((?:[^'\\]|\\.)*)'"
T_RE = re.compile(r"(?<![\w.$])t\(\s*" + S)
PL_RE = re.compile(r"(?<![\w.$])pl\(\s*[^,]+?,\s*" + S + r"\s*,\s*" + S + r"\s*,\s*" + S)
def un(s): return s.encode('utf-8').decode('unicode_escape').encode('latin-1').decode('utf-8') if '\\' in s else s
ts, pls = [], []
for f in sorted((root / 'js').glob('*.js')):
    if f.name in ('i18n-en.js',): continue
    src = f.read_text(encoding='utf-8')
    for m in T_RE.finditer(src):
        k = un(m.group(1))
        if k not in ts: ts.append(k)
    for m in PL_RE.finditer(src):
        k = [un(x) for x in m.groups()]
        if k[0] not in [p[0] for p in pls]: pls.append(k)
print(json.dumps({'t': ts, 'pl': pls}, ensure_ascii=False, indent=0))
