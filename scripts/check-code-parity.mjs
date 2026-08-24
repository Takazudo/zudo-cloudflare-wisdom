#!/usr/bin/env node

import { pathToFileURL } from "node:url";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { parseToAst } from "@takazudo/zfb-md-wasm";
import { createTwoFilesPatch } from "diff";

const MARKDOWN_EXTENSION = /\.(?:md|mdx)$/;

function normalizeNewlines(value) {
  return value.replace(/\r\n?|\n/g, "\n");
}

function toPosix(relativePath) {
  return relativePath.split(path.sep).join("/");
}

async function enumerateMarkdownFiles(root) {
  const files = [];

  async function visit(directory, prefix) {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await visit(path.join(directory, entry.name), relativePath);
      } else if (entry.isFile() && MARKDOWN_EXTENSION.test(entry.name)) {
        files.push(relativePath);
      }
    }
  }

  await visit(root, "");
  return files.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

function isFencedCodeNode(node, source) {
  if (node?.type !== "code") return false;
  const offset = node.position?.start?.offset;
  if (!Number.isInteger(offset)) return false;
  const delimiter = source[offset];
  if (delimiter !== "`" && delimiter !== "~") return false;
  let width = 0;
  while (source[offset + width] === delimiter) width += 1;
  return width >= 3;
}

function extractFencedBlocks(ast, source) {
  const blocks = [];

  function visit(node) {
    if (!node || typeof node !== "object") return;
    if (isFencedCodeNode(node, source)) {
      blocks.push({
        lang: node.lang ?? "",
        meta: node.meta ?? "",
        value: normalizeNewlines(node.value ?? ""),
        line: node.position?.start?.line ?? null,
      });
    }
    if (Array.isArray(node.children)) {
      for (const child of node.children) visit(child);
    }
  }

  visit(ast);
  return blocks;
}

function tupleEqual(a, b) {
  return a.lang === b.lang && a.meta === b.meta && a.value === b.value;
}

function firstAlignedMismatch(enBlocks, jaBlocks) {
  const rows = enBlocks.length + 1;
  const columns = jaBlocks.length + 1;
  const costs = Array.from({ length: rows }, () => new Uint32Array(columns));

  for (let en = enBlocks.length; en >= 0; en -= 1) costs[en][jaBlocks.length] = enBlocks.length - en;
  for (let ja = jaBlocks.length; ja >= 0; ja -= 1) costs[enBlocks.length][ja] = jaBlocks.length - ja;

  for (let en = enBlocks.length - 1; en >= 0; en -= 1) {
    for (let ja = jaBlocks.length - 1; ja >= 0; ja -= 1) {
      if (tupleEqual(enBlocks[en], jaBlocks[ja])) {
        costs[en][ja] = costs[en + 1][ja + 1];
      } else {
        costs[en][ja] = 1 + Math.min(costs[en + 1][ja + 1], costs[en + 1][ja], costs[en][ja + 1]);
      }
    }
  }

  let en = 0;
  let ja = 0;
  while (en < enBlocks.length || ja < jaBlocks.length) {
    if (
      en < enBlocks.length &&
      ja < jaBlocks.length &&
      tupleEqual(enBlocks[en], jaBlocks[ja]) &&
      costs[en][ja] === costs[en + 1][ja + 1]
    ) {
      en += 1;
      ja += 1;
      continue;
    }

    const ordinal = Math.min(en, ja) + 1;
    const substitution = en < enBlocks.length && ja < jaBlocks.length ? costs[en + 1][ja + 1] : Infinity;
    const deletion = en < enBlocks.length ? costs[en + 1][ja] : Infinity;
    const insertion = ja < jaBlocks.length ? costs[en][ja + 1] : Infinity;
    const best = Math.min(substitution, deletion, insertion);

    // Prefer a gap when it immediately restores equality. This makes a
    // middle insertion/deletion point at the inserted block instead of
    // presenting subsequent blocks as shifted substitutions.
    if (
      enBlocks.length !== jaBlocks.length &&
      deletion === best &&
      en + 1 < enBlocks.length &&
      ja < jaBlocks.length &&
      tupleEqual(enBlocks[en + 1], jaBlocks[ja])
    ) {
      return { ordinal, enIndex: en, jaIndex: null, enBlock: enBlocks[en], jaBlock: null };
    }
    if (
      enBlocks.length !== jaBlocks.length &&
      insertion === best &&
      en < enBlocks.length &&
      ja + 1 < jaBlocks.length &&
      tupleEqual(enBlocks[en], jaBlocks[ja + 1])
    ) {
      return { ordinal, enIndex: null, jaIndex: ja, enBlock: null, jaBlock: jaBlocks[ja] };
    }
    if (substitution === best) {
      return { ordinal, enIndex: en, jaIndex: ja, enBlock: enBlocks[en], jaBlock: jaBlocks[ja] };
    }
    if (deletion === best) {
      return { ordinal, enIndex: en, jaIndex: null, enBlock: enBlocks[en], jaBlock: null };
    }
    return { ordinal, enIndex: null, jaIndex: ja, enBlock: null, jaBlock: jaBlocks[ja] };
  }

  return null;
}

