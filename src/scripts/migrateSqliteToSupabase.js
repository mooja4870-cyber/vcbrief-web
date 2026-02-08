require('dotenv').config();

const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const { createClient } = require('@supabase/supabase-js');

function openSqlite(dbPath) {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(dbPath, (err) => (err ? reject(err) : resolve(db)));
  });
}

function sqliteAll(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
  });
}

async function upsertChunk(client, table, rows, onConflict) {
  if (!rows.length) return;
  const { error } = await client.from(table).upsert(rows, { onConflict });
  if (error) throw error;
}

async function main() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.');
  }

  const sqlitePath = process.env.DB_PATH || path.join(__dirname, '..', '..', 'data', 'brief.db');
  const sqlite = await openSqlite(sqlitePath);
  const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

  try {
    const articles = await sqliteAll(sqlite, 'SELECT * FROM articles');
    const briefs = await sqliteAll(sqlite, 'SELECT * FROM daily_briefs');

    const articleRows = articles.map((r) => ({
      id: r.id,
      url_original: r.url_original,
      final_url: r.final_url,
      canonical_url: r.canonical_url,
      title: r.title,
      source: r.source,
      published_at: r.published_at,
      fetched_at: r.fetched_at,
      domain: r.domain,
      link_status: r.link_status,
      verification_note: r.verification_note,
    }));

    const briefRows = briefs.map((r) => ({
      id: r.id,
      date: r.date,
      mode: r.mode,
      level: r.level,
      json: r.json,
      created_at: r.created_at,
    }));

    const chunkSize = 500;
    for (let i = 0; i < articleRows.length; i += chunkSize) {
      await upsertChunk(supabase, 'articles', articleRows.slice(i, i + chunkSize), 'id');
    }
    for (let i = 0; i < briefRows.length; i += chunkSize) {
      await upsertChunk(supabase, 'daily_briefs', briefRows.slice(i, i + chunkSize), 'date,mode,level');
    }

    console.log(`Migrated articles=${articleRows.length}, daily_briefs=${briefRows.length}`);
  } finally {
    sqlite.close();
  }
}

main().catch((err) => {
  console.error('Migration failed:', err.message || err);
  process.exit(1);
});
