# ZUDO_DEPS_PINS

Provenance for artifacts vendored or generated from first-party (takazudo/zudolab) upstreams.
Updated by /dev-bump-zudo-deps on every sync — keep `pinned:` accurate.

## create-zudo-doc scaffold

- repo: zudolab/zudo-doc
- what: generated doc-site scaffold, selectively customized and drift-gated
- files: pages/docs/[[...slug]].tsx, pages/index.tsx, pages/[locale]/docs/[[...slug]].tsx, public/favicon-16x16.png, public/favicon-32x32.png, public/favicon.ico, public/favicon.svg, scripts/check-links.js, scripts/setup-doc-skill.sh, src/styles/global.css, tsconfig.json
- source: packages/create-zudo-doc/templates/base/ -> repo root; packages/create-zudo-doc/templates/features/i18n/files/ -> repo root
- track: releases
- pinned: 82049856397927077c5288465db34e44d0939260 (v7.0.0; published create-zudo-doc@7.0.0)
- updated: 2026-10-15
- notes: Three-way reconciled published create-zudo-doc 5.28.1/current host/7.0.0 template bytes without running the initializer. tsconfig.json and src/styles/global.css adopt v7 exactly; unchanged favicon, index, link-checker and skill-generator bytes remain exact. Both doc route stubs retain the generator's docHistory feature patch using DocHistoryBoundary, with a corrected EN boundary comment; these are the only allowlisted template divergences. Preserve explicit cloudflare-wisdom package script arguments, matcha theme, logo, wide home, locale navigation and Workers adapter in host-owned config. Registry provenance attests v7.0.0 to the pinned commit; source tag matches. All non-allowlisted files pass check:template-drift against the installed 7.0.0 release.
