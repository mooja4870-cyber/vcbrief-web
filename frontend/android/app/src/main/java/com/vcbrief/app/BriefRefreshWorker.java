package com.vcbrief.app;

import android.content.Context;
import android.content.SharedPreferences;

import androidx.annotation.NonNull;
import androidx.work.Constraints;
import androidx.work.NetworkType;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.Calendar;
import java.util.Locale;

public class BriefRefreshWorker extends Worker {
    static final String PREFS_NAME = "vcbrief.bg";
    static final String KEY_API_BASE = "apiBase";
    static final String KEY_ENABLED = "enabled";
    static final String KEY_CACHED_JSON = "cachedJson";
    static final String KEY_CACHED_AT_MS = "cachedAtMs";
    static final String KEY_LAST_ERROR = "lastError";

    public BriefRefreshWorker(@NonNull Context context, @NonNull WorkerParameters params) {
        super(context, params);
    }

    static Constraints defaultConstraints() {
        return new Constraints.Builder()
                .setRequiredNetworkType(NetworkType.CONNECTED)
                .build();
    }

    private static String todayIsoDate() {
        Calendar c = Calendar.getInstance();
        int y = c.get(Calendar.YEAR);
        int m = c.get(Calendar.MONTH) + 1;
        int d = c.get(Calendar.DAY_OF_MONTH);
        return String.format(Locale.US, "%04d-%02d-%02d", y, m, d);
    }

    @NonNull
    @Override
    public Result doWork() {
        Context ctx = getApplicationContext();
        SharedPreferences prefs = ctx.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);

        boolean enabled = prefs.getBoolean(KEY_ENABLED, true);
        if (!enabled) return Result.success();

        String apiBase = prefs.getString(KEY_API_BASE, "");
        if (apiBase == null) apiBase = "";
        apiBase = apiBase.trim().replaceAll("/+$", "");
        if (apiBase.isEmpty()) return Result.success();

        HttpURLConnection conn = null;
        try {
            String date = todayIsoDate();
            String qs = "date=" + URLEncoder.encode(date, "UTF-8")
                    + "&mode=" + URLEncoder.encode("execution", "UTF-8")
                    + "&level=" + URLEncoder.encode("3_5", "UTF-8")
                    + "&itemCount=" + URLEncoder.encode("100", "UTF-8");
            String urlStr = apiBase + "/api/brief?" + qs;

            URL url = new URL(urlStr);
            conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("GET");
            conn.setConnectTimeout(10_000);
            conn.setReadTimeout(15_000);

            int code = conn.getResponseCode();
            if (code < 200 || code >= 300) {
                prefs.edit().putString(KEY_LAST_ERROR, "http_" + code).apply();
                // Retry only on transient server errors.
                return code >= 500 ? Result.retry() : Result.success();
            }

            BufferedReader reader = new BufferedReader(
                    new InputStreamReader(conn.getInputStream(), StandardCharsets.UTF_8)
            );
            StringBuilder sb = new StringBuilder();
            String line;
            while ((line = reader.readLine()) != null) {
                sb.append(line);
            }
            reader.close();

            prefs.edit()
                    .putString(KEY_CACHED_JSON, sb.toString())
                    .putLong(KEY_CACHED_AT_MS, System.currentTimeMillis())
                    .putString(KEY_LAST_ERROR, "")
                    .apply();

            return Result.success();
        } catch (Exception e) {
            prefs.edit().putString(KEY_LAST_ERROR, String.valueOf(e.getMessage())).apply();
            return Result.retry();
        } finally {
            if (conn != null) conn.disconnect();
        }
    }
}

