#!/usr/bin/env node
/**
 * gen-package-safelist.mjs — generate a complete Tailwind safelist for the
 * @takazudo/zudo-doc package's component utility classes.
 *
 * WHY THIS EXISTS (external context — not recoverable from the code alone):
 * @takazudo/zudo-doc ships NO precompiled CSS (`files: ["dist","README.md"]`).
 * Its components are static Tailwind class literals in the dist JS, e.g.
 * `jsx("header", { class: "sticky top-0 z-50 ... border-muted bg-surface" })`.
 * A consumer is expected to generate those utilities itself. But Tailwind v4's
 * content scanner does NOT reliably pick up classes from node_modules — the
 * `@source "node_modules/@takazudo/zudo-doc/dist/**"` directive in global.css
 * generates ZERO package utilities here (empirically confirmed: package-only
 * tokens like `top-0`/`z-50` never reach the built CSS, so the sticky header
 * silently breaks). See Takazudo/zudo-front-builder#884/#885 and the upstream
 * Tailwind-v4-node_modules issue zudolab/zudo-doc#1971.
 *
 * The one mechanism PROVEN to work in this build is `@source inline(...)`.
 * This script reads the installed package dist, extracts every class token,
 * and writes them as `@source inline("…")` lines into a generated partial
 * that global.css imports. It is dep-bump-safe: it derives from the installed
 * dist, not a frozen hand list. Re-run on every build (prebuild/predev hooks)
 * and whenever @takazudo/zudo-doc is bumped. Output is byte-deterministic
 * (locale-independent sort) so re-running on a pinned dep never dirties git.
 */

import { readdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = join(SCRIPT_DIR, "..");
const DIST = join(ROOT, "node_modules", "@takazudo", "zudo-doc", "dist");
const OUT = join(ROOT, "src", "styles", "_package-safelist.css");

/** Recursively collect all .js/.mjs files under a directory. */
function collectFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...collectFiles(full));
    } else if (/\.(js|mjs)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

const balanced = (s, open, close) =>
  (s.split(open).length === s.split(close).length);

/**
 * Is `tok` an unambiguous COMPOUND Tailwind class — one carrying a `-`, `:`,
 * or `[` marker? These are the package-specific utilities Tailwind's
 * node_modules scan drops (`top-[3.5rem]`, `lg:block`, `border-muted`,
 * `lg:grid-cols-[repeat(auto-fit,minmax(12rem,1fr))]`, the arbitrary variant
 * `[&::-webkit-details-marker]:hidden`, …). They are extracted PER-TOKEN from
 * any string, so a class list that mixes bare words with compound ones (e.g.
 * `cx("sticky top-[3.5rem] z-10")`, or a `class: cond ? "…" : "…"` ternary)
 * still yields its compound tokens. Bare-word utilities (`flex`, `block`,
 * `sticky`, `hidden`) are recovered separately from explicit class: literals,
 * and in any case are generated already by our own pages/components scan.
 *
 * Guards reject the non-class strings that share punctuation with classes:
 * lowercase/negative/arbitrary start drops `Content-Type` and time/number
 * fragments; balanced brackets+parens drops transform fragments like `-50%)`;
 * the `//` reject drops URLs (`https://…`).
 */
function isCompoundClassToken(tok) {
  if (!/^(-?[a-z]|\[)/.test(tok)) return false;
  if (!/^[-a-z0-9:/_.,%#&()[\]+*~<>=!?]+$/.test(tok)) return false;
  if (!/[-:[]/.test(tok)) return false;
  if (tok.includes("//")) return false;
  if (!balanced(tok, "[", "]") || !balanced(tok, "(", ")")) return false;
  return true;
}

const tokens = new Set();
const files = collectFiles(DIST);

// Per-token compound scan over every double-quoted / backtick string literal.
const ANY_STRING = /"([^"\\]*)"|`([^`\\$]*)`/g;
// Bare-word recall from explicit class: / className: literals only.
const CLASS_PROP = /\b(?:class|className)\s*:\s*"([^"]*)"/g;

for (const file of files) {
  const src = readFileSync(file, "utf8");

  let m;
  ANY_STRING.lastIndex = 0;
  while ((m = ANY_STRING.exec(src)) !== null) {
    const str = m[1] ?? m[2] ?? "";
    for (const tok of str.split(/\s+/)) {
      if (tok && isCompoundClassToken(tok)) tokens.add(tok);
    }
  }

  CLASS_PROP.lastIndex = 0;
  while ((m = CLASS_PROP.exec(src)) !== null) {
    for (const tok of m[1].split(/\s+/)) {
      if (tok) tokens.add(tok);
    }
  }
}

// Deterministic, locale-independent ordering (UTF-16 code-unit comparison).
const sorted = [...tokens].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

const distRel = relative(ROOT, DIST);
const lines = [
  "/* AUTO-GENERATED — DO NOT EDIT BY HAND.",
  ` * Source: scripts/gen-package-safelist.mjs (reads ${distRel}).`,
  " * Complete @source inline() safelist for @takazudo/zudo-doc's component",
  " * utility classes. Tailwind v4's node_modules content scan does not emit",
  " * these reliably, so we safelist every class the package dist declares.",
  " * Regenerated on every build (prebuild/predev) and on each dep bump;",
  " * output is deterministic so a pinned dep produces identical bytes.",
  ` * ${sorted.length} class tokens. */`,
  ...sorted.map((tok) => `@source inline("${tok}");`),
  "",
].join("\n");

writeFileSync(OUT, lines, "utf8");
console.log(
  `[gen-package-safelist] ${sorted.length} tokens -> ${relative(ROOT, OUT)}`,
);
