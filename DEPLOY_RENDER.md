# Deploy (Render) Quick Guide

## 1) Push this project to GitHub
- Create a new GitHub repository.
- Upload this project files.
- Make sure `.env` is NOT uploaded (`.gitignore` already blocks it).

## 2) Create Render web service
- Go to https://render.com
- Click `New` -> `Blueprint`
- Select your GitHub repository
- Render will detect `render.yaml`
- Continue and create service

## 3) Set environment variables in Render
In Render service settings, add:
- `USE_SUPABASE=1`
- `SUPABASE_URL=<your supabase url>`
- `SUPABASE_SERVICE_ROLE_KEY=<your service role key>`
- (optional) `SUPABASE_ANON_KEY=<your anon key>`

## 4) Deploy
- Click `Manual Deploy` -> `Deploy latest commit` (or wait for auto deploy)
- Wait until status is `Live`

## 5) Final URL to share
- Use Render URL like:
  - `https://vcbrief-web.onrender.com`
- This URL works from other regions/devices.

## 6) Health check
Open:
- `https://vcbrief-web.onrender.com/api/health`
Expected:
- `{ "ok": true }`
