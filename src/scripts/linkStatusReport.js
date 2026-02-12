const path = require('path');
const { execFileSync } = require('child_process');
require('dotenv').config();

const { openDb, all } = require('../db/sqlite');

function parseArgs(argv) {
  const out = { top: 20, samples: 10, maxRows: 50000 };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const next = argv[i + 1];
    if (a === '--top' && next) out.top = Math.max(1, Math.floor(Number(next)));
    if (a === '--samples' && next) out.samples = Math.max(0, Math.floor(Number(next)));
    if (a === '--max-rows' && next) out.maxRows = Math.max(1000, Math.floor(Number(next)));
  }
  return out;
}

function padRight(s, n) {
  const str = String(s ?? '');
  if (str.length >= n) return str;
  return str + ' '.repeat(n - str.length);
}

function summarizeNote(note) {
  const s = String(note || '').trim();
  if (!s) return '(empty)';
  // Keep the report readable; full strings still exist in DB.
  return s.length > 140 ? `${s.slice(0, 137)}...` : s;
}

function chooseBestUrl(row) {
  return row.canonical_url || row.final_url || row.url_original || '';
}

function inc(map, key, by = 1) {
  const k = String(key || '(empty)');
  map.set(k, (map.get(k) || 0) + by);
}

function sortDesc(map) {
  return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
}

async function reportSqlite(db, opts) {
  const [{ cnt: total = 0 } = {}] = await all(db, 'SELECT COUNT(*) AS cnt FROM articles');
  const byStatus = await all(
    db,
    `SELECT COALESCE(link_status, '') AS link_status, COUNT(*) AS cnt
     FROM articles
     GROUP BY COALESCE(link_status, '')
     ORDER BY cnt DESC`
  );

  const badByDomain = await all(
    db,
    `SELECT COALESCE(domain, '') AS domain, COALESCE(link_status, '') AS link_status, COUNT(*) AS cnt
     FROM articles
     WHERE link_status IN ('broken','unverified')
     GROUP BY COALESCE(domain, ''), COALESCE(link_status, '')
     ORDER BY cnt DESC
     LIMIT ?`,
    [opts.top]
  );

  const badByNote = await all(
    db,
    `SELECT COALESCE(verification_note, '') AS verification_note, COALESCE(link_status, '') AS link_status, COUNT(*) AS cnt
     FROM articles
     WHERE link_status IN ('broken','unverified')
     GROUP BY COALESCE(verification_note, ''), COALESCE(link_status, '')
     ORDER BY cnt DESC
     LIMIT ?`,
    [opts.top]
  );

  const brokenSamples = opts.samples
    ? await all(
        db,
        `SELECT id, url_original, final_url, canonical_url, link_status, verification_note, domain
         FROM articles
         WHERE link_status='broken'
         ORDER BY id DESC
         LIMIT ?`,
        [opts.samples]
      )
    : [];

  return {
    kind: 'sqlite',
    total,
    byStatus,
    badByDomain,
    badByNote,
    brokenSamples,
  };
}

