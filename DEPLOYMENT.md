# Production deployment

Requires Node.js 22.12+ and npm. The committed `package-lock.json` pins dependencies.

```sh
npm ci
npm run check
npm test
npm run build
npm run verify:dist
```

`npm run build` validates the generated files and all local HTML, CSS, manifest,
service-worker and literal script references. A missing or non-allowlisted file
fails the build. `scripts/production-assets.mjs` is the explicit publish boundary;
no repository directory is copied recursively and Vite `publicDir` is disabled.

Classic JavaScript remains classic: the blocking config runs first, followed by
the same deferred scripts in their original order. No application globals are
renamed or converted to modules. Production URLs are root-relative for SPA
navigation. A content-derived version is shared by HTML asset URLs and the PWA
cache; the worker caches only public assets, never Supabase responses or receipts.

## Public Supabase configuration

By default the build preserves `runtime-config.js`. To override it in CI, provide
both `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (anon JWT or publishable key).
No other environment variable is copied to the browser. Do not place service-role,
database, card-encryption or reminder secrets in either variable or runtime file.
Runtime config uses `Cache-Control: no-store` and is never stored by the PWA cache.

Supabase Auth's production Site URL / Redirect URLs must include the intended
production origin before production confirmation links are used. This build fix
does not change remote Auth, CORS, SMTP, RLS or Edge Function settings.

## Cloudflare Workers Builds

Existing repository: `mehradkal5-cmyk/bedeh-bestan`, production branch: `main`.
`wrangler.jsonc` defines Worker `bedeh-bestan`, static `./dist`, compatibility date
`2026-08-31`, and SPA fallback. No Worker script or secret bindings are required.

- Build command: `npm run build`
- Deploy command: `npx wrangler deploy` (uses the installed, locked version)
- Local equivalent: `npm run deploy` (build + deploy; requires Cloudflare auth)
- Non-mutating configuration check: `npm run deploy:check`
- Local Workers preview: `npm run preview` (default port 8787; override with `npm run preview -- --port 4174`)

Use the connected GitHub build for this release; a push to `main` triggers it.
No separate manual deployment is necessary. Check the connected build status and
the production page plus each script response, not merely Vite's exit code.

Production: https://bedeh-bestan.mehradkal5.workers.dev/
