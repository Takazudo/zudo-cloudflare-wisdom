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
 * The one mechanism PROVEN to work here is `@source inline(...)`. This script
 * extracts every class token from the installed package dist and writes them as
 * `@source inline("…")` lines into the generated partial src/styles/
 * _package-safelist.css, which global.css imports. It is dep-bump-safe (derives
 * from the installed dist, not a frozen hand list). It runs as the first step of
 * `pnpm dev` / `pnpm build` (and `pnpm gen:safelist`), and should be re-run on
 * each @takazudo/zudo-doc bump. Output is byte-deterministic (locale-independent
 * sort), so a pinned dep produces identical bytes and never dirties git.
 *
 * Over-capture is safe: an `@source inline()` candidate that is not a real
 * utility produces no CSS. The token filter rejects obvious non-classes (CSS
 * property names, attribute strings) but a few harmless non-utility tokens may
 * remain in the generated partial — they emit nothing.
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
  s.split(open).length === s.split(close).length;

// A token is class-LEGAL when it starts lowercase / negative / arbitrary-variant
// and uses only class characters, with balanced brackets/parens. Rejects, with
// certainty, the non-class strings that share punctuation with classes:
//   - a class never ENDS in `:` (a variant must be followed by a utility) → cuts
//     CSS property names and object keys (`color:`, `border-collapse:`, `class:`)
//   - `=` only ever appears inside an arbitrary `[...]` value → a bare `=` cuts
//     things like `charset=utf-8`
//   - uppercase/`//` starts cut `Content-Type` and URLs; balance cuts `-50%)`
const CLASS_LEGAL = /^-?[a-z[][-a-z0-9:/_.,%#&()[\]+*~<>=!?]*$/;
function isClassToken(tok) {
  if (!CLASS_LEGAL.test(tok)) return false;
  if (tok.endsWith(":")) return false;
  if (tok.includes("//")) return false;
  if (tok.replace(/\[[^\]]*\]/g, "").includes("=")) return false;
  return balanced(tok, "[", "]") && balanced(tok, "(", ")");
}
// COMPOUND tokens additionally carry a `-`, `:`, or `[` marker. Used for the
// broad string scan (cx() args, any string literal) so a bare English word in
// prose is not mistaken for a class; bare-word utilities are recovered from
// explicit class:/className: literals instead.
function isCompoundClassToken(tok) {
  return /[-:[]/.test(tok) && isClassToken(tok);
}

// Drop `${…}` interpolations from a template-literal body so the static class
// tokens around them are still scanned (e.g. `border-l-[3px] …${cond?…}`). The
// closing `}` is optional: when a nested backtick truncates the captured segment
// the interpolation is unterminated, and a glued token like `italic${cond?…`
// must still yield `italic`.
const stripInterp = (s) => s.replace(/\$\{[^}]*\}?/g, " ");

const tokens = new Set();
const files = collectFiles(DIST);

// Explicit class context — keep EVERY token (bare words too). Both quote forms.
const CLASS_DQ = /\b(?:class|className)\s*:\s*"([^"]*)"/g;
const CLASS_BT = /\b(?:class|className)\s*:\s*`([^`\\]*)`/g;
// Any string literal — keep only compound tokens (catches cx() fragments etc.).
const ANY_DQ = /"([^"\\]*)"/g;
const ANY_BT = /`([^`\\]*)`/g;

function addTokens(str, predicate) {
  for (const tok of str.split(/\s+/)) {
    if (tok && predicate(tok)) tokens.add(tok);
  }
}

for (const file of files) {
  const src = readFileSync(file, "utf8");
  let m;

  CLASS_DQ.lastIndex = 0;
  while ((m = CLASS_DQ.exec(src)) !== null) addTokens(m[1], isClassToken);

  CLASS_BT.lastIndex = 0;
  while ((m = CLASS_BT.exec(src)) !== null)
    addTokens(stripInterp(m[1]), isClassToken);

  ANY_DQ.lastIndex = 0;
  while ((m = ANY_DQ.exec(src)) !== null) addTokens(m[1], isCompoundClassToken);

  ANY_BT.lastIndex = 0;
  while ((m = ANY_BT.exec(src)) !== null)
    addTokens(stripInterp(m[1]), isCompoundClassToken);
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
  " * Regenerated on every build (dev/build scripts) and on each dep bump;",
  " * output is deterministic so a pinned dep produces identical bytes.",
  ` * ${sorted.length} class tokens. */`,
  ...sorted.map((tok) => `@source inline("${tok}");`),
  "",
].join("\n");

writeFileSync(OUT, lines, "utf8");
console.log(
  `[gen-package-safelist] ${sorted.length} tokens -> ${relative(ROOT, OUT)}`,
);
