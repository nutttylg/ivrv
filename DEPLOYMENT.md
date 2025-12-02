# Deployment Guide for Vercel

## GitHub Repository
✅ Repository created: https://github.com/nutttylg/ivrv

## Deploying to Vercel (Manual Setup)

Since Vercel CLI requires Node.js which isn't installed, follow these steps to deploy via the Vercel Dashboard:

### Step 1: Visit Vercel Dashboard
1. Go to https://vercel.com
2. Sign in with your GitHub account (nutttylg)

### Step 2: Import Project
1. Click "Add New..." → "Project"
2. Select "Import Git Repository"
3. Find and select `nutttylg/ivrv` from your repositories
4. Click "Import"

### Step 3: Configure Project
When asked for project configuration:

**Project Name:** `ivrv` (or your preferred name)

**Framework Preset:** Other

**Build & Development Settings:**
- Build Command: `bun install`
- Output Directory: `.` (leave as default)
- Install Command: `curl -fsSL https://bun.sh/install | bash && bun install`
- Development Command: `bun run server-v3.ts`

**Root Directory:** `./` (leave as default)

**Environment Variables:** None required

### Step 4: Deploy
1. Click "Deploy"
2. Wait for deployment to complete (~2-3 minutes)
3. Your app will be live at: `https://ivrv.vercel.app` (or similar)

## Important Notes

### Bun Runtime Support
- Vercel doesn't natively support Bun runtime yet
- The vercel.json file includes configuration to install Bun during build
- If deployment fails, you may need to convert to Node.js

### Converting to Node.js (If Needed)

If Bun installation fails on Vercel, you'll need to:

1. Replace `Bun.serve()` with Node.js HTTP server
2. Replace `Bun.file()` with `fs.readFile()`
3. Update vercel.json to use Node.js runtime

I can help with this conversion if needed.

## Alternative: Railway.app

If Vercel doesn't work well with Bun, consider Railway.app which has better Bun support:

1. Go to https://railway.app
2. Sign in with GitHub
3. Click "New Project" → "Deploy from GitHub repo"
4. Select `nutttylg/ivrv`
5. Railway will auto-detect Bun and deploy

## Testing Locally

To test locally before deploying:
```bash
cd /home/wassie/bookdepth/implied-vs-realized
bun run server-v3.ts
```

Visit http://localhost:3201

## Current Status

✅ Git repository initialized
✅ Code committed to Git
✅ Pushed to GitHub: https://github.com/nutttylg/ivrv
⏳ Ready for Vercel deployment (manual setup required)

## Next Steps

1. Visit https://vercel.com and sign in
2. Import the GitHub repository
3. Configure with Bun runtime
4. Deploy!

Your live URL will be: `https://ivrv.vercel.app` (or custom domain)
