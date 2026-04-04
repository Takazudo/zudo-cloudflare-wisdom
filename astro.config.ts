import { defineConfig } from "astro/config";
import { fileURLToPath } from "node:url";
import mdx from "@astrojs/mdx";
import react from "@astrojs/react";
import {
  transformerMetaHighlight,
  transformerMetaWordHighlight,
} from "@shikijs/transformers";
import tailwindcss from "@tailwindcss/vite";
import { colorSchemes } from "./src/config/color-schemes";
import { settings } from "./src/config/settings";
import { claudeResourcesIntegration } from "./src/integrations/claude-resources";
import { searchIndexIntegration } from "./src/integrations/search-index";
import remarkDirective from "remark-directive";
import { remarkAdmonitions } from "./src/plugins/remark-admonitions";
import { remarkResolveMarkdownLinks } from "./src/plugins/remark-resolve-markdown-links";
import { rehypeCodeTitle } from "./src/plugins/rehype-code-title";
import { rehypeHeadingLinks } from "./src/plugins/rehype-heading-links";
import { rehypeMermaid } from "./src/plugins/rehype-mermaid";
import { rehypeStripMdExtension } from "./src/plugins/rehype-strip-md-extension";

const activeScheme = colorSchemes[settings.colorScheme];
const shikiTheme = activeScheme?.shikiTheme ?? "dracula";

const shikiTransformers = [
  transformerMetaHighlight(),
  transformerMetaWordHighlight(),
];

const shikiConfig = settings.colorMode
  ? {
      themes: {
        light:
          colorSchemes[settings.colorMode.lightScheme]?.shikiTheme ??
          "github-light",
        dark:
          colorSchemes[settings.colorMode.darkScheme]?.shikiTheme ?? "dracula",
      },
      defaultColor: false as const,
      transformers: shikiTransformers,
    }
  : {
      theme: shikiTheme,
      transformers: shikiTransformers,
    };

export default defineConfig({
  output: "static",
  base: settings.base,
  server: { port: 4821 },
  integrations: [
    mdx(),
    react(),
    searchIndexIntegration(),
    ...(settings.claudeResources
      ? [claudeResourcesIntegration(settings.claudeResources)]
      : []),
  ],
  i18n: {
    defaultLocale: "en",
    locales: ["en", ...Object.keys(settings.locales)],
    routing: {
      prefixDefaultLocale: false,
    },
  },
  vite: {
    plugins: [tailwindcss()],
  },
  markdown: {
    shikiConfig,
    remarkPlugins: [
      remarkDirective, // Must run before remarkAdmonitions
      remarkAdmonitions,
      [remarkResolveMarkdownLinks, {
        rootDir: fileURLToPath(new URL(".", import.meta.url)),
        docsDir: settings.docsDir,
        locales: Object.fromEntries(
          Object.entries(settings.locales).map(([code, config]) => [code, { dir: config.dir }])
        ),
        versions: settings.versions
          ? settings.versions.map((v) => ({ slug: v.slug, docsDir: v.docsDir }))
          : false,
        base: settings.base,
        trailingSlash: settings.trailingSlash,
        onBrokenLinks: settings.onBrokenMarkdownLinks,
      }],
    ],
    rehypePlugins: [
      rehypeCodeTitle,
      rehypeHeadingLinks, // Must run before Astro's built-in heading ID plugin
      rehypeStripMdExtension, // Strips .md/.mdx from raw HTML <a> tags (remark plugin handles mdast links)
      ...(settings.mermaid ? [rehypeMermaid] : []),
    ],
  },
});
