const { get, run } = require('../db/sqlite');

function getTodayIsoDate() {
  return new Date().toISOString().split('T')[0];
}

function safeParseJson(s) {
  try {
    return JSON.parse(String(s || ''));
  } catch {
    return null;
  }
}

function inc(map, key, by = 1) {
  const k = String(key || '(empty)');
  map.set(k, (map.get(k) || 0) + by);
}

function mergeCounts(dst, src) {
  const out = { ...(dst || {}) };
  for (const [k, v] of Object.entries(src || {})) {
    out[k] = (out[k] || 0) + (Number(v) || 0);
  }
  return out;
}

async function loadDailyUsage(db, date) {
  const mode = 'usage';
  const level = 'ip';

  if (db.__kind === 'supabase') {
    const { data, error } = await db.raw
      .from('daily_briefs')
      .select('json')
      .eq('date', date)
      .eq('mode', mode)
      .eq('level', level)
      .limit(1);
    if (error) throw error;
    if (!data || !data.length) return { ipCounts: {}, pathCounts: {} };
    const parsed = safeParseJson(data[0]?.json);
    return {
      ipCounts: parsed?.ipCounts && typeof parsed.ipCounts === 'object' ? parsed.ipCounts : {},
      pathCounts: parsed?.pathCounts && typeof parsed.pathCounts === 'object' ? parsed.pathCounts : {},
    };
  }

  const row = await get(db, `SELECT json FROM daily_briefs WHERE date = ? AND mode = ? AND level = ?`, [date, mode, level]);
  const parsed = safeParseJson(row?.json);
  return {
    ipCounts: parsed?.ipCounts && typeof parsed.ipCounts === 'object' ? parsed.ipCounts : {},
    pathCounts: parsed?.pathCounts && typeof parsed.pathCounts === 'object' ? parsed.pathCounts : {},
  };
}

async function saveDailyUsage(db, date, ipCounts, pathCounts) {
  const mode = 'usage';
  const level = 'ip';
  const now = new Date().toISOString();
  const json = JSON.stringify({
    kind: 'usage_v1',
    date,
    updated_at: now,
    ipCounts: ipCounts || {},
    pathCounts: pathCounts || {},
  });

  if (db.__kind === 'supabase') {
    const { error } = await db.raw
      .from('daily_briefs')
      .upsert({ date, mode, level, json, created_at: now }, { onConflict: 'date,mode,level' });
    if (error) throw error;
    return;
  }

  await run(
    db,
    `INSERT INTO daily_briefs (date, mode, level, json, created_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(date, mode, level) DO UPDATE SET json=excluded.json, created_at=excluded.created_at`,
    [date, mode, level, json, now]
  );
}

function normalizeIp(ip) {
  const s = String(ip || '').trim();
  if (!s) return '';
  if (s.startsWith('::ffff:')) return s.slice('::ffff:'.length);
  return s;
}

function firstXffIp(xff) {
  if (!xff) return '';
  const raw = Array.isArray(xff) ? xff[0] : String(xff);
  const first = raw.split(',')[0].trim();
  return normalizeIp(first);
}

function createUsageStatsCollector(db, opts = {}) {
  const flushIntervalMs = Math.max(1000, Number(opts.flushIntervalMs || 10_000));
  const maxKeys = Math.max(1000, Number(opts.maxKeys || 10_000));

  let currentDate = getTodayIsoDate();
  let pendingIp = new Map();
  let pendingPath = new Map();
  let flushing = false;

  const timer = setInterval(() => {
    void flush();
  }, flushIntervalMs);
  if (typeof timer.unref === 'function') timer.unref();

  function record({ ip, path }) {
    const date = getTodayIsoDate();
    if (date !== currentDate) {
      // Day rollover: flush old day stats first.
      void flush().finally(() => {
        currentDate = date;
        pendingIp = new Map();
        pendingPath = new Map();
      });
      currentDate = date;
    }

    if (pendingIp.size < maxKeys) inc(pendingIp, ip || '(unknown)', 1);
    if (pendingPath.size < maxKeys) inc(pendingPath, path || '(unknown)', 1);
  }

  async function flush() {
    if (flushing) return;
    if (!pendingIp.size && !pendingPath.size) return;
    flushing = true;

    const date = currentDate;
    const batchIp = pendingIp;
    const batchPath = pendingPath;
    pendingIp = new Map();
    pendingPath = new Map();

    try {
      const existing = await loadDailyUsage(db, date);
      const mergedIp = mergeCounts(existing.ipCounts, Object.fromEntries(batchIp));
      const mergedPath = mergeCounts(existing.pathCounts, Object.fromEntries(batchPath));
      await saveDailyUsage(db, date, mergedIp, mergedPath);
    } catch (err) {
      // If we can't persist, merge back so data isn't lost in memory.
      for (const [k, v] of batchIp.entries()) inc(pendingIp, k, v);
      for (const [k, v] of batchPath.entries()) inc(pendingPath, k, v);
      // Don't spam; caller may log if needed.
      throw err;
    } finally {
      flushing = false;
    }
  }

  return {
    recordFromRequest(req) {
      const ip =
        firstXffIp(req.headers && req.headers['x-forwarded-for']) ||
        normalizeIp(req.ip || req.socket?.remoteAddress || '');
      const path = String(req.path || '');
      record({ ip: ip || '(unknown)', path: path || '(unknown)' });
    },
    flush,
    shutdown() {
      clearInterval(timer);
      return flush().catch(() => {});
    },
  };
}

module.exports = { createUsageStatsCollector };
