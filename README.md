# zudo-cloudflare-wisdom

Takazudo's personal Cloudflare dev notes, built with zudo-doc (zfb stack, MDX, Tailwind CSS v4).

**Live site**: <https://zudo-cloudflare-wisdom.takazudomodular.com/>

Not official Cloudflare documentation. Written for personal reference and AI-assisted coding.

## Topics

- Cloudflare Pages: deployment, _redirects, base paths, preview deploys
- Pages Functions: file-based routing, TypeScript, bindings
- Workers: standalone workers, wrangler config, deployment
- Storage: KV, D1, R2 bindings and usage patterns
- CI/CD: GitHub Actions deploy workflows, preview per PR
- Recipes: real-world patterns from Astro + Pages, search APIs, auth

## Commands

```bash
pnpm install
pnpm dev        # http://localhost:4321/
pnpm build
pnpm b4push     # pre-push validation
```

## Project Layout

```
pages/          # Host-app routing layer (zfb entry points)
src/content/    # MDX doc pages (docs/ + docs-ja/)
plugins/        # zfb integration plugins (.mjs)
zfb.config.ts   # Build config
```

## Hosting & CI/CD

- **Hosting**: Cloudflare Workers static assets
- **PR checks**: typecheck + build + Workers preview URL posted as PR comment
- **Main deploy**: build → Workers production + IFTTT notification

## License

Content is personal notes. Use at your own risk.
