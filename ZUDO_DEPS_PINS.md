# ZUDO_DEPS_PINS

Provenance for artifacts vendored or generated from first-party (takazudo/zudolab) upstreams.
Updated by /dev-bump-zudo-deps on every sync — keep `pinned:` accurate.

## create-zudo-doc scaffold

- repo: zudolab/zudo-doc
- what: generated doc-site scaffold, selectively customized and drift-gated
- files: pages/docs/[[...slug]].tsx, pages/index.tsx, pages/[locale]/docs/[[...slug]].tsx, public/favicon-16x16.png, public/favicon-32x32.png, public/favicon.ico, public/favicon.svg, scripts/check-links.js, scripts/setup-doc-skill.sh, src/styles/global.css, tsconfig.json
- source: packages/create-zudo-doc/templates/base/ -> repo root; packages/create-zudo-doc/templates/features/i18n/files/ -> repo root
- track: releases
- pinned: 70c574747e498c47f35fa9051ab36b0a69ac808d (v10.0.0; published create-zudo-doc@10.0.0)
- updated: 2026-11-10
- notes: Reconciled host files against published create-zudo-doc 10.0.0 templates without running the initializer. tsconfig.json, src/styles/global.css, favicons, pages/index.tsx, and scripts/check-links.js match the template. scripts/setup-doc-skill.sh was re-copied from the 10.0.0 template; package.json still passes the explicit cloudflare-wisdom skill-name argument. Both doc route stubs keep the generator's docHistory patch (DocHistoryBoundary from @takazudo/zudo-doc/doc-history-area) and the corrected EN boundary comment; those two files are the only allowlisted divergences. Host config keeps the Workers adapter, logo, wide home, and locale navigation. themePack is omitted so this light/dark site resolves to Graphite. Wrangler stays at 4.85.0, the exact version the zfb 6.0.1 preview gate expects. Design-token panel is off, so @takazudo/zdtp is not a direct dependency. Registry tag v10.0.0 matches the pinned commit. Non-allowlisted files pass check:template-drift against installed zudo-doc 10.0.0.
