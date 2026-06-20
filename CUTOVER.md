# Production Cutover Runbook — zudo-cloudflare-wisdom (Astro → zfb / Workers)

> **Who runs this:** Takazudo (Cloudflare account access required for steps 1–5).
> **Code merge:** Independent of these steps. The code PR can merge at any time.
> **Half-live state:** Until steps 1–3 are done, the post-merge `main-deploy` **deploy job stays RED** — this is expected, not a code bug. `wrangler deploy` uploads the worker bundle but cannot route traffic until the token has the right scope and the workers.dev subdomain is enabled. The old Cloudflare Pages project (`zudo-cloudflare` at `/pj/zudo-cloudflare`) keeps serving its last build in the meantime.

---

## Step 0 — Pre-merge: Re-scope `CLOUDFLARE_API_TOKEN` to Workers: Edit

> **PRE-MERGE HUMAN ACTION — do this BEFORE (or at the moment of) merging the root PR.**

The moment the root PR merges to `main`, `main-deploy.yml` triggers automatically and runs `wrangler deploy`. That command requires **Workers: Edit** scope. If the token still has only **Pages: Edit** scope, the deploy job immediately red-fails with an authorization error.

**What to do:**

1. Go to [Cloudflare Dashboard → My Profile → API Tokens](https://dash.cloudflare.com/profile/api-tokens).
2. Find the token currently used as the `CLOUDFLARE_API_TOKEN` GitHub secret.
3. Edit it: remove or replace the **Cloudflare Pages: Edit** permission with **Workers Scripts: Edit** (also called "Workers: Edit" in the UI).
   - If the token is shared with other projects that still use Pages, create a new token with Workers: Edit and update only the GitHub secret for this repo.
4. Update the GitHub Actions secret at: Settings → Secrets and variables → Actions → `CLOUDFLARE_API_TOKEN`.

Both `main-deploy.yml` and `pr-checks.yml` carry this comment as a reminder:

```
# CLOUDFLARE_API_TOKEN requires Workers: Edit scope (NOT Pages: Edit)
```

---

## Step 1 — One-time worker subdomain bootstrap

> **HUMAN ACTION — run once per account, after the token is re-scoped.**

`wrangler deploy` uploads the worker bundle and sets `workers_dev = true` (from `wrangler.toml`), but the **account-level workers.dev subdomain flag** for a brand-new worker is off until explicitly enabled. Until enabled:

- `wrangler deploy` succeeds (the bundle is uploaded)
- Requests to `zudo-cloudflare-wisdom.takazudo.workers.dev` return **Cloudflare error 1042** ("preview URLs disabled / subdomain not enabled")
- PR preview URLs in the format `https://pr-<N>-zudo-cloudflare-wisdom.takazudo.workers.dev` also return 1042

**Enable the subdomain via the CF REST API:**

```bash
# Account ID from wrangler whoami: 367c7f51801e1f537030f93d5a5e6008
# Worker script name (from wrangler.toml `name`): zudo-cloudflare-wisdom

curl -s -X POST \
  "https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/workers/scripts/zudo-cloudflare-wisdom/subdomain" \
  -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"enabled": true}' | jq .
```

Expected response:

```json
{
  "result": { "subdomain": "takazudo", "enabled": true, "previews_enabled": true },
  "success": true,
  "errors": [],
  "messages": []
}
```

After this, both the production workers.dev URL and PR preview alias URLs will resolve. The PR preview workflow (`pr-checks.yml`) already handles the case where no preview URL is emitted (posts "preview pending" comment instead of failing the check).

---

## Step 2 — Attach the custom domain

> **HUMAN ACTION — run once, after step 1.**

The `wrangler.toml` already declares:

```toml
[[routes]]
pattern = "zudo-cloudflare-wisdom.takazudomodular.com"
custom_domain = true
```

And `src/config/settings.ts` sets:

```typescript
siteUrl: "https://zudo-cloudflare-wisdom.takazudomodular.com"
```

The domain host in `wrangler.toml` **must** match `settings.siteUrl`'s host — it does.

**Attach the custom domain via the Cloudflare Dashboard:**

1. Go to [Workers & Pages](https://dash.cloudflare.com) → select the `zudo-cloudflare-wisdom` worker.
2. Click **Settings** → **Domains & Routes** → **Add Custom Domain**.
3. Enter `zudo-cloudflare-wisdom.takazudomodular.com` and click Save.
4. Cloudflare automatically provisions a TLS certificate and adds a DNS CNAME in the `takazudomodular.com` zone.

Alternatively via API:

```bash
curl -s -X POST \
  "https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/workers/domains" \
  -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{
    \"hostname\": \"zudo-cloudflare-wisdom.takazudomodular.com\",
    \"service\": \"zudo-cloudflare-wisdom\",
    \"environment\": \"production\",
    \"zone_name\": \"takazudomodular.com\"
  }" | jq .
```

**Note:** This step requires the `CLOUDFLARE_API_TOKEN` to also have **Zone: Edit** (or at minimum DNS: Edit) scope for the `takazudomodular.com` zone, in addition to Workers: Edit.

---

## Step 3 — Verify production and PR previews

> **HUMAN VERIFICATION — after steps 0–2 are complete.**

1. **Production site:** Open `https://zudo-cloudflare-wisdom.takazudomodular.com/` — confirm the site loads with correct content, navigation, and styles.
2. **workers.dev URL:** Open `https://zudo-cloudflare-wisdom.takazudo.workers.dev/` — confirm it routes (should serve the same site).
3. **PR preview:** Open or create a PR targeting `main`. Wait for `pr-checks.yml` to complete. Confirm the bot comment contains a `https://pr-<N>-*.workers.dev` URL and that URL loads.
4. **HTTPS / TLS:** Confirm no browser certificate warnings on the custom domain.
5. **Canonical / noindex check:** Verify the Workers site serves the correct canonical URL (`https://zudo-cloudflare-wisdom.takazudomodular.com/`) and no unintended noindex headers.

---

## Step 4 — Decommission the old Cloudflare Pages project

> **HUMAN ACTION — after step 3 confirms production is healthy.**

The old site (`zudo-cloudflare` Pages project, served at `https://<pages-project>.pages.dev/pj/zudo-cloudflare/`) must not remain indexable alongside the new Workers site.

**Options (pick one):**

### Option A — Delete the Pages project (cleanest)

1. Cloudflare Dashboard → Workers & Pages → `zudo-cloudflare` → Settings → Delete.
2. This removes all Pages preview URLs and the production Pages URL immediately.

### Option B — Add noindex headers to the Pages project (gentler transition)

1. In the Pages project's settings, add a `_headers` file (or edit it if it exists) at the project root:
   ```
   /*
     X-Robots-Tag: noindex, nofollow
   ```
2. Redeploy the Pages project.
3. Submit `https://<pages-domain>/pj/zudo-cloudflare/` for removal from Google Search Console.

### Option C — Add a `robots.txt` disallow (weakest)

Add or update `public/robots.txt` in the old Pages repo to disallow all crawlers.

**Recommended: Option A** — the content is now served by Workers; the Pages project has no reason to stay alive.

---

## Expected Half-Live State (post-merge, pre-cutover)

| Condition | Behavior |
|---|---|
| Token not yet re-scoped | `main-deploy` deploy job **RED** (auth error). Expected. |
| Subdomain not yet enabled (step 1 pending) | Worker uploaded but `*.workers.dev` URLs return error 1042. PR preview comment says "preview pending". |
| Custom domain not attached (step 2 pending) | Custom domain `zudo-cloudflare-wisdom.takazudomodular.com` returns 404/connection refused. Old Pages site still serving. |
| All steps done | New Workers site live at custom domain + workers.dev. Old Pages site can be decommissioned. |

---

## Verification (automated)

Run locally from the repo root before or after merge (does NOT mutate the account).

### `pnpm check` — type check

```
$ pnpm check
✓ checked 2 collections and tsc — no errors
```

Result: **PASS**

### `pnpm build` — confirm `dist/_worker.js` exists

```
$ pnpm build
info adapter `@takazudo/zfb-adapter-cloudflare`:
info   wrote ./dist/_worker.js
info   wrote ./dist/_zfb_inner.mjs
✓ 72 pages built in 7.64s
```

`dist/_worker.js`: 2,953 bytes  
`dist/_zfb_inner.mjs`: 141,501 bytes

Result: **PASS** — `dist/_worker.js` present.

### `npx wrangler@4.85.0 whoami` — auth + account

```
$ npx "wrangler@4.85.0" whoami
👋 You are logged in with an User API Token, associated with the email takazudo@gmail.com.
┌──────────────────────────────┬──────────────────────────────────┐
│ Account Name                 │ Account ID                       │
├──────────────────────────────┼──────────────────────────────────┤
│ Takazudo@gmail.com's Account │ 367c7f51801e1f537030f93d5a5e6008 │
└──────────────────────────────┴──────────────────────────────────┘
```

Result: **PASS** — token resolves to expected account.

### `npx wrangler@4.85.0 deploy --dry-run` — validate bundle without publishing

Run after `pnpm build` (requires `dist/` to exist and `.assetsignore` to be written):

```bash
printf '%s\n' '_worker.js' '_zfb_inner.mjs' > dist/.assetsignore
npx "wrangler@4.85.0" deploy --dry-run
```

Output:

```
 ⛅️ wrangler 4.85.0
✨ Read 508 files from the assets directory ./dist
Total Upload: 163.01 KiB / gzip: 41.84 KiB
Your Worker has access to the following bindings:
Binding            Resource
env.ASSETS         Assets

--dry-run: exiting now.
```

Result: **PASS** — wrangler parsed `wrangler.toml`, bundled the worker, and exited cleanly without publishing. No auth required for `--dry-run`.

### `wrangler.toml` sanity check

Key values confirmed:

| Key | Value |
|---|---|
| `name` | `zudo-cloudflare-wisdom` |
| `main` | `./dist/_worker.js` |
| `workers_dev` | `true` |
| `preview_urls` | `true` |
| `[[routes]].pattern` | `zudo-cloudflare-wisdom.takazudomodular.com` |
| `[[routes]].custom_domain` | `true` |
| `settings.siteUrl` host | `zudo-cloudflare-wisdom.takazudomodular.com` |

Route host matches `siteUrl` host: **YES**  
`workers_dev` / `preview_urls` placement: above `[assets]` section (correct per TOML scoping rule documented in `wrangler.toml`): **YES**

---

## Summary Checklist

- [ ] **BEFORE/AT MERGE** — Re-scope `CLOUDFLARE_API_TOKEN` to Workers: Edit (step 0)
- [ ] Run post-merge: Enable workers.dev subdomain via API (step 1)
- [ ] Attach custom domain `zudo-cloudflare-wisdom.takazudomodular.com` (step 2)
- [ ] Verify production and PR preview routes (step 3)
- [ ] Decommission old `zudo-cloudflare` Pages project (step 4)
