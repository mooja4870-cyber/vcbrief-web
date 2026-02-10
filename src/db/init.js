const { run } = require('./sqlite');

async function initSchema(db) {
  if (db.__kind === 'supabase') {
    const [{ error: articlesErr }, { error: briefsErr }, { error: accessErr }] = await Promise.all([
      db.raw.from('articles').select('id').limit(1),
      db.raw.from('daily_briefs').select('id').limit(1),
      db.raw.from('access_logs').select('id').limit(1),
    ]);

    if (articlesErr || briefsErr) {
      throw new Error(
        'Supabase tables are missing. Run supabase/schema.sql in Supabase SQL Editor, then restart the server.'
      );
    }
    if (accessErr) {
      // Keep the server running even if access logging isn't set up yet.
      console.warn(
        '[db] WARNING: Supabase table "access_logs" is missing. Run supabase/schema.sql to enable IP access logging.'
      );
    }
    return;
  }

  await run(
    db,
    `
    CREATE TABLE IF NOT EXISTS articles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      url_original TEXT,
      final_url TEXT,
      canonical_url TEXT,
      title TEXT,
      source TEXT,
      published_at TEXT,
      fetched_at TEXT,
      domain TEXT,
      link_status TEXT,
      verification_note TEXT,
      UNIQUE(canonical_url),
      UNIQUE(final_url)
    );
    `
  );

  await run(
    db,
    `
    CREATE TABLE IF NOT EXISTS daily_briefs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      mode TEXT NOT NULL,
      level TEXT NOT NULL,
      json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(date, mode, level)
    );
    `
  );

  await run(
    db,
    `
    CREATE TABLE IF NOT EXISTS access_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT NOT NULL,
      ip TEXT NOT NULL,
      method TEXT NOT NULL,
      path TEXT NOT NULL,
      url TEXT NOT NULL,
      status INTEGER NOT NULL,
      duration_ms INTEGER NOT NULL,
      user_agent TEXT,
      referer TEXT,
      x_forwarded_for TEXT
    );
    `
  );

  await run(db, `CREATE INDEX IF NOT EXISTS idx_access_logs_created_at ON access_logs(created_at);`);
  await run(db, `CREATE INDEX IF NOT EXISTS idx_access_logs_ip_created_at ON access_logs(ip, created_at);`);
}

module.exports = { initSchema };
