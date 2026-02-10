const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');
require('dotenv').config();

const { openDb } = require('./db/sqlite');
const { initSchema } = require('./db/init');
const { refreshBrief } = require('./jobs/refresh');
const { createUsageStatsCollector } = require('./lib/usageStats');

const createBriefRouter = require('./routes/brief');
const createRefreshRouter = require('./routes/refresh');

// Default: every 5 minutes (can override with AUTO_REFRESH_INTERVAL_MS in env)
const AUTO_REFRESH_INTERVAL_MS = Math.max(30_000, Number(process.env.AUTO_REFRESH_INTERVAL_MS || 5 * 60 * 1000));
const AUTO_REFRESH_PARAMS = {
  mode: 'execution',
  level: '3_5',
  itemCount: 100,
};

function parseTrustProxy(value) {
  if (value == null || value === '') return 1;
  const v = String(value).trim().toLowerCase();
  if (v === 'true') return true;
  if (v === 'false') return false;
  const n = Number(v);
  if (Number.isFinite(n)) return n;
  return value;
}

function normalizeIp(ip) {
  const s = String(ip || '').trim();
  if (!s) return '';
  // Typical Express values: "::1", "::ffff:1.2.3.4"
  if (s.startsWith('::ffff:')) return s.slice('::ffff:'.length);
  return s;
}

function firstXffIp(xff) {
  if (!xff) return '';
  const raw = Array.isArray(xff) ? xff[0] : String(xff);
  const first = raw.split(',')[0].trim();
  return normalizeIp(first);
}

function installAccessLogger(app, db) {
  const enabled = process.env.ACCESS_LOG_ENABLED !== '0';
  if (!enabled) return;

  const usage = createUsageStatsCollector(db, {
    flushIntervalMs: process.env.USAGE_FLUSH_MS ? Number(process.env.USAGE_FLUSH_MS) : 10_000,
  });

  let supabaseDisabled = false;

  app.use((req, res, next) => {
    // Only log API traffic; skip health checks to reduce noise.
    const url = String(req.originalUrl || '');
    if (!url.startsWith('/api/') || url === '/api/health') return next();

    const startedAt = Date.now();
    res.on('finish', () => {
      // Always collect daily usage stats (works even without extra tables).
      try {
        usage.recordFromRequest(req);
      } catch {
        // ignore
      }

      const createdAt = new Date().toISOString();
      const durationMs = Date.now() - startedAt;
      const ip =
        firstXffIp(req.headers && req.headers['x-forwarded-for']) ||
        normalizeIp(req.ip || req.socket?.remoteAddress || '');
      const row = {
        created_at: createdAt,
        ip: ip || '(unknown)',
        method: String(req.method || ''),
        path: String(req.path || ''),
        url,
        status: Number(res.statusCode || 0),
        duration_ms: Math.max(0, Math.floor(durationMs)),
        user_agent: String(req.headers['user-agent'] || ''),
        referer: String(req.headers.referer || req.headers.referrer || ''),
        x_forwarded_for: String(req.headers['x-forwarded-for'] || ''),
      };

      if (db.__kind === 'supabase') {
        if (supabaseDisabled) return;
        void db.raw
          .from('access_logs')
          .insert(row)
          .then(({ error }) => {
            if (!error) return;
            const msg = String(error.message || error || '');
            if (msg.toLowerCase().includes('access_logs') && msg.toLowerCase().includes('schema cache')) {
              supabaseDisabled = true;
              console.warn(
                '[access-log] disabled: Supabase table "access_logs" is missing. Run supabase/schema.sql to enable.'
              );
              return;
            }
            console.error('[access-log] insert failed:', error.message || error);
          })
          .catch((err) => console.error('[access-log] insert failed:', err?.message || err));
        return;
      }

      // sqlite
      const { run } = require('./db/sqlite');
      void run(
        db,
        `INSERT INTO access_logs
          (created_at, ip, method, path, url, status, duration_ms, user_agent, referer, x_forwarded_for)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          row.created_at,
          row.ip,
          row.method,
          row.path,
          row.url,
          row.status,
          row.duration_ms,
          row.user_agent,
          row.referer,
          row.x_forwarded_for,
        ]
      ).catch((err) => console.error('[access-log] insert failed:', err?.message || err));
    });

    next();
  });
}

function getTodayIsoDate() {
  return new Date().toISOString().split('T')[0];
}

function startAutoRefresh(db) {
  let running = false;
  let last = {
    running: false,
    last_reason: '',
    last_date: '',
    last_started_at: '',
    last_completed_at: '',
    last_ok: null,
    last_error: '',
    last_elapsed_ms: null,
    last_items_count: null,
  };

  const runAutoRefresh = async (reason) => {
    if (running) {
      console.log(`[auto-refresh] skipped (${reason}) because previous run is still in progress`);
      return;
    }

    running = true;
    last.running = true;
    const startedAt = Date.now();
    const date = getTodayIsoDate();
    last.last_reason = reason;
    last.last_date = date;
    last.last_started_at = new Date().toISOString();
    last.last_completed_at = '';
    last.last_ok = null;
    last.last_error = '';
    last.last_elapsed_ms = null;
    last.last_items_count = null;

    try {
      console.log(`[auto-refresh] started (${reason}) date=${date}`);
      const result = await refreshBrief({ ...AUTO_REFRESH_PARAMS, date }, db);
      const elapsed = Date.now() - startedAt;
      last.last_ok = true;
      last.last_elapsed_ms = elapsed;
      last.last_items_count = Number(result?.itemsCount ?? null);
      console.log(
        `[auto-refresh] completed (${reason}) date=${date} items=${result.itemsCount} elapsed_ms=${elapsed}`
      );
    } catch (err) {
      last.last_ok = false;
      last.last_error = String(err?.message || err || '');
      console.error(`[auto-refresh] failed (${reason}):`, err?.message || err);
    } finally {
      running = false;
      last.running = false;
      last.last_completed_at = new Date().toISOString();
    }
  };

  runAutoRefresh('startup');
  const timer = setInterval(() => {
    runAutoRefresh('interval');
  }, AUTO_REFRESH_INTERVAL_MS);

  if (typeof timer.unref === 'function') {
    timer.unref();
  }

  return {
    getStatus: () => ({ ...last, interval_ms: AUTO_REFRESH_INTERVAL_MS }),
  };
}

async function main() {
  const app = express();
  app.set('trust proxy', parseTrustProxy(process.env.TRUST_PROXY));
  app.use(cors());
  app.use(express.json({ limit: '1mb' }));

  const dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'brief.db');
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  const db = await openDb(dbPath);
  await initSchema(db);
  console.log(`[db] connected using ${db.__kind}`);

  installAccessLogger(app, db);

  app.get('/api/health', (req, res) => res.json({ ok: true }));

  app.use('/api', createBriefRouter(db));
  app.use('/api', createRefreshRouter(db));
  const autoRefresh = startAutoRefresh(db);
  app.get('/api/auto-refresh/status', (req, res) => {
    res.json({ ok: true, ...autoRefresh.getStatus() });
  });

  const frontendDist = path.join(__dirname, '..', 'frontend', 'dist');
  if (fs.existsSync(frontendDist)) {
    app.use(express.static(frontendDist));
    app.get(/.*/, (req, res) => {
      res.sendFile(path.join(frontendDist, 'index.html'));
    });
  }

  const port = process.env.PORT || 3001;
  const host = process.env.HOST || '0.0.0.0';
  app.listen(port, host, () => {
    console.log(`API server listening on http://${host}:${port}`);
  });
}

main().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
