const { createClient } = require('@supabase/supabase-js');

function normalizeSql(sql) {
  return String(sql || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function createSqliteWrapper(raw) {
  return {
    __kind: 'sqlite',
    raw,
    close: () =>
      new Promise((resolve, reject) => {
        raw.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

function createSupabaseWrapper() {
  const url = process.env.SUPABASE_URL || '';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!url || !key) return null;

  return {
    __kind: 'supabase',
    raw: createClient(url, key, { auth: { persistSession: false } }),
    close: async () => {},
  };
}

function openDb(dbPath) {
  const useSupabase = process.env.USE_SUPABASE === '1';
  if (useSupabase) {
    const supabase = createSupabaseWrapper();
    if (supabase) return Promise.resolve(supabase);
  }

  // Lazy-load sqlite3 so `USE_SUPABASE=1` works even when sqlite3 native bindings
  // are not available for the current Node runtime.
  const sqlite3 = require('sqlite3').verbose();

  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(dbPath, (err) => {
      if (err) return reject(err);
      resolve(createSqliteWrapper(db));
    });
  });
}

async function runSqlite(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.raw.run(sql, params, function onRun(err) {
      if (err) return reject(err);
      resolve(this);
    });
  });
}

async function getSqlite(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.raw.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  });
}

async function allSqlite(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.raw.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });
}

async function insertArticleIfNotExistsSupabase(db, params) {
  const [
    url_original,
    final_url,
    canonical_url,
    title,
    source,
    published_at,
    fetched_at,
    domain,
    link_status,
    verification_note,
  ] = params;

  const checks = [];
  if (canonical_url) checks.push(['canonical_url', canonical_url]);
  if (final_url) checks.push(['final_url', final_url]);
  if (url_original) checks.push(['url_original', url_original]);

  for (const [col, value] of checks) {
    const { data, error } = await db.raw
      .from('articles')
      .select('id')
      .eq(col, value)
      .order('id', { ascending: false })
      .limit(1);
    if (error) throw error;
    if (data && data.length) return { changes: 0 };
  }

  const row = {
    url_original,
    final_url,
    canonical_url,
    title,
    source,
    published_at,
    fetched_at,
    domain,
    link_status,
    verification_note,
  };

  const { error } = await db.raw.from('articles').insert(row);
  if (error) {
    const msg = String(error.message || '').toLowerCase();
    if (msg.includes('duplicate key')) return { changes: 0 };
    throw error;
  }

  return { changes: 1 };
}

async function runSupabase(db, sql, params = []) {
  const nsql = normalizeSql(sql);

  if (nsql.startsWith('create table if not exists')) {
    return { changes: 0 };
  }

  if (nsql.startsWith('insert or ignore into articles')) {
    return insertArticleIfNotExistsSupabase(db, params);
  }

  if (nsql.startsWith('update articles set')) {
    const [title, source, published_at, fetched_at, domain, link_status, verification_note, id] = params;
    const { error } = await db.raw
      .from('articles')
      .update({ title, source, published_at, fetched_at, domain, link_status, verification_note })
      .eq('id', id);
    if (error) throw error;
    return { changes: 1 };
  }

  if (nsql.startsWith('insert into daily_briefs')) {
    const [date, mode, level, json, created_at] = params;
    const { error } = await db.raw
      .from('daily_briefs')
      .upsert({ date, mode, level, json, created_at }, { onConflict: 'date,mode,level' });
    if (error) throw error;
    return { changes: 1 };
  }

  throw new Error(`Unsupported SQL for Supabase run(): ${sql.slice(0, 120)}`);
}

async function getSupabase(db, sql, params = []) {
  const nsql = normalizeSql(sql);

  if (nsql.includes('from daily_briefs') && nsql.includes('where date') && nsql.includes('mode') && nsql.includes('level')) {
    const [date, mode, level] = params;
    const { data, error } = await db.raw
      .from('daily_briefs')
      .select('json')
      .eq('date', date)
      .eq('mode', mode)
      .eq('level', level)
      .limit(1);
    if (error) throw error;
    return data && data.length ? data[0] : undefined;
  }

  if (nsql.includes('select id from articles')) {
    const [canonical_url, final_url, url_original] = params;
    const rows = [];
    if (canonical_url) {
      const { data, error } = await db.raw.from('articles').select('id').eq('canonical_url', canonical_url).limit(1);
      if (error) throw error;
      if (data?.length) rows.push(...data);
    }
    if (final_url) {
      const { data, error } = await db.raw.from('articles').select('id').eq('final_url', final_url).limit(1);
      if (error) throw error;
      if (data?.length) rows.push(...data);
    }
    if (url_original) {
      const { data, error } = await db.raw.from('articles').select('id').eq('url_original', url_original).limit(1);
      if (error) throw error;
      if (data?.length) rows.push(...data);
    }
    if (!rows.length) return undefined;
    rows.sort((a, b) => Number(b.id) - Number(a.id));
    return rows[0];
  }

  throw new Error(`Unsupported SQL for Supabase get(): ${sql.slice(0, 120)}`);
}

async function allSupabase(_db, sql) {
  throw new Error(`Unsupported SQL for Supabase all(): ${sql.slice(0, 120)}`);
}

function run(db, sql, params = []) {
  if (db.__kind === 'supabase') return runSupabase(db, sql, params);
  return runSqlite(db, sql, params);
}

function get(db, sql, params = []) {
  if (db.__kind === 'supabase') return getSupabase(db, sql, params);
  return getSqlite(db, sql, params);
}

function all(db, sql, params = []) {
  if (db.__kind === 'supabase') return allSupabase(db, sql, params);
  return allSqlite(db, sql, params);
}

module.exports = { openDb, run, get, all };
