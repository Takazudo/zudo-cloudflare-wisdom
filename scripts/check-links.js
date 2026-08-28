#!/usr/bin/env node

/**
 * check-links.js — Post-build broken link checker
 *
 * Mode 1: Scan built HTML in dist/ for broken internal links
 * Mode 2: Scan MDX source for absolute links bypassing base path
 */

import { readFile, readdir, access } from "node:fs/promises";
import { join, extname, resolve, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = fileURLToPath(new URL(".", import.meta.url));

// --- Utilities ---

export async function parseBasePath(settingsPath) {
  const content = await readFile(settingsPath, "utf-8");
  const match = content.match(/base:\s*["']([^"']*)["']/);
  return match ? match[1] : "/";
}

export async function parseTrailingSlash(settingsPath) {
  const content = await readFile(settingsPath, "utf-8");
  const match = content.match(/trailingSlash:\s*(true|false)/);
  return match ? match[1] === "true" : false;
}

export async function parseContentDirs(settingsPath) {
  const content = await readFile(settingsPath, "utf-8");

  // Extract docsDir
  const docsDirMatch = content.match(/docsDir:\s*["']([^"']*)["']/);
  const docsDir = docsDirMatch ? docsDirMatch[1] : "src/content/docs";

  // Extract locale content dirs. Supports both the legacy `docsJaDir: "..."`
  // form and the current settings shape `locales: { ja: { dir: "..." } }`.
  const localeDirs = [];
  const legacyRegex = /docs[A-Z][a-z]+Dir:\s*["']([^"']*)["']/g;
  let legacyMatch;
  while ((legacyMatch = legacyRegex.exec(content)) !== null) {
    localeDirs.push(legacyMatch[1]);
  }
  // Current shape: pull each `dir: "..."` out of the `locales` object.
  const localesBlockMatch = content.match(/locales:\s*\{([\s\S]*?)\n\s*\},?/);
  if (localesBlockMatch) {
    const dirRegex = /\bdir:\s*["']([^"']*)["']/g;
    let dirMatch;
    while ((dirMatch = dirRegex.exec(localesBlockMatch[1])) !== null) {
      localeDirs.push(dirMatch[1]);
    }
  }

  return { docsDir, localeDirs: [...new Set(localeDirs)] };
}

async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function collectFiles(dir, extensions) {
  const results = [];

  async function walk(current) {
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (extensions.some((ext) => entry.name.endsWith(ext))) {
        results.push(full);
      }
    }
  }

  await walk(dir);
  return results.sort();
}

// --- HTML Link Extraction ---

// The production build is minified and emits **unquoted** attribute values
// (`href=/docs/foo` / `id=bindings-images`), so an extractor that only matches
// quoted values silently finds zero links. Accept all three HTML forms.
const HREF_REGEX = /<a\s[^>]*?href=(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gi;

/** Decode the handful of entities that can legally appear inside an attribute. */
function decodeAttr(value) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'");
}

function isExternalOrNonNavigable(href) {
  return (
    /^https?:\/\//i.test(href) ||
    /^\/\//.test(href) ||
    /^mailto:/i.test(href) ||
    /^javascript:/i.test(href) ||
    /^data:/i.test(href) ||
    /^tel:/i.test(href)
  );
}

/**
 * Extract every in-site `<a href>` from built HTML.
 *
 * `includeFragmentOnly` keeps same-page `#anchor` links, which the path-oriented
 * callers skip but the anchor checker needs.
 */