function renderTuple(block) {
  if (!block) return "<missing block>\n";
  return `Language: ${block.lang}\nMetadata: ${block.meta}\nContent:\n${block.value}\n`;
}

function renderMismatch(enPath, jaPath, enBlocks, jaBlocks) {
  const mismatch = firstAlignedMismatch(enBlocks, jaBlocks);
  const enLine = mismatch.enBlock?.line ?? null;
  const jaLine = mismatch.jaBlock?.line ?? null;
  const enOrdinal = mismatch.enIndex === null ? "missing" : String(mismatch.enIndex + 1);
  const jaOrdinal = mismatch.jaIndex === null ? "missing" : String(mismatch.jaIndex + 1);
  const lines = [
    `MISMATCH: ${enPath} <> ${jaPath}`,
    `  Block counts: EN ${enBlocks.length}, JA ${jaBlocks.length}`,
    `  First differing block: ${mismatch.ordinal}`,
    `  EN block: ${enOrdinal}; source line: ${enLine ?? "missing"}`,
    `  JA block: ${jaOrdinal}; source line: ${jaLine ?? "missing"}`,
  ];
  const enLabel = `EN ${enPath} block ${enOrdinal}${enLine === null ? "" : ` line ${enLine}`}`;
  const jaLabel = `JA ${jaPath} block ${jaOrdinal}${jaLine === null ? "" : ` line ${jaLine}`}`;
  const patch = createTwoFilesPatch(
    enLabel,
    jaLabel,
    renderTuple(mismatch.enBlock),
    renderTuple(mismatch.jaBlock),
    "",
    "",
    { context: 3 },
  ).trimEnd();
  lines.push("  Unified diff:", ...patch.split("\n").map((line) => `    ${line}`));
  return lines.join("\n");
}

function renderDiagnostic(relativePath, locale, diagnostic) {
  const location = diagnostic.line == null
    ? "line unknown, column unknown"
    : `line ${diagnostic.line}, column ${diagnostic.column ?? "unknown"}`;
  return `PARSER ERROR: ${locale} ${relativePath}: [${diagnostic.source}] ${diagnostic.message} (${location})`;
}

async function parsePage(root, relativePath, locale) {
  const source = await readFile(path.join(root, relativePath), "utf8");
  const dialect = relativePath.endsWith(".md") ? "markdown" : "mdx";
  const result = await parseToAst(source, {
    filename: relativePath,
    dialect,
    directives: true,
    frontmatter: "extract",
  });
  const errors = result.diagnostics.filter((diagnostic) => diagnostic.severity === "error");
  const failed = result.ast === null || errors.length > 0;
  return {
    failed,
    generated: result.frontmatter?.generated === true,
    blocks: failed ? [] : extractFencedBlocks(result.ast, source),
    diagnostics: errors.map((diagnostic) => renderDiagnostic(relativePath, locale, diagnostic)),
  };
}