async function reportSupabase(db, opts) {
  const pageSize = 1000;
  const maxRows = opts.maxRows;

  const statusCounts = new Map();
  const badDomainCounts = new Map(); // key: `${domain}\t${status}`
  const badNoteCounts = new Map(); // key: `${note}\t${status}`
  const brokenSamples = [];

  let offset = 0;
  let fetched = 0;
  while (true) {
    if (fetched >= maxRows) break;

    const { data, error } = await db.raw
      .from('articles')
      .select('id,domain,link_status,verification_note,url_original,final_url,canonical_url')
      .order('id', { ascending: false })
      .range(offset, offset + pageSize - 1);
    if (error) throw error;
    if (!data || !data.length) break;

    for (const row of data) {
      inc(statusCounts, row.link_status || '');

      const status = String(row.link_status || '');
      if (status === 'broken' || status === 'unverified') {
        const domain = String(row.domain || '');
        const note = String(row.verification_note || '');
        inc(badDomainCounts, `${domain}\t${status}`);
        inc(badNoteCounts, `${note}\t${status}`);
      }

      if (brokenSamples.length < opts.samples && status === 'broken') {
        brokenSamples.push({
          id: row.id,
          url_original: row.url_original,
          final_url: row.final_url,
          canonical_url: row.canonical_url,
          link_status: row.link_status,
          verification_note: row.verification_note,
          domain: row.domain,
        });
      }
    }

    fetched += data.length;
    offset += data.length;
    if (data.length < pageSize) break;
  }

  // Try to get an exact total; if it fails, fall back to fetched.
  let total = fetched;
  try {
    const { count, error } = await db.raw.from('articles').select('id', { count: 'exact', head: true });
    if (error) throw error;
    if (typeof count === 'number') total = count;
  } catch {
    // ignore
  }

  const byStatus = sortDesc(statusCounts).map(([link_status, cnt]) => ({ link_status, cnt }));
  const badByDomain = sortDesc(badDomainCounts)
    .slice(0, opts.top)
    .map(([k, cnt]) => {
      const [domain, link_status] = k.split('\t');
      return { domain, link_status, cnt };
    });
  const badByNote = sortDesc(badNoteCounts)
    .slice(0, opts.top)
    .map(([k, cnt]) => {
      const [verification_note, link_status] = k.split('\t');
      return { verification_note, link_status, cnt };
    });

  const truncated = fetched >= maxRows;
  return {
    kind: truncated ? `supabase (truncated at ${maxRows} rows)` : 'supabase',
    total,
    byStatus,
    badByDomain,
    badByNote,
    brokenSamples,
  };
}

function printReport(r, opts) {
  console.log('');
  console.log('[link-status-report]');
  console.log(`db_kind=${r.kind}`);
  console.log(`total_articles=${r.total}`);

  console.log('');
  console.log('Counts By link_status');
  for (const row of r.byStatus) {
    console.log(`${padRight(row.link_status || '(empty)', 12)} ${row.cnt}`);
  }

  console.log('');
  console.log(`Top ${opts.top} Bad Domains (broken/unverified)`);
  for (const row of r.badByDomain) {
    const domain = row.domain || '(empty)';
    const status = row.link_status || '(empty)';
    console.log(`${padRight(status, 12)} ${padRight(domain, 32)} ${row.cnt}`);
  }

  console.log('');
  console.log(`Top ${opts.top} Bad Reasons (verification_note)`);
  for (const row of r.badByNote) {
    const status = row.link_status || '(empty)';
    console.log(`${padRight(status, 12)} ${padRight(summarizeNote(row.verification_note), 80)} ${row.cnt}`);
  }

  if (opts.samples > 0) {
    console.log('');
    console.log(`Broken Samples (latest ${opts.samples})`);
    for (const row of r.brokenSamples) {
      const best = chooseBestUrl(row);
      console.log(`- id=${row.id} domain=${row.domain || ''} note=${summarizeNote(row.verification_note)}`);
      console.log(`  url=${best}`);
    }
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const dbPath = process.env.DB_PATH || path.join(__dirname, '..', '..', 'data', 'brief.db');
  let db;
  try {
    db = await openDb(dbPath);
  } catch (err) {
    // If sqlite3 native bindings can't load on this Node runtime, fall back to Python's built-in sqlite3.
    const py = path.join(__dirname, 'linkStatusReport.py');
    try {
      execFileSync('python3', [py, '--db-path', dbPath, '--top', String(opts.top), '--samples', String(opts.samples)], {
        stdio: 'inherit',
      });
      return;
    } catch (pyErr) {
      console.error(err?.stack || err?.message || String(err));
      console.error(pyErr?.stack || pyErr?.message || String(pyErr));
      process.exit(1);
    }
  }

  try {
    const r = db.__kind === 'supabase' ? await reportSupabase(db, opts) : await reportSqlite(db, opts);
    printReport(r, opts);
  } finally {
    await db.close();
  }
}

main().catch((err) => {
  console.error(err?.stack || err?.message || String(err));
  process.exit(1);
});