export function extractHtmlLinks(html, { includeFragmentOnly = false } = {}) {
  const links = [];
  HREF_REGEX.lastIndex = 0;
  let match;
  let lastIndex = 0;
  let currentLine = 1;
  while ((match = HREF_REGEX.exec(html)) !== null) {
    const raw = match[1] ?? match[2] ?? match[3];
    if (raw === undefined) continue;
    const href = decodeAttr(raw);
    if (isExternalOrNonNavigable(href)) continue;
    if (!includeFragmentOnly && /^#/.test(href)) continue;

    for (let i = lastIndex; i < match.index; i++) {
      if (html[i] === '\n') currentLine++;
    }
    lastIndex = match.index;
    links.push({ href, line: currentLine });
  }
  return links;
}

/**
 * Collect every fragment target a page offers: element ids plus legacy
 * `<a name>` anchors. Handles quoted and unquoted attribute values.
 */
export function extractHtmlIds(html) {
  const ids = new Set();
  const patterns = [
    /\sid=(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gi,
    /<a\s(?:[^>]*?\s)?name=(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gi,
  ];
  for (const regex of patterns) {
    regex.lastIndex = 0;
    let match;
    while ((match = regex.exec(html)) !== null) {
      const raw = match[1] ?? match[2] ?? match[3];
      if (raw) ids.add(decodeAttr(raw));
    }
  }
  return ids;
}

// --- Link Resolution ---

/**
 * Resolve a link and return its resolution type:
 *   'root'           — empty path or resolves to the site root (always valid)
 *   'file'           — resolved to a file with an extension or a .html file
 *   'directoryIndex' — resolved via dir/index.html (page link without trailing slash)
 *   'missing'        — target does not exist
 */
export async function resolveLinkDetail(href, distDir, basePath = "/", fileDir = "") {
  const clean = href.split("#")[0].split("?")[0];
  if (!clean) return "root";

  let absolute = clean;

  // Resolve relative links against the file's directory within dist
  if (!clean.startsWith("/")) {
    // Relative link — resolve against the file's containing directory
    const dirInDist = fileDir ? relative(distDir, fileDir) : "";
    absolute = "/" + join(dirInDist, clean);
  }

  // Strip base path prefix from the href to get the path relative to dist/
  let stripped = absolute;
  if (basePath !== "/" && stripped.startsWith(basePath)) {
    stripped = "/" + stripped.slice(basePath.length);
  }

  const relPath = stripped.startsWith("/") ? stripped.slice(1) : stripped;
  if (!relPath) return "root";

  // Has file extension → check exact path
  if (extname(relPath)) {
    const exists = await fileExists(join(distDir, relPath));
    return exists ? "file" : "missing";
  }

  // Ends with / → check index.html inside
  if (relPath.endsWith("/")) {
    const exists = await fileExists(join(distDir, relPath, "index.html"));
    return exists ? "directoryIndex" : "missing";
  }

  // No extension, no trailing slash → try dir/index.html then .html
  if (await fileExists(join(distDir, relPath, "index.html"))) return "directoryIndex";
  if (await fileExists(join(distDir, relPath + ".html"))) return "file";
  return "missing";
}

export async function resolveLink(href, distDir, basePath = "/", fileDir = "") {
  const type = await resolveLinkDetail(href, distDir, basePath, fileDir);
  return type !== "missing";
}

/**
 * Resolve a link to the HTML file that serves it, or null when it resolves to
 * a non-HTML asset or does not exist. Mirrors resolveLinkDetail's path logic;
 * the anchor checker needs the file itself, not just whether it exists.
 */
export async function resolveLinkFile(href, distDir, basePath = "/", fileDir = "") {
  const clean = href.split("#")[0].split("?")[0];

  // A bare fragment has no path to resolve; the caller substitutes the
  // containing file as the target.
  if (!clean) return null;

  let absolute = clean;
  if (!clean.startsWith("/")) {
    const dirInDist = fileDir ? relative(distDir, fileDir) : "";
    absolute = "/" + join(dirInDist, clean);
  }

  let stripped = absolute;
  if (basePath !== "/" && stripped.startsWith(basePath)) {
    stripped = "/" + stripped.slice(basePath.length);
  }

  const relPath = stripped.startsWith("/") ? stripped.slice(1) : stripped;
  if (!relPath) {
    const root = join(distDir, "index.html");
    return (await fileExists(root)) ? root : null;
  }

  if (extname(relPath)) {
    if (extname(relPath).toLowerCase() !== ".html") return null;
    const exact = join(distDir, relPath);
    return (await fileExists(exact)) ? exact : null;
  }

  const asIndex = join(distDir, relPath, "index.html");
  if (await fileExists(asIndex)) return asIndex;
  const asHtml = join(distDir, relPath + ".html");
  if (await fileExists(asHtml)) return asHtml;
  return null;
}

/**
 * Verify that every `#fragment` in a built page actually exists on its target.
 *
 * The build only *warns* on an unresolvable anchor, and heading ids are scoped
 * under their parent h2 by zfb (`### Images` under `## Bindings` becomes
 * `bindings-images`), so a hand-written `#images` looks plausible and ships
 * broken. Path breakage is caught elsewhere; this checks fragments only, and
 * skips any link whose *path* does not resolve so the two never double-report.
 */
export async function checkHtmlAnchors(distDir, rootDir, basePath = "/", excludePatterns = []) {
  const broken = [];
  const htmlFiles = await collectFiles(distDir, [".html"]);
  const idCache = new Map();

  async function idsFor(file) {
    if (!idCache.has(file)) {
      idCache.set(file, extractHtmlIds(await readFile(file, "utf-8")));
    }
    return idCache.get(file);
  }

  for (const file of htmlFiles) {
    const content = await readFile(file, "utf-8");
    idCache.set(file, extractHtmlIds(content));
    const links = extractHtmlLinks(content, { includeFragmentOnly: true });
    const fileDir = dirname(file);

    for (const { href, line } of links) {
      if (excludePatterns.some((p) => p.test(href))) continue;

      const hashIndex = href.indexOf("#");
      if (hashIndex === -1) continue;
      const rawHash = href.slice(hashIndex + 1);
      if (!rawHash) continue; // bare "#" is a no-op link, not a broken anchor
      if (rawHash === "top") continue; // "#top" is a browser built-in

      // Fragments are percent-encoded in href but raw in the id attribute.
      let hash;
      try {
        hash = decodeURIComponent(rawHash);
      } catch {
        hash = rawHash;
      }

      const pathPart = href.slice(0, hashIndex);
      const target = pathPart
        ? await resolveLinkFile(pathPart, distDir, basePath, fileDir)
        : file;

      // Path is broken (reported by checkHtmlLinks) or points at a non-HTML
      // asset — either way there is no id set to check against.
      if (!target) continue;

      const ids = await idsFor(target);
      if (!ids.has(hash) && !ids.has(rawHash)) {
        broken.push({ file: relative(rootDir, file), line, href });
      }
    }
  }

  return broken;
}

// --- MDX Source Scan ---

/**
 * Strip inline-code spans from a line before running link regexes.
 * Handles double-backtick spans (``...``) and single-backtick spans (`...`).
 * Escaped backticks (\`) are ignored.
 */
export function stripInlineCode(line) {
  // Replace double-backtick spans first to avoid partial single-backtick matches
  let result = line.replace(/(?<!\\)``[^`]*(?:``|$)/g, (m) => " ".repeat(m.length));
  // Replace single-backtick spans
  result = result.replace(/(?<!\\)`[^`]*(?:`|$)/g, (m) => " ".repeat(m.length));
  return result;
}

export function extractMdxAbsoluteLinks(content) {
  const issues = [];
  const lines = content.split("\n");
  let inCodeBlock = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (/^```/.test(line.trimStart())) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock) continue;

    const searchLine = stripInlineCode(line);

    // Markdown link syntax: [text](/docs/...) or [text](/ja/docs/...)
    const mdRegex = /\]\((\/(?:ja\/)?docs\/[^)]*)\)/g;
    let match;
    while ((match = mdRegex.exec(searchLine)) !== null) {
      issues.push({ href: match[1], line: i + 1 });
    }

    // JSX href attributes: href="/docs/..." or href="/ja/docs/..."
    const jsxRegex = /href="(\/(?:ja\/)?docs\/[^"]*)"/g;
    while ((match = jsxRegex.exec(searchLine)) !== null) {
      issues.push({ href: match[1], line: i + 1 });
    }
  }

  return issues;
}

// --- Main Check Functions ---

export async function checkHtmlLinks(distDir, rootDir, basePath = "/", excludePatterns = []) {
  const broken = [];
  const htmlFiles = await collectFiles(distDir, [".html"]);
  const cache = new Map();

  for (const file of htmlFiles) {
    const content = await readFile(file, "utf-8");
    const links = extractHtmlLinks(content);
    const fileDir = dirname(file);

    for (const { href, line } of links) {
      if (excludePatterns.some((p) => p.test(href))) continue;

      // Cache key: absolute links use href only; relative links include fileDir
      const cacheKey = href.startsWith("/") ? href : `${fileDir}:${href}`;
      let exists;
      if (cache.has(cacheKey)) {
        exists = cache.get(cacheKey);
      } else {
        exists = await resolveLink(href, distDir, basePath, fileDir);
        cache.set(cacheKey, exists);
      }

      if (!exists) {
        broken.push({ file: relative(rootDir, file), line, href });
      }
    }
  }

  return broken;
}

export async function checkTrailingSlashLinks(distDir, rootDir, basePath = "/", excludePatterns = []) {
  const warnings = [];
  const htmlFiles = await collectFiles(distDir, [".html"]);
  const cache = new Map();

  for (const file of htmlFiles) {
    const content = await readFile(file, "utf-8");
    const links = extractHtmlLinks(content);
    const fileDir = dirname(file);

    for (const { href, line } of links) {
      if (excludePatterns.some((p) => p.test(href))) continue;

      // Extract path portion (strip query string and fragment)
      const pathPart = href.split("#")[0].split("?")[0];

      // Skip root-like paths: empty, "/", ".", "./"
      if (!pathPart || pathPart === "/" || pathPart === "." || pathPart === "./") continue;

      // Skip links that already have a trailing slash
      if (pathPart.endsWith("/")) continue;

      // Skip links with file extensions (assets)
      if (extname(pathPart)) continue;

      // Cache key: absolute links use href only; relative links include fileDir
      const cacheKey = href.startsWith("/") ? href : `${fileDir}:${href}`;
      let type;
      if (cache.has(cacheKey)) {
        type = cache.get(cacheKey);
      } else {
        type = await resolveLinkDetail(href, distDir, basePath, fileDir);
        cache.set(cacheKey, type);
      }

      // Only warn for links that resolve to a directory index (page links missing trailing slash)
      if (type === "directoryIndex") {
        warnings.push({ file: relative(rootDir, file), line, href });
      }
    }
  }

  return warnings;
}

export async function checkMdxLinks(contentDirs, rootDir, distDir = null, basePath = "/") {
  const warnings = [];

  for (const dir of contentDirs) {
    if (!(await fileExists(dir))) continue;
    const files = await collectFiles(dir, [".mdx", ".md"]);

    for (const file of files) {
      const content = await readFile(file, "utf-8");
      const issues = extractMdxAbsoluteLinks(content);

      for (const { href, line } of issues) {
        // If dist/ is available, drop warnings for hrefs that resolve to built routes
        if (distDir && (await resolveLink(href, distDir, basePath))) continue;
        warnings.push({ file: relative(rootDir, file), line, href });
      }
    }
  }

  return warnings;
}

// --- Report ---

export function formatReport(
  brokenLinks,
  mdxWarnings,
  trailingSlashWarnings = [],
  anchorWarnings = [],
) {
  const lines = [];

  if (brokenLinks.length > 0) {
    lines.push("=== Broken Links in Built HTML ===");
    for (const { file, line, href } of brokenLinks) {
      lines.push(`  ${file}:${line}  ${href}`);
    }
    lines.push("");
  }

  if (mdxWarnings.length > 0) {
    lines.push("=== Absolute Links Bypassing Base Path (MDX Source) ===");
    for (const { file, line, href } of mdxWarnings) {
      lines.push(`  ${file}:${line}  ${href}`);
    }
    lines.push("");
  }

  if (trailingSlashWarnings.length > 0) {
    lines.push("=== Links Missing Trailing Slash ===");
    for (const { file, line, href } of trailingSlashWarnings) {
      lines.push(`  ${file}:${line}  ${href}`);
    }
    lines.push("");
  }

  if (anchorWarnings.length > 0) {
    lines.push("=== Broken Anchors (#fragment has no matching id) ===");
    for (const { file, line, href } of anchorWarnings) {
      lines.push(`  ${file}:${line}  ${href}`);
    }
    lines.push("");
  }

  const total =
    brokenLinks.length +
    mdxWarnings.length +
    trailingSlashWarnings.length +
    anchorWarnings.length;
  if (total > 0) {
    const parts = [];
    if (brokenLinks.length > 0) {
      parts.push(
        `${brokenLinks.length} broken link${brokenLinks.length === 1 ? "" : "s"}`,
      );
    }
    if (mdxWarnings.length > 0) {
      parts.push(
        `${mdxWarnings.length} absolute path warning${mdxWarnings.length === 1 ? "" : "s"}`,
      );
    }
    if (trailingSlashWarnings.length > 0) {
      parts.push(
        `${trailingSlashWarnings.length} trailing slash warning${trailingSlashWarnings.length === 1 ? "" : "s"}`,
      );
    }
    if (anchorWarnings.length > 0) {
      parts.push(
        `${anchorWarnings.length} broken anchor${anchorWarnings.length === 1 ? "" : "s"}`,
      );
    }
    lines.push(`✗ Found ${parts.join(" and ")}`);
  } else {
    lines.push("✓ No broken links, anchors or absolute path issues found");
  }

  return lines.join("\n");
}

// --- Allowlist ---

/**
 * Read the allowlist file (one entry per line; `#` comments stripped).
 * Each non-blank line is a literal `<file>:<line>:<href>` exact match.
 * Returns a Set for O(1) lookup against `entryKey()` output below.
 */
export async function readAllowlist(allowlistPath) {
  if (!allowlistPath) return new Set();
  if (!(await fileExists(allowlistPath))) return new Set();
  const text = await readFile(allowlistPath, "utf-8");
  const lines = text
    .split("\n")
    .map((l) => l.replace(/#.*$/, "").trim())
    .filter((l) => l.length > 0);
  return new Set(lines);
}

function entryKey(e) {
  return `${e.file}:${e.line}:${e.href}`;
}

// --- Main ---

async function main() {
  const rootDir = resolve(__dirname, "..");
  // zudo-doc 4.x: site config lives in the single `zudoDoc()` call in
  // zfb.config.ts (the old src/config/settings.ts is gone). The parse* helpers
  // regex the same `base:` / `trailingSlash:` / `docsDir:` / `locales.*.dir`
  // field syntax, and fall back to defaults (base "/", trailingSlash false,
  // docsDir "src/content/docs") when a field is omitted at its default.
  const settingsPath = join(rootDir, "zfb.config.ts");
  const basePath = await parseBasePath(settingsPath);
  const trailingSlash = await parseTrailingSlash(settingsPath);
  const distDir = join(rootDir, "dist");

  console.log(`Checking links (base: ${basePath}, trailingSlash: ${trailingSlash})...\n`);

  if (!(await fileExists(distDir))) {
    console.error("Error: dist/ directory not found. Run 'pnpm build' first.");
    process.exit(1);
  }

  // Exclude versioned docs links — version content may be incomplete
  const excludePatterns = [/\/v\/[^/]+\//];

  const { docsDir, localeDirs } = await parseContentDirs(settingsPath);
  const contentDirs = [join(rootDir, docsDir), ...localeDirs.map((d) => join(rootDir, d))];

  const [brokenLinks, mdxWarnings, anchorWarnings, trailingSlashWarnings] = await Promise.all([
    checkHtmlLinks(distDir, rootDir, basePath, excludePatterns),
    checkMdxLinks(contentDirs, rootDir, distDir, basePath),
    checkHtmlAnchors(distDir, rootDir, basePath, excludePatterns),
    trailingSlash
      ? checkTrailingSlashLinks(distDir, rootDir, basePath, excludePatterns)
      : Promise.resolve([]),
  ]);

  // --- Flag parsing ---
  //
  // Three strict knobs (separable so a deploy can fail on real 404s
  // without blocking on warn-only categories) plus an allowlist:
  //
  //   --strict           legacy: fail when any category has entries
  //   --strict-broken    fail when broken links > 0 (after allowlist)
  //   --strict-absolute  fail when absolute warnings > 0 (after allowlist)
  //   --strict-trailing  fail when trailing-slash warnings > 0 (after allowlist)
  //   --strict-anchors   fail when broken #fragments > 0 (after allowlist)
  //   --allowlist=PATH   skip entries listed in PATH (one
  //                      `<file>:<line>:<href>` per line, `#` comments)
  const argv = process.argv.slice(2);
  const strict = argv.includes("--strict");
  const strictBroken = strict || argv.includes("--strict-broken");
  const strictAbsolute = strict || argv.includes("--strict-absolute");
  const strictTrailing = strict || argv.includes("--strict-trailing");
  const strictAnchors = strict || argv.includes("--strict-anchors");
  const allowlistArg = argv.find((a) => a.startsWith("--allowlist="));
  const allowlistPath = allowlistArg ? allowlistArg.split("=").slice(1).join("=") : null;
  const resolvedAllowlist = allowlistPath
    ? (allowlistPath.startsWith("/") ? allowlistPath : join(rootDir, allowlistPath))
    : null;
  const allowlist = await readAllowlist(resolvedAllowlist);

  // Filter out allowlisted entries before strict-mode decisions but
  // AFTER the printed report — so the report shows the full picture
  // and the strict gate counts only "real" entries.
  const filterOut = (entries) => entries.filter((e) => !allowlist.has(entryKey(e)));
  const realBroken = filterOut(brokenLinks);
  const realAbsolute = filterOut(mdxWarnings);
  const realTrailing = filterOut(trailingSlashWarnings);
  const realAnchors = filterOut(anchorWarnings);

  console.log(formatReport(brokenLinks, mdxWarnings, trailingSlashWarnings, anchorWarnings));

  if (allowlist.size > 0) {
    const skipped =
      (brokenLinks.length - realBroken.length) +
      (mdxWarnings.length - realAbsolute.length) +
      (trailingSlashWarnings.length - realTrailing.length) +
      (anchorWarnings.length - realAnchors.length);
    if (skipped > 0) {
      console.log(
        `\nAllowlist: ${skipped} known exception${skipped === 1 ? "" : "s"} excluded from strict-mode counts (${resolvedAllowlist}).`,
      );
    }
  }

  const hasIssues =
    brokenLinks.length > 0 ||
    mdxWarnings.length > 0 ||
    trailingSlashWarnings.length > 0 ||
    anchorWarnings.length > 0;

  // Per-category strict failure (real counts). Combined into one exit
  // code so b4push only needs one invocation. Print which category
  // tripped before exiting so the diagnosis is obvious from the log.
  let failed = false;
  if (strictBroken && realBroken.length > 0) {
    console.log(`\n❌ STRICT FAIL: ${realBroken.length} broken link${realBroken.length === 1 ? "" : "s"} (after allowlist).`);
    failed = true;
  }
  if (strictAbsolute && realAbsolute.length > 0) {
    console.log(`\n❌ STRICT FAIL: ${realAbsolute.length} absolute MDX-source link${realAbsolute.length === 1 ? "" : "s"} (after allowlist).`);
    failed = true;
  }
  if (strictTrailing && realTrailing.length > 0) {
    console.log(`\n❌ STRICT FAIL: ${realTrailing.length} trailing-slash warning${realTrailing.length === 1 ? "" : "s"} (after allowlist).`);
    failed = true;
  }
  if (strictAnchors && realAnchors.length > 0) {
    console.log(`\n❌ STRICT FAIL: ${realAnchors.length} broken anchor${realAnchors.length === 1 ? "" : "s"} (after allowlist).`);
    failed = true;
  }
  if (failed) {
    process.exit(1);
  }

  if (hasIssues && !strictBroken && !strictAbsolute && !strictTrailing && !strictAnchors) {
    console.log("\nNote: Issues found but running in non-strict mode (exit 0).");
    console.log(
      "Use --strict-broken / --strict-absolute / --strict-trailing / --strict-anchors (or --strict for all) to fail on issues.",
    );
  }
}

const isMain =
  process.argv[1] && resolve(process.argv[1]) === resolve(__filename);

if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
