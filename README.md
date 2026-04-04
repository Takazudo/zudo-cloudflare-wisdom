# zudo-cloudflare-wisdom

Takazudo's personal Cloudflare dev notes. Not official Cloudflare documentation.

Written for personal reference and AI-assisted coding.

## Topics

- Cloudflare Pages: deployment, _redirects, base paths, preview deploys
- Pages Functions: file-based routing, TypeScript, bindings
- Workers: standalone workers, wrangler config, deployment
- Storage: KV, D1, R2 bindings and usage patterns
- CI/CD: GitHub Actions deploy workflows, preview per PR
- Recipes: real-world patterns from Astro + Pages, search APIs, auth

## Development

```bash
pnpm install
pnpm dev        # http://localhost:4821/pj/zudo-cloudflare/
pnpm build
pnpm b4push     # pre-push validation
```

## License

Content is personal notes. Use at your own risk.
