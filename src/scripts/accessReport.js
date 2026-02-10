const path = require('path');
require('dotenv').config();

const { openDb, all } = require('../db/sqlite');

function parseArgs(argv) {
  const out = { top: 30, maxRows: 50000, since: '', from: '', to: '', ip: '', paths: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const next = argv[i + 1];
    if (a === '--top' && next) out.top = Math.max(1, Math.floor(Number(next)));
    if (a === '--max-rows' && next) out.maxRows = Math.max(1000, Math.floor(Number(next)));
    if (a === '--since' && next) out.since = String(next);
    if (a === '--from' && next) out.from = String(next);
    if (a === '--to' && next) out.to = String(next);
    if (a === '--ip' && next) out.ip = String(next);
    if (a === '--paths') out.paths = true;
  }
  return out;
}

function padRight(s, n) {
  const str = String(s ?? '');
  if (str.length >= n) return str;
  return str + ' '.repeat(n - str.length);
}

function parseSinceToMs(since) {
  const s = String(since || '').trim().toLowerCase();
  if (!s) return 0;
  const m = s.match(/^(\d+)\s*([smhdw])$/);
  if (!m) return 0;
  const n = Math.max(0, Number(m[1]));
  const unit = m[2];
  const mult =
    unit === 's'
      ? 1000
      : unit === 'm'
        ? 60 * 1000
        : unit === 'h'
          ? 60 * 60 * 1000
          : unit === 'd'
            ? 24 * 60 * 60 * 1000
            : 7 * 24 * 60 * 60 * 1000;
  return n * mult;
}

function isoFromDateOnly(s) {
  const v = String(s || '').trim();
  if (!v) return '';
  // YYYY-MM-DD -> YYYY-MM-DDT00:00:00.000Z
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return new Date(`${v}T00:00:00.000Z`).toISOString();
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString();
}

function fmtIso(s) {
  const v = String(s || '').trim();
  if (!v) return '';
  // Keep output compact and sortable
  return v.replace('T', ' ').replace('Z', 'Z');
}

function sortTop(map) {
  return Array.from(map.entries()).sort((a, b) => b[1].cnt - a[1].cnt);
}

