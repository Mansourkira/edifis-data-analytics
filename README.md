# Edifis Data Analytics

Next.js reporting app (Supabase / Sage sales data), deployed on **Cloudflare Workers** via [@opennextjs/cloudflare](https://opennext.js.org/cloudflare).

## Local development

```bash
cp .env.example .env
# fill NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, etc.

npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Preview in the Workers runtime (closer to production)

```bash
cp .dev.vars.example .dev.vars
# same NEXT_PUBLIC_* values as .env

npm run preview
```

## Cloudflare (Workers & Pages)

This app is **not** a static export. It runs as a **Worker** with static assets (`.open-next/worker.js` + `.open-next/assets`).

| File | Role |
|------|------|
| `wrangler.jsonc` | Worker name, `nodejs_compat`, assets binding, production / preview envs |
| `open-next.config.ts` | OpenNext Cloudflare adapter |
| `public/_headers` | Long-cache headers for `/_next/static/*` |

### Deploy from your machine

```bash
npm run deploy              # production Worker
npm run deploy:preview      # preview env (workers.dev)
```

Requires [Wrangler](https://developers.cloudflare.com/workers/wrangler/) login (`npx wrangler login`) or `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID`.

### Cloudflare dashboard (Workers Builds / Pages connected to Git)

1. **Workers & Pages** → Create / connect project → link this repository.
2. **Build command:** `npm run deploy`  
   Or split: **Build** `npm run cf:build` only if your pipeline runs deploy separately (OpenNext recommends `npm run deploy` end-to-end).
3. **Build variables and secrets** (required for the client bundle):
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `NEXT_PUBLIC_APP_PASSWORD` (optional)
4. **Secrets** (optional, server-only): `SUPABASE_SERVICE_ROLE_KEY`
5. Node.js **22** (see `.nvmrc`).

Do **not** set “Build output directory” to `.next` or `out` — Wrangler uses `.open-next` via `wrangler.jsonc`.

### GitHub Actions

Workflow: [`.github/workflows/cloudflare-deploy.yml`](.github/workflows/cloudflare-deploy.yml)

Secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`  
Variables: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, …

### Types for bindings

```bash
npm run cf-typegen
```

## Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Next.js dev server |
| `npm run build` | `next build` only |
| `npm run cf:build` | Next build + OpenNext Cloudflare bundle → `.open-next/` |
| `npm run preview` | Build + `wrangler dev` |
| `npm run deploy` | Build + deploy production Worker |
| `npm run deploy:preview` | Build + deploy preview Worker |
| `npm run lint` | ESLint |
