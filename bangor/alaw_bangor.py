# Alaw – přepis velšského zpěvu modelem Bangorské univerzity, přímo na tomto počítači.
# Spouští se přes alaw-bangor.bat. Poslouchá jen na http://127.0.0.1:8765 (z jiných počítačů nedostupný)
# a přijímá požadavky jen ze stránky aplikace Alaw. Nahrávky nikam neodcházejí.
#
# Rozhraní (pro aplikaci):
#   GET  /health            → { app, version, ready, stage, model, device, busy, words, vocals }
#   POST /transcribe?language=cy&prompt=…&words=1&vocals=0   (tělo = zvukový soubor) → { id }
#   GET  /jobs/<id>         → { state: queued|running|done|error, phase: vocals|transcribe, progress 0–1, segments[], vocals, error }
#   S words=1 má každý úsek i words: [{ start, end, word, p }] (časy slov – aplikace z nich doplní časy veršů textu).
#   Od 1.2 se před přepisem oddělí zpěv od hudby (Demucs, když je nainstalovaný; vocals=0 vypne). Whisper pak
#   neztrácí sloky, kde hudba hraje nahlas. Oddělení běží ve zvláštním procesu (python alaw_bangor.py --vocals vstup výstup),
#   aby se knihovny pro grafickou kartu nepletly s přepisem a paměť se po každé písni uvolnila. Když selže, přepisuje se původní nahrávka.
import glob
import importlib.util
import subprocess
import wave
import json
import logging
import os
import queue
import sys
import tempfile
import threading
import time
import traceback
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

VERSION = '1.2'
HOST = '127.0.0.1'
PORT = int(os.environ.get('ALAW_BANGOR_PORT', '8765'))
MODEL = os.environ.get('ALAW_BANGOR_MODEL', 'techiaith/whisper-large-ft-cy-en-ct2')
ALLOWED = ('https://tvspk.github.io',)
LOCAL_ORIGINS = ('http://localhost:', 'http://127.0.0.1:')
MAX_BYTES = 1024 * 1024 * 1024  # 1 GB
LANGS = {'cy', 'en'}            # model umí velštinu a angličtinu
SEP_MODEL = os.environ.get('ALAW_BANGOR_SEP', 'htdemucs')
SEP_TIMEOUT = 1800              # s – oddělení zpěvu jedné písně (na procesoru u dlouhé nahrávky i minuty)

state = {'ready': False, 'stage': 'start', 'device': None, 'error': None,
         'vocals': bool(importlib.util.find_spec('demucs') and importlib.util.find_spec('torch'))}
jobs = {}
work = queue.Queue()


def say(msg):
    print(time.strftime('%H:%M:%S'), msg, flush=True)


def add_cuda_dlls():
    # Knihovny CUDA z balíčků nvidia-cublas-cu12 / nvidia-cudnn-cu12 (instaluje je spouštěč, jen když je karta NVIDIA).
    if os.name != 'nt':
        return
    for d in glob.glob(os.path.join(sys.prefix, 'Lib', 'site-packages', 'nvidia', '*', 'bin')):
        try:
            os.add_dll_directory(d)
            os.environ['PATH'] = d + os.pathsep + os.environ.get('PATH', '')
        except OSError:
            pass


def load_model():
    add_cuda_dlls()
    os.environ.setdefault('HF_HUB_DISABLE_TELEMETRY', '1')
    logging.getLogger('huggingface_hub').setLevel(logging.ERROR)
    from faster_whisper import WhisperModel
    try:
        import ctranslate2
        gpu = ctranslate2.get_cuda_device_count() > 0
    except Exception:
        gpu = False
    state['stage'] = 'download'
    say(f'Připravuji model {MODEL} (poprvé se stahuje asi 1,6 GB – může to trvat i desítky minut)…')
    from huggingface_hub import snapshot_download
    path = snapshot_download(MODEL)
    state['stage'] = 'loading'
    say('Načítám model…')
    model = None
    if gpu:
        try:
            model = WhisperModel(path, device='cuda', compute_type='int8_float16')
            state['device'] = 'gpu'
        except Exception as e:
            say(f'Grafickou kartu se nepodařilo použít ({e}), počítám na procesoru.')
    if model is None:
        model = WhisperModel(path, device='cpu', compute_type='int8', cpu_threads=max(1, (os.cpu_count() or 2) - 1))
        state['device'] = 'cpu'
    state['ready'] = True
    state['stage'] = 'ready'
    say('Hotovo. Počítá na ' + ('grafické kartě.' if state['device'] == 'gpu' else 'procesoru (pomalejší, ale funguje).'))
    say(f'Program běží – nech toto okno otevřené. Aplikace Alaw ho najde na http://{HOST}:{PORT}')
    return model


