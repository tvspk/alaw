package cz.tvspk.alaw;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.util.Base64;
import android.view.View;
import android.view.Window;
import android.view.WindowInsetsController;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.content.pm.PackageManager;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.util.Iterator;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Alaw pro Android: webová aplikace z assets ve WebView.
 * Stránka se servíruje z https://appassets.androidplatform.net/ (ne file://), aby fungovalo YouTube
 * (vyžaduje skutečnou https adresu) a úložiště prohlížeče (IndexedDB).
 * Most window.AlawAndroid: stahování cizích stránek bez omezení CORS, ukládání souborů, verze, sdílení.
 */
public class MainActivity extends Activity {
    private static final String HOST = "appassets.androidplatform.net";
    private static final String HOME = "https://" + HOST + "/index.html";
    private static final int REQ_FILE = 11, REQ_SAVE = 12, REQ_CAMERA = 13;
    private static final int MAX_BYTES = 5 * 1024 * 1024;
    private static final String UA = "AlawLyrics/0.2 (+https://github.com/tvspk/alaw)";

    private WebView web;
    private static MainActivity current;      // pro ovládání z oznámení přehrávání (PlaybackService)
    private volatile boolean mediaActive;     // běží náhodné přehrávání → při zhasnutí WebView neuspávat
    private static final int REQ_NOTIFY = 14;
    private ValueCallback<Uri[]> fileCallback;
    private byte[] pendingSave;
    private PermissionRequest pendingCamera;
    private final ExecutorService pool = Executors.newFixedThreadPool(6);

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        web = new WebView(this);
        web.setBackgroundColor(Color.parseColor("#f5f2ea"));
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setTextZoom(100);
        s.setSupportZoom(false);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(true); // výběr zvukového souboru (content://)
        s.setGeolocationEnabled(false);

        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest r) {
                Uri u = r.getUrl();
                if (!HOST.equals(u.getHost())) return null;
                String path = u.getPath();
                if (path == null || path.equals("/") || path.isEmpty()) path = "/index.html";
                if (path.contains("..")) return null;
                try {
                    InputStream in = getAssets().open("www" + path);
                    return new WebResourceResponse(mime(path), mime(path).startsWith("text/") || path.endsWith(".js") || path.endsWith(".webmanifest") ? "utf-8" : null, in);
                } catch (Exception e) {
                    return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found", null, null);
                }
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
                if (!r.isForMainFrame()) return false;
                Uri u = r.getUrl();
                if (HOST.equals(u.getHost())) return false;
                // odkazy ven (zdroj textu, Google AI Studio…) do prohlížeče
                try { startActivity(new Intent(Intent.ACTION_VIEW, u)); } catch (Exception e) { /* žádný prohlížeč */ }
                return true;
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            /** Kamera pro QR párování: jen pro vlastní stránku, oprávnění Androidu se žádá až při skenování. */
            @Override
            public void onPermissionRequest(final PermissionRequest r) {
                runOnUiThread(new Runnable() {
                    public void run() {
                        Uri o = r.getOrigin();
                        boolean video = false;
                        for (String res : r.getResources()) if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(res)) video = true;
                        if (o == null || !HOST.equals(o.getHost()) || !video) { r.deny(); return; }
                        if (checkSelfPermission(android.Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
                            r.grant(new String[]{ PermissionRequest.RESOURCE_VIDEO_CAPTURE });
                        } else {
                            pendingCamera = r;
                            requestPermissions(new String[]{ android.Manifest.permission.CAMERA }, REQ_CAMERA);
                        }
                    }
                });
            }

            @Override
            public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> cb, FileChooserParams p) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = cb;
                String type = "*/*";
                for (String a : p.getAcceptTypes()) if (a != null && a.startsWith("audio")) { type = "audio/*"; break; }
                Intent i = new Intent(Intent.ACTION_GET_CONTENT);
                i.addCategory(Intent.CATEGORY_OPENABLE);
                i.setType(type);
                if (p.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE) i.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
                try { startActivityForResult(Intent.createChooser(i, null), REQ_FILE); }
                catch (Exception e) { fileCallback = null; return false; }
                return true;
            }
        });

        current = this;
        web.addJavascriptInterface(new Bridge(), "AlawAndroid");
        setContentView(web);
        if (state != null) web.restoreState(state);
        if (web.getUrl() == null) web.loadUrl(HOME + shareQuery(getIntent()));
    }

    private static String mime(String path) {
        if (path.endsWith(".html")) return "text/html";
        if (path.endsWith(".js")) return "text/javascript";
        if (path.endsWith(".css")) return "text/css";
        if (path.endsWith(".png")) return "image/png";
        if (path.endsWith(".svg")) return "image/svg+xml";
        if (path.endsWith(".json") || path.endsWith(".webmanifest")) return "application/json";
        return "application/octet-stream";
    }

    // ---------- sdílení z jiné aplikace (Sdílet → Alaw) ----------

    private static String[] shared(Intent i) {
        if (i == null || !Intent.ACTION_SEND.equals(i.getAction())) return null;
        String text = i.getStringExtra(Intent.EXTRA_TEXT);
        if (text == null) return null;
        Matcher m = Pattern.compile("https?://\\S+").matcher(text);
        return new String[]{ m.find() ? m.group() : "", text };
    }

    private static String shareQuery(Intent i) {
        String[] s = shared(i);
        if (s == null) return "";
        try {
            return "?share-url=" + URLEncoder.encode(s[0], "UTF-8") + "&share-text=" + URLEncoder.encode(s[1], "UTF-8");
        } catch (Exception e) { return ""; }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        String[] s = shared(intent);
        if (s != null && web != null) {
            web.evaluateJavascript("window.alawShare&&window.alawShare(" + JSONObject.quote(s[0]) + "," + JSONObject.quote(s[1]) + ")", null);
        }
    }

    // ---------- most do JS ----------

    private class Bridge {
        /** Stáhne stránku (bez omezení CORS). Výsledek: window.__alawNet(id, JSON {status, text, url} | {error}). */
        @JavascriptInterface
        public void fetch(final int id, final String reqJson) {
            pool.execute(new Runnable() {
                public void run() { deliver(id, doFetch(reqJson)); }
            });
        }

        @JavascriptInterface
        public String version() {
            try { return getPackageManager().getPackageInfo(getPackageName(), 0).versionName; }
            catch (Exception e) { return ""; }
        }

        /** Otevře stažení nové verze v prohlížeči; jen vydání tohoto projektu. */
        @JavascriptInterface
        public void open(final String url) {
            if (url == null || !url.startsWith("https://github.com/tvspk/alaw/releases/")) return;
            runOnUiThread(new Runnable() {
                public void run() {
                    try { startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url))); } catch (Exception e) { /* nic */ }
                }
            });
        }

        /** Uloží soubor (záloha, .lrc): uživatel vybere, kam. */
        @JavascriptInterface
        public void saveFile(final String name, final String mime, final String base64) {
            runOnUiThread(new Runnable() {
                public void run() {
                    pendingSave = Base64.decode(base64, Base64.DEFAULT);
                    Intent i = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                    i.addCategory(Intent.CATEGORY_OPENABLE);
                    i.setType(mime == null || mime.isEmpty() ? "application/octet-stream" : mime);
                    i.putExtra(Intent.EXTRA_TITLE, name);
                    try { startActivityForResult(i, REQ_SAVE); } catch (Exception e) { pendingSave = null; }
                }
            });
        }

        // Náhodné přehrávání (0.18): stav z radio.js → služba s oznámením; „stopped“ = konec.
        // JSON { state: playing|paused|stopped, title, artist, labels: [předchozí, přehrát, pozastavit, další, ukončit] }
        @JavascriptInterface
        public void media(final String json) {
            runOnUiThread(new Runnable() {
                public void run() {
                    try {
                        JSONObject o = new JSONObject(json);
                        String st = o.optString("state");
                        if ("stopped".equals(st)) { mediaActive = false; PlaybackService.stop(); return; }
                        mediaActive = true;
                        boolean playing = "playing".equals(st);
                        String[] labels = null;
                        org.json.JSONArray la = o.optJSONArray("labels");
                        if (la != null && la.length() == 5) { labels = new String[5]; for (int i = 0; i < 5; i++) labels[i] = la.optString(i); }
                        PlaybackService s = PlaybackService.instance;
                        if (s != null) { s.update(o.optString("title"), o.optString("artist"), playing, labels); return; }
                        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission("android.permission.POST_NOTIFICATIONS") != PackageManager.PERMISSION_GRANTED)
                            requestPermissions(new String[]{ "android.permission.POST_NOTIFICATIONS" }, REQ_NOTIFY);
                        Intent i = new Intent(MainActivity.this, PlaybackService.class)
                            .putExtra("title", o.optString("title")).putExtra("artist", o.optString("artist"))
                            .putExtra("playing", playing).putExtra("labels", labels);
                        startForegroundService(i);
                    } catch (Exception e) { /* služba nejde spustit – přehrávání jen s rozsvícenou obrazovkou */ }
                }
            });
        }

        // Zpěvník (0.17): tisk stránky přes systémový tisk Androidu (volba „Uložit jako PDF“)
        @JavascriptInterface
        public void print(final String title) {
            runOnUiThread(new Runnable() {
                public void run() {
                    String name = (title == null || title.isEmpty()) ? "Alaw" : title;
                    android.print.PrintManager pm = (android.print.PrintManager) getSystemService(PRINT_SERVICE);
                    if (pm != null) pm.print(name, web.createPrintDocumentAdapter(name), null);
                }
            });
        }

        @JavascriptInterface
        public void setBars(final String color, final boolean light) {
            runOnUiThread(new Runnable() {
                public void run() { applyBars(color, light); }
            });
        }
    }

    private String doFetch(String reqJson) {
        HttpURLConnection c = null;
        try {
            JSONObject req = new JSONObject(reqJson);
            String url = req.getString("url");
            if (!url.startsWith("https://") && !url.startsWith("http://")) return err("Neplatná adresa.");
            String method = req.optString("method", "GET");
            for (int hop = 0; hop < 6; hop++) {
                c = (HttpURLConnection) new URL(url).openConnection();
                c.setInstanceFollowRedirects(false);
                c.setConnectTimeout(15000);
                c.setReadTimeout(20000);
                c.setRequestMethod(method);
                c.setRequestProperty("User-Agent", UA);
                c.setRequestProperty("Accept-Language", "cy,en;q=0.8,cs;q=0.6");
                JSONObject h = req.optJSONObject("headers");
                if (h != null) for (Iterator<String> it = h.keys(); it.hasNext(); ) { String k = it.next(); c.setRequestProperty(k, h.getString(k)); }
                String body = req.isNull("body") ? null : req.optString("body", null);
                if (body != null && method.equals("POST")) {
                    c.setDoOutput(true);
                    OutputStream os = c.getOutputStream();
                    os.write(body.getBytes("UTF-8"));
                    os.close();
                }
                int code = c.getResponseCode();
                if (code >= 300 && code < 400 && c.getHeaderField("Location") != null) {
                    url = new URL(new URL(url), c.getHeaderField("Location")).toString();
                    c.disconnect();
                    if (code != 307 && code != 308) method = "GET";
                    continue;
                }
                InputStream in = code >= 400 ? c.getErrorStream() : c.getInputStream();
                ByteArrayOutputStream bo = new ByteArrayOutputStream();
                if (in != null) {
                    byte[] buf = new byte[16384];
                    int n;
                    while ((n = in.read(buf)) > 0) {
                        bo.write(buf, 0, n);
                        if (bo.size() > MAX_BYTES) break;
                    }
                    in.close();
                }
                String charset = "UTF-8";
                String ct = c.getContentType();
                if (ct != null) {
                    Matcher m = Pattern.compile("charset=([\\w-]+)", Pattern.CASE_INSENSITIVE).matcher(ct);
                    if (m.find()) charset = m.group(1);
                }
                JSONObject res = new JSONObject();
                res.put("status", code);
                res.put("url", url);
                res.put("text", new String(bo.toByteArray(), charset));
                return res.toString();
            }
            return err("Příliš mnoho přesměrování.");
        } catch (java.net.UnknownHostException e) {
            return err("Jsi offline nebo web neexistuje.");
        } catch (java.net.SocketTimeoutException e) {
            return err("Web neodpovídá.");
        } catch (Exception e) {
            return err("Chyba: " + e.getClass().getSimpleName());
        } finally {
            if (c != null) c.disconnect();
        }
    }

    private static String err(String msg) {
        try { JSONObject o = new JSONObject(); o.put("error", msg); return o.toString(); } catch (Exception e) { return "{\"error\":\"?\"}"; }
    }

    private void deliver(final int id, final String json) {
        runOnUiThread(new Runnable() {
            public void run() {
                if (web != null) web.evaluateJavascript("window.__alawNet&&window.__alawNet(" + id + "," + JSONObject.quote(json) + ")", null);
            }
        });
    }

    private void applyBars(String color, boolean light) {
        try {
            int c = Color.parseColor(color.trim());
            Window w = getWindow();
            w.setStatusBarColor(c);
            w.setNavigationBarColor(c);
            web.setBackgroundColor(c);
            if (Build.VERSION.SDK_INT >= 30) {
                WindowInsetsController ic = w.getInsetsController();
                int mask = WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS;
                if (ic != null) ic.setSystemBarsAppearance(light ? mask : 0, mask);
            } else {
                View d = w.getDecorView();
                int f = d.getSystemUiVisibility();
                int bits = View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
                d.setSystemUiVisibility(light ? (f | bits) : (f & ~bits));
            }
        } catch (Exception e) { /* neplatná barva */ }
    }

    @Override
    protected void onActivityResult(int req, int result, Intent data) {
        if (req == REQ_FILE) {
            if (fileCallback != null) {
                Uri[] uris = null;
                if (result == RESULT_OK && data != null && data.getClipData() != null) {
                    android.content.ClipData clip = data.getClipData();
                    uris = new Uri[clip.getItemCount()];
                    for (int k = 0; k < uris.length; k++) uris[k] = clip.getItemAt(k).getUri();
                } else uris = WebChromeClient.FileChooserParams.parseResult(result, data);
                fileCallback.onReceiveValue(uris);
            }
            fileCallback = null;
        } else if (req == REQ_SAVE) {
            final byte[] bytes = pendingSave;
            pendingSave = null;
            if (result != RESULT_OK || data == null || data.getData() == null || bytes == null) return;
            final Uri uri = data.getData();
            pool.execute(new Runnable() {
                public void run() {
                    boolean ok;
                    try { OutputStream os = getContentResolver().openOutputStream(uri); os.write(bytes); os.close(); ok = true; }
                    catch (Exception e) { ok = false; }
                    final boolean done = ok;
                    runOnUiThread(new Runnable() {
                        public void run() { if (web != null) web.evaluateJavascript("window.alawSaved&&window.alawSaved(" + done + ")", null); }
                    });
                }
            });
        }
    }

    @Override
    public void onRequestPermissionsResult(int req, String[] perms, int[] res) {
        if (req != REQ_CAMERA || pendingCamera == null) return;
        if (res.length > 0 && res[0] == PackageManager.PERMISSION_GRANTED) pendingCamera.grant(new String[]{ PermissionRequest.RESOURCE_VIDEO_CAPTURE });
        else pendingCamera.deny();
        pendingCamera = null;
    }

    @Override
    public void onBackPressed() {
        web.evaluateJavascript("(window.alawBack&&window.alawBack())?'1':'0'", new ValueCallback<String>() {
            public void onReceiveValue(String r) {
                if (r == null || !r.contains("1")) moveTaskToBack(true);
            }
        });
    }

    @Override
    protected void onPause() {
        super.onPause();
        if (!mediaActive) web.onPause(); // při náhodném přehrávání hraje dál i se zhasnutou obrazovkou
    }

    /** Tlačítko v oznámení / sluchátkách → stránka (radio.js: window.alawMedia). */
    static void media(final String cmd) {
        final MainActivity a = current;
        if (a == null || a.web == null || !cmd.matches("[a-z]+")) return;
        a.runOnUiThread(new Runnable() {
            public void run() { a.web.evaluateJavascript("window.alawMedia&&window.alawMedia('" + cmd + "')", null); }
        });
    }

    @Override
    protected void onResume() { super.onResume(); web.onResume(); }

    @Override
    protected void onSaveInstanceState(Bundle out) { super.onSaveInstanceState(out); web.saveState(out); }

    @Override
    protected void onDestroy() {
        if (current == this) current = null;
        PlaybackService.stop(); // bez stránky nemá přehrávání kdo hrát
        pool.shutdownNow();
        if (web != null) { web.destroy(); web = null; }
        super.onDestroy();
    }
}
