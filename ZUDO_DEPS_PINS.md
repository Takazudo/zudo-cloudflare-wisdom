# ZUDO_DEPS_PINS

Provenance for artifacts vendored or generated from first-party (takazudo/zudolab) upstreams.
Updated by /dev-bump-zudo-deps on every sync — keep `pinned:` accurate.

## create-zudo-doc scaffold

- repo: zudolab/zudo-doc
- what: generated doc-site scaffold, selectively customized and drift-gated
- files: pages/docs/[[...slug]].tsx, pages/index.tsx, pages/[locale]/docs/[[...slug]].tsx, public/favicon-16x16.png, public/favicon-32x32.png, public/favicon.ico, public/favicon.svg, scripts/check-links.js, scripts/setup-doc-skill.sh, src/styles/global.css, tsconfig.json
- source: packages/create-zudo-doc/templates/base/ -> repo root; packages/create-zudo-doc/templates/features/i18n/files/ -> repo root
- track: releases
- pinned: 58839021301cb6b5b4bf2eb950a285f910ca8ca1 (v5.26.2)
- updated: 2026-09-20
- notes: The two doc route stubs are patched for doc history; preserve that intentional divergence in .template-drift-allowlist and the package scripts' explicit `cloudflare-wisdom` skill-name arguments, while non-allowlisted scaffold files (including check-links.js, whose upstream parser now supports unquoted attributes) must match upstream exactly. global.css is byte-identical to the v5.26.2 template; Matcha typography is selected through zfb.config.ts.
