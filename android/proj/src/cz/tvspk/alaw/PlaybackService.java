package cz.tvspk.alaw;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.media.MediaMetadata;
import android.media.session.MediaSession;
import android.media.session.PlaybackState;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;

/**
 * Náhodné přehrávání se zhasnutou obrazovkou (0.18): služba na popředí s oznámením (⏮ ⏯ ⏭ ✕, i na zamčené obrazovce),
 * MediaSession pro tlačítka sluchátek a hodinek a částečný wake lock, aby se mezi písněmi stihla načíst další.
 * Zvuk dál hraje WebView (aplikace se při zhasnutí neuspí – MainActivity.onPause). Ovládání se posílá do stránky
 * přes MainActivity.media(cmd) → window.alawMedia(cmd).
 */
public class PlaybackService extends Service {
    static PlaybackService instance;
    private static final String CHANNEL = "alaw-playback";
    private static final int NOTE_ID = 1;
    static final String EXTRA_CMD = "cmd";

    private MediaSession session;
    private PowerManager.WakeLock lock;
    private String title = "Alaw", artist = "", lPrev = "⏮", lPlay = "▶", lPause = "⏸", lNext = "⏭", lStop = "✕";
    private boolean playing;

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
        NotificationManager nm = getSystemService(NotificationManager.class);
        if (nm != null && nm.getNotificationChannel(CHANNEL) == null) {
            NotificationChannel ch = new NotificationChannel(CHANNEL, "Alaw", NotificationManager.IMPORTANCE_LOW);
            ch.setShowBadge(false);
            nm.createNotificationChannel(ch);
        }
        session = new MediaSession(this, "Alaw");
        session.setCallback(new MediaSession.Callback() {
            @Override public void onPlay() { MainActivity.media("play"); }
            @Override public void onPause() { MainActivity.media("pause"); }
            @Override public void onSkipToNext() { MainActivity.media("next"); }
            @Override public void onSkipToPrevious() { MainActivity.media("prev"); }
            @Override public void onStop() { MainActivity.media("stop"); }
        });
        session.setActive(true);
        PowerManager pm = getSystemService(PowerManager.class);
        if (pm != null) {
            lock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "alaw:playback");
            lock.setReferenceCounted(false);
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String cmd = intent != null ? intent.getStringExtra(EXTRA_CMD) : null;
        if (cmd != null) MainActivity.media(cmd); // tlačítko v oznámení
        else if (intent != null) update(intent.getStringExtra("title"), intent.getStringExtra("artist"),  // první spuštění z MainActivity
            intent.getBooleanExtra("playing", false), intent.getStringArrayExtra("labels"));
        else show();
        return START_NOT_STICKY;
    }

    /** Nový stav z aplikace (název, interpret, hraje/pauza, popisky tlačítek v jazyce rozhraní). */
    void update(String title, String artist, boolean playing, String[] labels) {
        this.title = title == null || title.isEmpty() ? "Alaw" : title;
        this.artist = artist == null ? "" : artist;
        this.playing = playing;
        if (labels != null && labels.length == 5) { lPrev = labels[0]; lPlay = labels[1]; lPause = labels[2]; lNext = labels[3]; lStop = labels[4]; }
        show();
    }

    private PendingIntent action(String cmd, int code) {
        Intent i = new Intent(this, PlaybackService.class).putExtra(EXTRA_CMD, cmd);
        return PendingIntent.getService(this, code, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private void show() {
        session.setMetadata(new MediaMetadata.Builder()
            .putString(MediaMetadata.METADATA_KEY_TITLE, title)
            .putString(MediaMetadata.METADATA_KEY_ARTIST, artist)
            .putString(MediaMetadata.METADATA_KEY_ALBUM, "Alaw")
            .build());
        session.setPlaybackState(new PlaybackState.Builder()
            .setActions(PlaybackState.ACTION_PLAY | PlaybackState.ACTION_PAUSE | PlaybackState.ACTION_PLAY_PAUSE
                | PlaybackState.ACTION_SKIP_TO_NEXT | PlaybackState.ACTION_SKIP_TO_PREVIOUS | PlaybackState.ACTION_STOP)
            .setState(playing ? PlaybackState.STATE_PLAYING : PlaybackState.STATE_PAUSED, PlaybackState.PLAYBACK_POSITION_UNKNOWN, 1f)
            .build());

        Intent open = new Intent(this, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent content = PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification n = new Notification.Builder(this, CHANNEL)
            .setSmallIcon(android.R.drawable.ic_media_play)
            .setContentTitle(title)
            .setContentText(artist)
            .setContentIntent(content)
            .setOngoing(true)
            .setShowWhen(false)
            .setVisibility(Notification.VISIBILITY_PUBLIC)
            .setCategory(Notification.CATEGORY_TRANSPORT)
            .addAction(btn(android.R.drawable.ic_media_previous, lPrev, "prev", 1))
            .addAction(playing ? btn(android.R.drawable.ic_media_pause, lPause, "pause", 2) : btn(android.R.drawable.ic_media_play, lPlay, "play", 2))
            .addAction(btn(android.R.drawable.ic_media_next, lNext, "next", 3))
            .addAction(btn(android.R.drawable.ic_menu_close_clear_cancel, lStop, "stop", 4))
            .setStyle(new Notification.MediaStyle().setMediaSession(session.getSessionToken()).setShowActionsInCompactView(0, 1, 2))
            .build();
        if (Build.VERSION.SDK_INT >= 29) startForeground(NOTE_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
        else startForeground(NOTE_ID, n);
        // Procesor drží během přehrávání. Mezi písněmi hlásí přehrávač na chvilku „pauza“ → pustit ho až po 15 s pauzy.
        handler.removeCallbacks(releaseLock);
        if (lock != null) { if (playing) lock.acquire(4 * 60 * 60 * 1000L); else handler.postDelayed(releaseLock, 15000); }
    }

    private final android.os.Handler handler = new android.os.Handler(android.os.Looper.getMainLooper());
    private final Runnable releaseLock = new Runnable() { public void run() { if (lock != null && lock.isHeld()) lock.release(); } };

    private Notification.Action btn(int icon, String label, String cmd, int code) {
        return new Notification.Action.Builder(android.graphics.drawable.Icon.createWithResource(this, icon), label, action(cmd, code)).build();
    }

    /** Konec náhodného přehrávání. */
    static void stop() {
        PlaybackService s = instance;
        if (s == null) return;
        s.stopForeground(STOP_FOREGROUND_REMOVE);
        s.stopSelf();
    }

    @Override
    public void onTaskRemoved(Intent root) { stopForeground(STOP_FOREGROUND_REMOVE); stopSelf(); }

    @Override
    public void onDestroy() {
        handler.removeCallbacks(releaseLock);
        if (lock != null && lock.isHeld()) lock.release();
        if (session != null) { session.setActive(false); session.release(); }
        if (instance == this) instance = null;
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent i) { return null; }
}
