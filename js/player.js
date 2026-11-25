import { t } from './i18n.js';
// Jednotný přehrávač: vlastní zvukový soubor (Blob z IndexedDB) nebo video z YouTube.
// Ovládání: play, pause, toggle, seek(ms), playFrom(ms), setRate(r), setLoop(a, b)
// Události: onTime(ms), onState(playing), onReady(), onError(text), onEnded()
// Hrát smí vždy jen jeden přehrávač: když se jeden rozehraje, ostatní se pozastaví (Player.playing).

let ytApiPromise = null;
function loadYouTubeApi() {
  if (window.YT && window.YT.Player) return Promise.resolve(window.YT);
  if (ytApiPromise) return ytApiPromise;
  ytApiPromise = new Promise((resolve, reject) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { if (prev) prev(); resolve(window.YT); };
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    s.onerror = () => { ytApiPromise = null; reject(new Error(t('YouTube se nepodařilo načíst (jsi offline?)'))); };
    document.head.appendChild(s);
  });
  return ytApiPromise;
}

export const RATES = [0.5, 0.75, 1];

export class Player {
  static playing = new Set();

  constructor() {
    this.kind = null;
    this.ready = false;
    this.playing = false;
    this.rate = 1;
    this.loop = null; // { start, end }
    this.duration = null;
    this.onTime = () => {};
    this.onState = () => {};
    this.onReady = () => {};
    this.onError = () => {};
    this.onEnded = () => {};
    this._timer = null;
    this._objectUrl = null;
  }

  // ---------- načtení ----------

  loadAudio(blob) {
    this.destroy();
    this.kind = 'audio';
    const a = new Audio();
    a.preload = 'auto';
    a.preservesPitch = true;
    this._objectUrl = URL.createObjectURL(blob);
    a.src = this._objectUrl;
    a.addEventListener('loadedmetadata', () => {
      this.duration = isFinite(a.duration) ? a.duration * 1000 : null;
      this.ready = true;
      a.playbackRate = this.rate;
      this.onReady();
    });
    a.addEventListener('play', () => this._setPlaying(true));
    a.addEventListener('pause', () => this._setPlaying(false));
    a.addEventListener('ended', () => { this._setPlaying(false); this.onEnded(); });
    a.addEventListener('error', () => this.onError(t('Zvukový soubor nejde přehrát. Zkus jiný formát (mp3, m4a, ogg, wav).')));
    this.audio = a;
  }

  async loadYouTube(container, videoId) {
    this.destroy();
    this.kind = 'youtube';
    const token = (this._token = {});
    let YT;
    try { YT = await loadYouTubeApi(); } catch (e) { this.onError(e.message); return; }
    if (token !== this._token) return; // mezitím se načetlo něco jiného
    const host = document.createElement('div');
    container.replaceChildren(host);
    this.yt = new YT.Player(host, {
      videoId,
      width: '100%',
      height: '100%',
      playerVars: { playsinline: 1, rel: 0, modestbranding: 1, iv_load_policy: 3 },
      events: {
        onReady: () => {
          this.ready = true;
          this.duration = (this.yt.getDuration() || 0) * 1000 || null;
          this.yt.setPlaybackRate(this.rate);
          this.onReady();
        },
        onStateChange: e => {
          if (e.data === YT.PlayerState.PLAYING) {
            this.duration = (this.yt.getDuration() || 0) * 1000 || this.duration;
            this._setPlaying(true);
          } else if (e.data === YT.PlayerState.PAUSED) this._setPlaying(false);
          else if (e.data === YT.PlayerState.ENDED) { this._setPlaying(false); this.onEnded(); }
        },
        onError: e => {
          const msg = { 2: t('Neplatné ID videa.'), 5: t('Video nejde přehrát v tomto prohlížeči.'), 100: t('Video neexistuje nebo je soukromé.'), 101: t('Tohle video nejde přehrát mimo YouTube (autor to nepovolil). Zkus jiné video s toutéž písní.'), 150: t('Tohle video nejde přehrát mimo YouTube (autor to nepovolil). Zkus jiné video s toutéž písní.') }[e.data];
          this.onError(msg || t('Chyba YouTube ({c}).', { c: e.data }));
        },
      },
    });
  }

  destroy() {
    this._token = null;
    this._stopTimer();
    Player.playing.delete(this);
    if (this.audio) { this.audio.pause(); this.audio.removeAttribute('src'); this.audio.load(); this.audio = null; }
    if (this._objectUrl) { URL.revokeObjectURL(this._objectUrl); this._objectUrl = null; }
    if (this.yt) { try { this.yt.destroy(); } catch { /* nic */ } this.yt = null; }
    this.kind = null;
    this.ready = false;
    this.playing = false;
    this.duration = null;
  }

  // ---------- ovládání ----------

  time() {
    if (this.audio) return this.audio.currentTime * 1000;
    if (this.yt && this.ready) return (this.yt.getCurrentTime() || 0) * 1000;
    return 0;
  }

  play() {
    if (!this.ready) return;
    if (this.audio) this.audio.play().catch(() => {});
    else if (this.yt) this.yt.playVideo();
  }

  pause() {
    if (this.audio) this.audio.pause();
    else if (this.yt && this.ready) this.yt.pauseVideo();
  }

  toggle() { this.playing ? this.pause() : this.play(); }

  seek(ms) {
    if (!this.ready) return;
    const t = Math.max(0, ms) / 1000;
    if (this.audio) this.audio.currentTime = t;
    else if (this.yt) this.yt.seekTo(t, true);
    this.onTime(Math.max(0, ms));
  }

  playFrom(ms) { this.seek(ms); this.play(); }

  setRate(r) {
    this.rate = r;
    if (this.audio) this.audio.playbackRate = r;
    else if (this.yt && this.ready) this.yt.setPlaybackRate(r);
  }

  // Smyčka mezi start a end (ms). end = null → do konce nahrávky.
  setLoop(start, end) {
    this.loop = start == null ? null : { start, end };
  }

  // ---------- vnitřní ----------

  _setPlaying(p) {
    if (this.playing === p) return;
    this.playing = p;
    if (p) {
      for (const o of [...Player.playing]) if (o !== this) o.pause();
      Player.playing.add(this);
    } else Player.playing.delete(this);
    p ? this._startTimer() : this._stopTimer();
    this.onState(p);
  }

  _startTimer() {
    this._stopTimer();
    const tick = () => {
      let t = this.time();
      if (this.loop) {
        const end = this.loop.end ?? this.duration;
        if (end != null && t >= end - 60) { this.seek(this.loop.start); t = this.loop.start; }
        else if (t < this.loop.start - 1500) { this.seek(this.loop.start); t = this.loop.start; }
      }
      this.onTime(t);
    };
    this._timer = setInterval(tick, 50);
  }

  _stopTimer() {
    if (this._timer) clearInterval(this._timer);
    this._timer = null;
  }
}
