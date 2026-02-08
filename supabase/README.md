# Supabase Setup

1. In Supabase SQL Editor, run `supabase/schema.sql`.
2. Ensure root `.env` has:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - (optional) `USE_SUPABASE=1`
3. Migrate existing SQLite data:

```bash
npm run migrate:supabase
```

4. Start backend:

```bash
npm run dev
```

If you need temporary fallback to local SQLite:

```env
USE_SUPABASE=0
```