export async function checkCodeParity({ enRoot, jaRoot } = {}) {
  const resolvedEnRoot = path.resolve(enRoot ?? "src/content/docs");
  const resolvedJaRoot = path.resolve(jaRoot ?? "src/content/docs-ja");
  const output = [];
  let failed = false;
  let enFiles = [];
  let jaFiles = [];

  try {
    enFiles = await enumerateMarkdownFiles(resolvedEnRoot);
  } catch (error) {
    failed = true;
    output.push(`SCAN ERROR: English root unavailable: ${toPosix(resolvedEnRoot)} (${error.code ?? error.message})`);
  }
  try {
    jaFiles = await enumerateMarkdownFiles(resolvedJaRoot);
  } catch (error) {
    failed = true;
    output.push(`SCAN ERROR: Japanese root unavailable: ${toPosix(resolvedJaRoot)} (${error.code ?? error.message})`);
  }

  const jaSet = new Set(jaFiles);
  const enSet = new Set(enFiles);
  const generatedSkips = [];
  const missingMirrors = [];
  const jaOnlyPages = jaFiles.filter((relativePath) => !enSet.has(relativePath));
  const mismatches = [];
  let inspectedPairs = 0;
  let enBlockTotal = 0;
  let jaBlockTotal = 0;

  for (const relativePath of enFiles) {
    let enPage;
    try {
      enPage = await parsePage(resolvedEnRoot, relativePath, "EN");
    } catch (error) {
      failed = true;
      output.push(`READ ERROR: EN ${relativePath}: ${error.message}`);
      continue;
    }
    if (enPage.failed) {
      failed = true;
      if (enPage.diagnostics.length > 0) output.push(...enPage.diagnostics);
      else output.push(`PARSER ERROR: EN ${relativePath}: ast is null without an error diagnostic`);
      continue;
    }
    if (enPage.generated) {
      generatedSkips.push(relativePath);
      continue;
    }
    if (!jaSet.has(relativePath)) {
      missingMirrors.push(relativePath);
      continue;
    }

    let jaPage;
    try {
      jaPage = await parsePage(resolvedJaRoot, relativePath, "JA");
    } catch (error) {
      failed = true;
      output.push(`READ ERROR: JA ${relativePath}: ${error.message}`);
      continue;
    }
    inspectedPairs += 1;
    enBlockTotal += enPage.blocks.length;
    jaBlockTotal += jaPage.blocks.length;
    if (jaPage.failed) {
      failed = true;
      if (jaPage.diagnostics.length > 0) output.push(...jaPage.diagnostics);
      else output.push(`PARSER ERROR: JA ${relativePath}: ast is null without an error diagnostic`);
      continue;
    }
    if (
      enPage.blocks.length !== jaPage.blocks.length ||
      enPage.blocks.some((block, index) => !tupleEqual(block, jaPage.blocks[index]))
    ) {
      failed = true;
      mismatches.push(renderMismatch(relativePath, relativePath, enPage.blocks, jaPage.blocks));
    }
  }

  if (inspectedPairs === 0) {
    failed = true;
    output.push("SCAN ERROR: zero mirror pairs inspected");
  }
  output.push(...mismatches);
  output.push(`Generated EN skips (${generatedSkips.length}): ${generatedSkips.join(", ") || "none"}`);
  output.push(`Missing JA mirrors (${missingMirrors.length}): ${missingMirrors.join(", ") || "none"}`);
  output.push(`JA-only pages (${jaOnlyPages.length}): ${jaOnlyPages.join(", ") || "none"}`);
  output.push(
    `Summary: inspected ${inspectedPairs} mirror pairs; ${enBlockTotal} EN fenced blocks; ${jaBlockTotal} JA fenced blocks; ${mismatches.length} mismatched pages`,
  );
  output.push(`Code parity: ${failed ? "FAIL" : "PASS"}`);

  return { exitCode: failed ? 1 : 0, output: `${output.join("\n")}\n` };
}

function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--en-root" || argument === "--ja-root") {
      const value = argv[index + 1];
      if (!value) throw new Error(`${argument} requires a path`);
      options[argument === "--en-root" ? "enRoot" : "jaRoot"] = value;
      index += 1;
    } else {
      throw new Error(`unknown argument: ${argument}`);
    }
  }
  return options;
}

async function main() {
  try {
    const result = await checkCodeParity(parseArguments(process.argv.slice(2)));
    process.stdout.write(result.output);
    process.exitCode = result.exitCode;
  } catch (error) {
    process.stderr.write(`Code parity checker error: ${error.message}\n`);
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}

export const testing = { extractFencedBlocks, firstAlignedMismatch, normalizeNewlines };