def decode(src, rate, layout):
    # Nahrávka → float32 [kanály, vzorky] (PyAV je součástí faster-whisper).
    import av
    import numpy as np
    out = []
    with av.open(src) as c:
        rs = av.audio.resampler.AudioResampler(format='fltp', layout=layout, rate=rate)
        for frame in c.decode(audio=0):
            for f in rs.resample(frame):
                out.append(f.to_ndarray())
        for f in rs.resample(None):
            out.append(f.to_ndarray())
    if not out:
        raise RuntimeError('Nahrávka neobsahuje zvuk.')
    return np.concatenate(out, axis=1).astype('float32')


def separate(src, dst):
    # Běží ve zvláštním procesu: zpěv z nahrávky → mono WAV 16 kHz (to Whisper chce). Na konci vypíše DEVICE gpu|cpu.
    import numpy as np
    import torch
    from demucs.apply import apply_model
    from demucs.pretrained import get_model
    import julius
    model = get_model(SEP_MODEL)
    model.eval()
    x = torch.from_numpy(decode(src, model.samplerate, 'stereo' if model.audio_channels == 2 else 'mono'))
    ref = x.mean(0)
    mean, std = ref.mean(), ref.std() + 1e-8
    x = (x - mean) / std
    devices = (['cuda'] if torch.cuda.is_available() else []) + ['cpu']
    for dev in devices:
        try:
            with torch.no_grad():
                out = apply_model(model, x[None], device=dev, shifts=0, split=True, overlap=0.25, progress=False)[0]
            break
        except Exception as e:
            if dev == 'cpu':
                raise
            print('Grafická karta selhala, odděluji na procesoru:', e, flush=True)
            torch.cuda.empty_cache()
    voc = out[model.sources.index('vocals')].cpu() * std + mean
    y = julius.resample_frac(voc.mean(0), model.samplerate, 16000).numpy()
    pcm = (np.clip(y, -1, 1) * 32767).astype('<i2')
    with wave.open(dst, 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(16000)
        w.writeframes(pcm.tobytes())
    print('DEVICE', 'gpu' if dev == 'cuda' else 'cpu', flush=True)


def vocals_of(job):
    # Oddělí zpěv ve zvláštním procesu; vrátí cestu k WAV se zpěvem, nebo None (pak se přepisuje původní nahrávka).
    dst = job['file'] + '.vocals.wav'
    t0 = time.time()
    try:
        r = subprocess.run([sys.executable, os.path.abspath(__file__), '--vocals', job['file'], dst],
                           capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=SEP_TIMEOUT,
                           env={**os.environ, 'PYTHONIOENCODING': 'utf-8'})
    except subprocess.TimeoutExpired:
        say('Oddělení zpěvu trvalo moc dlouho – přepisuji původní nahrávku.')
        return None
    if r.returncode != 0 or not os.path.exists(dst) or os.path.getsize(dst) < 1000:
        last = [l for l in (r.stderr or r.stdout or '').strip().splitlines() if l.strip()][-1:]
        say('Zpěv se nepodařilo oddělit (' + (last[0][:200] if last else f'kód {r.returncode}') + ') – přepisuji původní nahrávku.')
        return None
    dev = 'grafické kartě' if 'DEVICE gpu' in r.stdout else 'procesoru'
    say(f'Zpěv oddělen od hudby ({round(time.time() - t0)} s na {dev}).')
    return dst


def worker():
    try:
        model = load_model()
    except Exception as e:
        state['stage'] = 'error'
        state['error'] = str(e)
        say('CHYBA při přípravě modelu: ' + str(e))
        traceback.print_exc()
        return
    while True:
        job = work.get()
        job['state'] = 'running'
        say(f'Přepisuji: {job["name"] or "nahrávka"}')
        audio = job['file']
        try:
            if job['vocals'] and state['vocals']:
                job['phase'] = 'vocals'
                say('Odděluji zpěv od hudby…')
                audio = vocals_of(job) or job['file']
                job['vocals_used'] = audio != job['file']
            job['phase'] = 'transcribe'
            opts = dict(beam_size=5, condition_on_previous_text=False, task='transcribe')
            if job['language'] in LANGS:
                opts['language'] = job['language']
            if job['prompt']:
                opts['initial_prompt'] = job['prompt']
            if job['words']:
                opts['word_timestamps'] = True
            segs, info = model.transcribe(audio, **opts)
            total = info.duration or 0
            for s in segs:
                job['segments'].append({
                    'start': round(s.start, 2), 'end': round(s.end, 2), 'text': s.text,
                    'avg_logprob': s.avg_logprob, 'no_speech_prob': s.no_speech_prob,
                    'compression_ratio': s.compression_ratio,
                    **({'words': [{'start': round(w.start, 2), 'end': round(w.end, 2), 'word': w.word,
                                   'p': round(w.probability, 3)} for w in (s.words or [])]} if job['words'] else {}),
                })
                if total:
                    job['progress'] = min(0.99, s.end / total)
            job['progress'] = 1
            job['state'] = 'done'
            say(f'Hotovo: {len(job["segments"])} úseků.')
        except Exception as e:
            job['state'] = 'error'
            job['error'] = str(e)[:300]
            say('Chyba přepisu: ' + str(e))
        finally:
            for f in (job['file'], job['file'] + '.vocals.wav'):
                try:
                    os.remove(f)
                except OSError:
                    pass
            job['done_at'] = time.time()
        # staré výsledky uklidit (hodina)
        for k in [k for k, j in jobs.items() if j.get('done_at') and time.time() - j['done_at'] > 3600]:
            jobs.pop(k, None)


def origin_ok(origin):
    return origin in ALLOWED or any(origin.startswith(p) for p in LOCAL_ORIGINS)


class Handler(BaseHTTPRequestHandler):
    server_version = 'AlawBangor/' + VERSION

    def log_message(self, *a):  # bez výpisu každého požadavku
        pass

    def cors(self):
        o = self.headers.get('Origin', '')
        if origin_ok(o):
            self.send_header('Access-Control-Allow-Origin', o)
            self.send_header('Vary', 'Origin')
            self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
            self.send_header('Access-Control-Allow-Headers', 'Content-Type')
            self.send_header('Access-Control-Allow-Private-Network', 'true')
            self.send_header('Access-Control-Max-Age', '600')

    def reply(self, code, data):
        body = json.dumps(data, ensure_ascii=False).encode('utf-8')
        self.send_response(code)
        self.cors()
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(body)

    def guard(self):
        o = self.headers.get('Origin')
        if o is not None and not origin_ok(o):
            self.reply(403, {'error': 'Jen pro aplikaci Alaw.'})
            return False
        return True

    def do_OPTIONS(self):
        self.send_response(204 if origin_ok(self.headers.get('Origin', '')) else 403)
        self.cors()
        self.send_header('Content-Length', '0')
        self.end_headers()

    def do_GET(self):
        if not self.guard():
            return
        path = urlparse(self.path).path.rstrip('/')
        if path == '/health':
            busy = sum(1 for j in jobs.values() if j['state'] in ('queued', 'running'))
            return self.reply(200, {'app': 'alaw-bangor', 'version': VERSION, 'model': MODEL, 'busy': busy, 'words': True, **state})
        if path.startswith('/jobs/'):
            job = jobs.get(path[6:])
            if not job:
                return self.reply(404, {'error': 'Úloha nenalezena (program se mezitím restartoval?).'})
            return self.reply(200, {**{k: job[k] for k in ('state', 'phase', 'progress', 'segments', 'error')}, 'vocals': job['vocals_used']})
        if path == '':
            return self.reply(200, {'app': 'alaw-bangor', 'version': VERSION})
        self.reply(404, {'error': 'Neznámá adresa.'})

    def do_POST(self):
        if not self.guard():
            return
        u = urlparse(self.path)
        if u.path.rstrip('/') != '/transcribe':
            return self.reply(404, {'error': 'Neznámá adresa.'})
        if state['stage'] == 'error':
            return self.reply(503, {'error': 'Model se nepodařilo připravit: ' + (state['error'] or '')})
        n = int(self.headers.get('Content-Length') or 0)
        if n <= 0:
            return self.reply(400, {'error': 'Chybí nahrávka.'})
        if n > MAX_BYTES:
            return self.reply(413, {'error': 'Nahrávka je moc velká.'})
        q = parse_qs(u.query)
        fd, fname = tempfile.mkstemp(prefix='alaw-', suffix='.audio')
        with os.fdopen(fd, 'wb') as f:
            left = n
            while left > 0:
                chunk = self.rfile.read(min(left, 1 << 20))
                if not chunk:
                    break
                f.write(chunk)
                left -= len(chunk)
        jid = uuid.uuid4().hex[:12]
        jobs[jid] = {'state': 'queued', 'phase': None, 'progress': 0, 'segments': [], 'error': None, 'file': fname,
                     'vocals': (q.get('vocals') or ['1'])[0] != '0', 'vocals_used': False,
                     'language': (q.get('language') or [''])[0], 'prompt': (q.get('prompt') or [''])[0][:200],
                     'name': (q.get('name') or [''])[0][:120], 'words': (q.get('words') or [''])[0] == '1'}
        work.put(jobs[jid])
        self.reply(200, {'id': jid})


def main():
    if len(sys.argv) == 4 and sys.argv[1] == '--vocals':
        separate(sys.argv[2], sys.argv[3])
        return 0
    say(f'Alaw – přepis Bangor {VERSION}')
    if not state['vocals']:
        say('Oddělení zpěvu od hudby (Demucs) není nainstalované – přepisuji původní nahrávky. Doinstaluje se při příštím spuštění alaw-bangor.bat.')
    try:
        srv = ThreadingHTTPServer((HOST, PORT), Handler)
    except OSError:
        say(f'Port {PORT} je obsazený – program už nejspíš běží v jiném okně. Toto okno můžeš zavřít.')
        return 1
    threading.Thread(target=worker, daemon=True).start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == '__main__':
    sys.exit(main())