async function reportSqlite(db, opts, fromIso, toIso) {
  const where = [];
  const params = [];

  if (fromIso) {
    where.push('created_at >= ?');
    params.push(fromIso);
  }
  if (toIso) {
    where.push('created_at <= ?');
    params.push(toIso);
  }
  if (opts.ip) {
    where.push('ip = ?');
    params.push(opts.ip);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const [{ cnt: totalLogs = 0 } = {}] = await all(db, `SELECT COUNT(*) AS cnt FROM access_logs ${whereSql}`, params);

  const topIps = await all(
    db,
    `
    SELECT
      ip,
      COUNT(*) AS cnt,
      MIN(created_at) AS first_at,
      MAX(created_at) AS last_at,
      COUNT(DISTINCT path) AS uniq_paths
    FROM access_logs
    ${whereSql}
    GROUP BY ip
    ORDER BY cnt DESC
    LIMIT ?
    `,
    [...params, opts.top]
  );

  let byPath = [];
  if (opts.paths) {
    byPath = await all(
      db,
      `
      SELECT
        path,
        COUNT(*) AS cnt,
        MAX(created_at) AS last_at
      FROM access_logs
      ${whereSql}
      GROUP BY path
      ORDER BY cnt DESC
      LIMIT ?
      `,
      [...params, Math.max(200, opts.top)]
    );
  }

  return { kind: 'sqlite', totalLogs, topIps, byPath };
}

async function reportSupabase(db, opts, fromIso, toIso) {
  const pageSize = 1000;
  const maxRows = opts.maxRows;

  const byIp = new Map();
  const byPath = new Map();

  let offset = 0;
  let fetched = 0;
  while (true) {
    if (fetched >= maxRows) break;

    let q = db.raw.from('access_logs').select('ip,created_at,path').order('created_at', { ascending: false });
    if (fromIso) q = q.gte('created_at', fromIso);
    if (toIso) q = q.lte('created_at', toIso);
    if (opts.ip) q = q.eq('ip', opts.ip);

    const { data, error } = await q.range(offset, offset + pageSize - 1);
    if (error) {
      const msg = String(error.message || error || '');
      if (msg.toLowerCase().includes('access_logs') && msg.toLowerCase().includes('schema cache')) {
        return reportSupabaseDailyUsage(db, opts, fromIso, toIso);
      }
      throw error;
    }
    if (!data || !data.length) break;

    for (const row of data) {
      const ip = String(row.ip || '(empty)');
      const createdAt = String(row.created_at || '');
      const p = String(row.path || '(empty)');

      const cur = byIp.get(ip) || { cnt: 0, first_at: createdAt, last_at: createdAt, paths: new Set() };
      cur.cnt += 1;
      if (!cur.first_at || (createdAt && createdAt < cur.first_at)) cur.first_at = createdAt;
      if (!cur.last_at || (createdAt && createdAt > cur.last_at)) cur.last_at = createdAt;
      cur.paths.add(p);
      byIp.set(ip, cur);

      if (opts.paths) {
        const pc = byPath.get(p) || { cnt: 0, last_at: createdAt };
        pc.cnt += 1;
        if (!pc.last_at || (createdAt && createdAt > pc.last_at)) pc.last_at = createdAt;
        byPath.set(p, pc);
      }
    }

    fetched += data.length;
    offset += data.length;
    if (data.length < pageSize) break;
  }

  let totalLogs = fetched;
  try {
    let q = db.raw.from('access_logs').select('id', { count: 'exact', head: true });
    if (fromIso) q = q.gte('created_at', fromIso);
    if (toIso) q = q.lte('created_at', toIso);
    if (opts.ip) q = q.eq('ip', opts.ip);
    const { count, error } = await q;
    if (error) throw error;
    if (typeof count === 'number') totalLogs = count;
  } catch {
    // ignore
  }

  const topIps = sortTop(byIp)
    .slice(0, opts.top)
    .map(([ip, v]) => ({
      ip,
      cnt: v.cnt,
      first_at: v.first_at,
      last_at: v.last_at,
      uniq_paths: v.paths.size,
    }));

  const byPathRows = opts.paths
    ? Array.from(byPath.entries())
        .sort((a, b) => b[1].cnt - a[1].cnt)
        .slice(0, Math.max(200, opts.top))
        .map(([path, v]) => ({ path, cnt: v.cnt, last_at: v.last_at }))
    : [];

  const truncated = fetched >= maxRows;
  return {
    kind: truncated ? `supabase (truncated at ${maxRows} rows)` : 'supabase',
    totalLogs,
    topIps,
    byPath: byPathRows,
  };
}

function dateOnlyFromIso(iso) {
  const s = String(iso || '').trim();
  if (!s) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  if (s.length >= 10) return s.slice(0, 10);
  return '';
}

async function reportSupabaseDailyUsage(db, opts, fromIso, toIso) {
  const fromDate = dateOnlyFromIso(fromIso) || '0000-00-00';
  const toDate = dateOnlyFromIso(toIso) || '9999-12-31';

  let q = db.raw
    .from('daily_briefs')
    .select('date,json')
    .eq('mode', 'usage')
    .eq('level', 'ip')
    .gte('date', fromDate)
    .lte('date', toDate)
    .order('date', { ascending: false });

  const { data, error } = await q;
  if (error) throw error;

  const byIp = new Map();
  const byPath = new Map();
  let totalLogs = 0;

  for (const row of data || []) {
    let parsed;
    try {
      parsed = JSON.parse(String(row.json || ''));
    } catch {
      parsed = null;
    }
    const ipCounts = parsed?.ipCounts && typeof parsed.ipCounts === 'object' ? parsed.ipCounts : {};
    const pathCounts = parsed?.pathCounts && typeof parsed.pathCounts === 'object' ? parsed.pathCounts : {};

    for (const [ip, cnt] of Object.entries(ipCounts)) {
      const n = Number(cnt) || 0;
      totalLogs += n;
      byIp.set(ip, (byIp.get(ip) || 0) + n);
    }

    if (opts.paths) {
      for (const [p, cnt] of Object.entries(pathCounts)) {
        const n = Number(cnt) || 0;
        byPath.set(p, (byPath.get(p) || 0) + n);
      }
    }
  }

  const topIps = Array.from(byIp.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, opts.top)
    .map(([ip, cnt]) => ({ ip, cnt, first_at: '', last_at: '', uniq_paths: '' }));

  const byPathRows = opts.paths
    ? Array.from(byPath.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, Math.max(200, opts.top))
        .map(([path, cnt]) => ({ path, cnt, last_at: '' }))
    : [];

  return { kind: 'supabase (daily_briefs usage fallback)', totalLogs, topIps, byPath: byPathRows };
}

function printReport(r, opts, fromIso, toIso) {
  console.log('');
  console.log('[access-report]');
  console.log(`db_kind=${r.kind}`);
  console.log(`range_from=${fromIso || '(none)'}`);
  console.log(`range_to=${toIso || '(none)'}`);
  if (opts.ip) console.log(`filter_ip=${opts.ip}`);
  console.log(`total_logs=${r.totalLogs}`);
  console.log(`unique_ips_in_top=${r.topIps.length}`);

  console.log('');
  console.log(`Top ${opts.top} IPs`);
  console.log(
    `${padRight('ip', 46)} ${padRight('cnt', 8)} ${padRight('uniq_paths', 10)} ${padRight('first_at', 22)} last_at`
  );
  for (const row of r.topIps) {
    console.log(
      `${padRight(row.ip, 46)} ${padRight(row.cnt, 8)} ${padRight(row.uniq_paths ?? '', 10)} ${padRight(
        fmtIso(row.first_at),
        22
      )} ${fmtIso(row.last_at)}`
    );
  }

  if (opts.paths) {
    console.log('');
    console.log('Top Paths');
    console.log(`${padRight('path', 32)} ${padRight('cnt', 8)} last_at`);
    for (const row of r.byPath) {
      console.log(`${padRight(row.path, 32)} ${padRight(row.cnt, 8)} ${fmtIso(row.last_at)}`);
    }
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  let fromIso = isoFromDateOnly(opts.from);
  let toIso = isoFromDateOnly(opts.to);
  if (!fromIso && opts.since) {
    const ms = parseSinceToMs(opts.since);
    if (ms > 0) fromIso = new Date(Date.now() - ms).toISOString();
  }

  const dbPath = process.env.DB_PATH || path.join(__dirname, '..', '..', 'data', 'brief.db');
  const db = await openDb(dbPath);
  try {
    const r =
      db.__kind === 'supabase'
        ? await reportSupabase(db, opts, fromIso, toIso)
        : await reportSqlite(db, opts, fromIso, toIso);
    printReport(r, opts, fromIso, toIso);
  } finally {
    await db.close();
  }
}

main().catch((err) => {
  const msg = String(err?.message || err || '');
  if (msg.toLowerCase().includes('access_logs')) {
    console.error('');
    console.error('[access-report] access_logs table is missing.');
    console.error('- If using Supabase: run supabase/schema.sql in Supabase SQL Editor.');
    console.error('- If using SQLite: start the server once (it auto-creates tables), or ensure DB_PATH points to the right DB.');
  }
  console.error(err?.stack || err?.message || String(err));
  process.exit(1);
});
