import { defineConfig } from "zfb/config";
import { zudoDoc } from "@takazudo/zudo-doc/config";

// zudo-doc v4 single-entry config. `zudoDoc()` shallow-merges these fields over
// the package defaults and returns a complete ZfbConfig (framework, tailwind,
// collections, plugins, markdown, package-owned routes are all supplied
// internally — the host sets only what differs from the defaults). Fields left
// at their documented @default are intentionally omitted:
//   - colorScheme "Default Dark" + colorMode { defaultMode: "dark", lightScheme:
//     "Default Light", darkScheme: "Default Dark", respectPrefersColorScheme:
//     true } — the v4 default IS dark-default, matching this site's dark-first
//     brand, so no colorMode override is needed.
//   - directives (the canonical seven, incl. caution/details), buildDocsSchema,
//     translations (en/ja/de), colorSchemes (Default Light/Dark) — this site
//     uses the package defaults verbatim.
//   - base "/", mermaid true, trailingSlash false, port 4321, packageOwnedRoutes
//     true, docsDir, defaultLocale "en", tocMin/MaxDepth.
export default defineConfig(
  zudoDoc({
    siteName: "zudo-cloudflare-wisdom",
    siteDescription: "Takazudo's Cloudflare dev notes for me and AI agents",
    githubUrl: "https://github.com/Takazudo/zudo-cloudflare-wisdom",
    siteUrl: "https://zudo-cloudflare-wisdom.takazudomodular.com",
    // Deploy target: Cloudflare Workers static assets (wrangler.toml `main`
    // points at dist/_worker.js). REQUIRED — the default is a pure static build
    // that emits no _worker.js, which would break `wrangler deploy`.
    adapter: "@takazudo/zfb-adapter-cloudflare",
    locales: {
      ja: { label: "JA", dir: "src/content/docs-ja" },
    },
    metaTags: {
      description: true,
      keywords: "",
      ogImage: "/img/ogp.png",
      ogSiteName: true,
      twitterCard: "summary_large_image",
      twitterCreator: "@Takazudo",
    },
    // Noto Sans JP webfont for JA + Latin body text. Emitted as real <head>
    // links (preconnect + async stylesheet); global.css points --font-sans at
    // it. Never load the font via CSS @import — Tailwind v4 bundling can push
    // it past the first style rule and the browser silently drops it.
    head: {
      preconnect: [
        { href: "https://fonts.googleapis.com" },
        { href: "https://fonts.gstatic.com", crossorigin: "anonymous" },
      ],
      stylesheets: [
        {
          href: "https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@300;400;500;700&display=swap",
          async: true,
        },
      ],
    },
    llmsTxt: true,
    cjkFriendly: true,
    sidebarResizer: true,
    sidebarToggle: true,
    imageEnlarge: true,
    docHistory: true,
    bodyFootUtilArea: {
      docHistory: true,
      viewSourceLink: false,
    },
    claudeResources: {
      claudeDir: ".claude",
    },
    defaultLocaleOnlyPrefixes: [
      "/docs/claude-md/",
      "/docs/claude-skills/",
      "/docs/claude-agents/",
      "/docs/claude-commands/",
    ],
    footer: {
      links: [],
      copyright: `Copyright © ${new Date().getFullYear()} <a href="https://x.com/Takazudo">Takazudo</a>. Built with <a href="https://zudo-doc.takazudomodular.com/">zudo-doc</a>. Enjoy synth on <a href="https://takazudomodular.com/">Takazudo Modular</a>.`,
    },
    headerNav: [
      { label: "Overview", path: "/docs/getting-started", categoryMatch: "getting-started" },
      { label: "Pages", path: "/docs/pages", categoryMatch: "pages" },
      { label: "Workers", path: "/docs/workers", categoryMatch: "workers" },
      { label: "AI", path: "/docs/ai", categoryMatch: "ai" },
      { label: "Storage", path: "/docs/storage", categoryMatch: "storage" },
      { label: "CI/CD", path: "/docs/cicd", categoryMatch: "cicd" },
      { label: "Recipes", path: "/docs/recipes", categoryMatch: "recipes" },
      { label: "Claude", path: "/docs/claude", categoryMatch: "claude" },
    ],
    headerRightItems: [
      { type: "component", component: "github-link" },
      { type: "component", component: "theme-toggle" },
      { type: "component", component: "search" },
      { type: "component", component: "language-switcher" },
    ],
  }),
);
