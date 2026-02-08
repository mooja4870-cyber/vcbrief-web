const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');
require('dotenv').config();

const { openDb } = require('./db/sqlite');
const { initSchema } = require('./db/init');
const { refreshBrief } = require('./jobs/refresh');

const createBriefRouter = require('./routes/brief');
const createRefreshRouter = require('./routes/refresh');

const AUTO_REFRESH_INTERVAL_MS = 30 * 60 * 1000;
const AUTO_REFRESH_PARAMS = {
  mode: 'execution',
  level: '3_5',
  itemCount: 100,
};

function getTodayIsoDate() {
  return new Date().toISOString().split('T')[0];
}

function startAutoRefresh(db) {
  let running = false;

  const runAutoRefresh = async (reason) => {
    if (running) {
      console.log(`[auto-refresh] skipped (${reason}) because previous run is still in progress`);
      return;
    }

    running = true;
    const startedAt = Date.now();
    const date = getTodayIsoDate();

    try {
      console.log(`[auto-refresh] started (${reason}) date=${date}`);
      const result = await refreshBrief({ ...AUTO_REFRESH_PARAMS, date }, db);
      const elapsed = Date.now() - startedAt;
      console.log(
        `[auto-refresh] completed (${reason}) date=${date} items=${result.itemsCount} elapsed_ms=${elapsed}`
      );
    } catch (err) {
      console.error(`[auto-refresh] failed (${reason}):`, err?.message || err);
    } finally {
      running = false;
    }
  };

  runAutoRefresh('startup');
  const timer = setInterval(() => {
    runAutoRefresh('interval');
  }, AUTO_REFRESH_INTERVAL_MS);

  if (typeof timer.unref === 'function') {
    timer.unref();
  }
}

async function main() {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '1mb' }));

  const dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'brief.db');
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  const db = await openDb(dbPath);
  await initSchema(db);
  console.log(`[db] connected using ${db.__kind}`);

  app.get('/api/health', (req, res) => res.json({ ok: true }));

  app.use('/api', createBriefRouter(db));
  app.use('/api', createRefreshRouter(db));
  startAutoRefresh(db);

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

