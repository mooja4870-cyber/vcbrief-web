package com.vcbrief.app;

import android.content.Context;
import android.content.SharedPreferences;

import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.ExistingWorkPolicy;
import androidx.work.OneTimeWorkRequest;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.concurrent.TimeUnit;

@CapacitorPlugin(name = "BriefBackground")
public class BriefBackgroundPlugin extends Plugin {
    private static final String UNIQUE_WORK_NAME = "vcbrief.brief_refresh";

    private SharedPreferences prefs() {
        Context ctx = getContext();
        return ctx.getSharedPreferences(BriefRefreshWorker.PREFS_NAME, Context.MODE_PRIVATE);
    }

    private void ensureScheduled() {
        PeriodicWorkRequest req =
                new PeriodicWorkRequest.Builder(BriefRefreshWorker.class, 30, TimeUnit.MINUTES)
                        .setConstraints(BriefRefreshWorker.defaultConstraints())
                        .build();
        WorkManager.getInstance(getContext())
                .enqueueUniquePeriodicWork(UNIQUE_WORK_NAME, ExistingPeriodicWorkPolicy.UPDATE, req);
    }

    private void runOnce() {
        OneTimeWorkRequest req =
                new OneTimeWorkRequest.Builder(BriefRefreshWorker.class)
                        .setConstraints(BriefRefreshWorker.defaultConstraints())
                        .build();
        WorkManager.getInstance(getContext())
                .enqueueUniqueWork(UNIQUE_WORK_NAME + ".once", ExistingWorkPolicy.REPLACE, req);
    }

    @PluginMethod
    public void configure(PluginCall call) {
        String apiBase = call.getString("apiBase", "");
        Boolean enabled = call.getBoolean("enabled", true);

        if (apiBase == null) apiBase = "";
        apiBase = apiBase.trim().replaceAll("/+$", "");

        prefs().edit()
                .putString(BriefRefreshWorker.KEY_API_BASE, apiBase)
                .putBoolean(BriefRefreshWorker.KEY_ENABLED, enabled != null ? enabled : true)
                .apply();

        boolean isEnabled = enabled == null || enabled;
        if (!isEnabled || apiBase.isEmpty()) {
            WorkManager.getInstance(getContext()).cancelUniqueWork(UNIQUE_WORK_NAME);
            WorkManager.getInstance(getContext()).cancelUniqueWork(UNIQUE_WORK_NAME + ".once");
        } else {
            ensureScheduled();
            // Fetch immediately once so next app open is already warm.
            runOnce();
        }

        JSObject ret = new JSObject();
        ret.put("ok", true);
        call.resolve(ret);
    }

    @PluginMethod
    public void getCache(PluginCall call) {
        SharedPreferences p = prefs();
        JSObject ret = new JSObject();
        ret.put("json", p.getString(BriefRefreshWorker.KEY_CACHED_JSON, ""));
        ret.put("cachedAtMs", p.getLong(BriefRefreshWorker.KEY_CACHED_AT_MS, 0));
        ret.put("lastError", p.getString(BriefRefreshWorker.KEY_LAST_ERROR, ""));
        call.resolve(ret);
    }
}
