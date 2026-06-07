# zudo-doc → zfb migration: cutover checklist

This branch (`base/zudo-doc-zfb-migration`) migrates this site from Astro to the
new zfb-based zudo-doc and changes the deploy from **Cloudflare Pages** (sub-path
`/pj/zudo-cloudflare`) to **Cloudflare Workers static assets** at a dedicated
subdomain **`https://zudo-cloudflare.takazudomodular.com/`** (base `/`).

Everything below is **human-gated, mostly post-merge**. The CI in this PR builds
and (on `main`) runs `wrangler deploy`, but the one-time token re-scope, domain +
DNS, redirect, and old-stack teardown steps must be done by a human with
Cloudflare account access. The migration code itself is complete on
`base/zudo-doc-zfb-migration`.

**Key facts**

- Worker name: `zudo-cloudflare-wisdom` (see `wrangler.toml`)
- New subdomain (base `/`): `https://zudo-cloudflare.takazudomodular.com/`
- Old URL (Cloudflare Pages, subpath): `https://takazudomodular.com/pj/zudo-cloudflare`
- Secrets used by CI: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `IFTTT_PROD_NOTIFY`

## 0. Pre-req — confirm the API token scope ⚠️ (blocks deploy)

- [ ] Confirm `CLOUDFLARE_API_TOKEN` has **Workers Scripts: Edit** (a Pages-scoped
      token cannot deploy a Worker). CI evidence shows `wrangler versions upload`
      already succeeds, so this appears satisfied — confirm in the dashboard.
- [ ] Confirm the `CLOUDFLARE_ACCOUNT_ID` secret is still correct.
- [ ] Ensure the account's `workers.dev` subdomain is set up. Without it,
      `wrangler versions upload --preview-alias` returns no `*.workers.dev` URL and
      the preview-deploy job cannot post a preview link.

## 1. Preview validation (CI does this on the migration PR)

- [ ] Confirm the non-deploy `pr-checks` jobs are green: typecheck,
      template-drift, pin-parity, build-site, link-check, html-validate,
      build-history.
- [ ] Confirm the `preview` job succeeds. It runs
      `wrangler versions upload --preview-alias <pr>` and posts a `*.workers.dev`
      URL as a PR comment.
- [ ] Open the preview URL and spot-check EN + JA, sidebar/header nav, search,
      admonitions, mermaid, and HtmlPreview render correctly and match the current
      site.

## 2. Production deploy

- [ ] Merge the migration PR into `main` (or deploy from the branch first if you
      prefer to verify before merge).
- [ ] `main-deploy.yml` runs on push to `main`: build → build-history →
      html-validate → `npx wrangler@4 deploy` → IFTTT notify. Confirm it goes
      green.
- [ ] (Optional manual) `npx wrangler@4 deploy` from a checkout of the merged
      branch (Wrangler authenticated).

## 3. Bind the custom subdomain (DNS + route)

- [ ] In the Cloudflare dashboard → Workers & Pages → `zudo-cloudflare-wisdom` →
      Settings → Domains & Routes → **Add Custom Domain** →
      `zudo-cloudflare.takazudomodular.com`. Cloudflare auto-creates the DNS
      record + route (matches the `[[routes]] custom_domain = true` entry in
      `wrangler.toml`) and issues the TLS cert automatically.
- [ ] Wait for the cert to issue; confirm
      `https://zudo-cloudflare.takazudomodular.com/` serves the new site (200,
      EN + JA, `/docs/...` root-relative).

## 4. Old-URL redirect (preserve links / SEO)

- [ ] Redirect the old `https://takazudomodular.com/pj/zudo-cloudflare/*` →
      `https://zudo-cloudflare.takazudomodular.com/*`. Options:
  - On the **old Pages project**: add a `_redirects` rule (e.g.
    `/pj/zudo-cloudflare/* https://zudo-cloudflare.takazudomodular.com/:splat 301`)
    and redeploy it, **or**
  - A zone-level **Bulk Redirect / Redirect Rule** on `takazudomodular.com` for
    the `/pj/zudo-cloudflare/*` path prefix (preserve the per-page path where
    possible).
- [ ] Verify a few old deep links 301 to the new subdomain.

## 5. Rollback plan (keep until verified)

- [ ] **Do NOT decommission the old Pages project yet.** Keep it live as the
      rollback target.
- [ ] Single switch back: remove the custom domain from the Worker (or revert the
      DNS/route) → traffic falls back to the old Pages URL. The redirect rule
      (step 4) is the only thing to also pause if rolling back.

## 6. Cache invalidation

- [ ] After cutover, purge cache for `zudo-cloudflare.takazudomodular.com` (and
      the old `/pj/zudo-cloudflare` path if redirect caching is sticky) in the
      Cloudflare dashboard → Caching → Purge.

## 7. Decommission old Pages project (LAST — only after Worker is healthy)

- [ ] After the Worker has served correctly for a confidence window (e.g.
      24–48h) AND the redirect works, delete the old Cloudflare **Pages** project
      `zudo-cloudflare`. Do NOT delete before the redirect is verified.
- [ ] Remove any now-dead Pages-specific secrets/settings if not shared.

---

When all boxes are checked and the Worker is healthy, the cutover is complete.
The CI/PR portion (PR-checks green + working `*.workers.dev` preview) is verified
by the automated workflow; the deploy / DNS / redirect / decommission steps are
manual.
