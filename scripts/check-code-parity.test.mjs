import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { checkCodeParity, testing } from "./check-code-parity.mjs";

async function withCorpus(files, callback) {
  const root = await mkdtemp(path.join(os.tmpdir(), "code-parity-"));
  const enRoot = path.join(root, "docs");
  const jaRoot = path.join(root, "docs-ja");
  await mkdir(enRoot, { recursive: true });
  await mkdir(jaRoot, { recursive: true });
  for (const [name, value] of Object.entries(files.en ?? {})) {
    const target = path.join(enRoot, name);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, value);
  }
  for (const [name, value] of Object.entries(files.ja ?? {})) {
    const target = path.join(jaRoot, name);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, value);
  }
  try {
    return await callback({ root, enRoot, jaRoot });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("translated prose with identical fences passes and reports deterministic totals", async () => {
  await withCorpus(
    {
      en: { "guide/page.mdx": "# Hello\n\nEnglish.\n\n```js title=demo\nconst x = 1;\n```\n" },
      ja: { "guide/page.mdx": "# こんにちは\n\n日本語。\n\n```js title=demo\nconst x = 1;\n```\n" },
    },
    async ({ enRoot, jaRoot }) => {
      const first = await checkCodeParity({ enRoot, jaRoot });
      const second = await checkCodeParity({ enRoot, jaRoot });
      assert.equal(first.exitCode, 0);
      assert.equal(first.output, second.output);
      assert.match(first.output, /Generated EN skips \(0\): none/);
      assert.match(first.output, /Missing JA mirrors \(0\): none/);
      assert.match(first.output, /JA-only pages \(0\): none/);
      assert.match(first.output, /Summary: inspected 1 mirror pairs; 1 EN fenced blocks; 1 JA fenced blocks; 0 mismatched pages/);
      assert.match(first.output, /Code parity: PASS/);
    },
  );
});

test("body, comments, whitespace, language case, and metadata spacing differ exactly", async () => {
  const fence = (info, value) => `\`\`\`${info}\n${value}\n\`\`\`\n`;
  await withCorpus(
    {
      en: {
        "body.md": fence("js", "const x = 1;"),
        "comment.md": fence("js", "// keep\nconst x = 1;"),
        "internal.md": fence("text", "a  b"),
        "trailing.md": fence("text", "line  "),
        "language.md": fence("JS", "x"),
        "metadata.md": fence("js title=one  flag", "x"),
      },
      ja: {
        "body.md": fence("js", "const x = 2;"),
        "comment.md": fence("js", "// translated\nconst x = 1;"),
        "internal.md": fence("text", "a b"),
        "trailing.md": fence("text", "line "),
        "language.md": fence("js", "x"),
        "metadata.md": fence("js title=one flag", "x"),
      },
    },
    async ({ enRoot, jaRoot }) => {
      const result = await checkCodeParity({ enRoot, jaRoot });
      assert.equal(result.exitCode, 1);
      for (const name of ["body.md", "comment.md", "internal.md", "trailing.md", "language.md", "metadata.md"]) {
        assert.match(result.output, new RegExp(`MISMATCH: ${name} <> ${name}`));
      }
      assert.match(result.output, /Language: JS/);
      assert.match(result.output, /Metadata: title=one  flag/);
      assert.match(result.output, /6 mismatched pages/);
    },
  );
});

test("alignment reports one accurate middle insertion, deletion, or reorder mismatch per page", async () => {
  const blocks = (...values) => values.map((value) => `\`\`\`text\n${value}\n\`\`\``).join("\n\n") + "\n";
  await withCorpus(
    {
      en: {
        "insertion.md": blocks("a", "b", "c"),
        "deletion.md": blocks("a", "extra", "b", "c"),
        "reorder.md": blocks("a", "b", "c"),
      },
      ja: {
        "insertion.md": blocks("a", "extra", "b", "c"),
        "deletion.md": blocks("a", "b", "c"),
        "reorder.md": blocks("a", "c", "b"),
      },
    },
    async ({ enRoot, jaRoot }) => {
      const result = await checkCodeParity({ enRoot, jaRoot });
      assert.equal(result.exitCode, 1);
      assert.equal((result.output.match(/^MISMATCH:/gm) ?? []).length, 3);
      assert.match(result.output, /MISMATCH: insertion\.md[\s\S]*?First differing block: 2[\s\S]*?EN block: missing; source line: missing[\s\S]*?JA block: 2; source line: 5/);
      assert.match(result.output, /MISMATCH: deletion\.md[\s\S]*?First differing block: 2[\s\S]*?EN block: 2; source line: 5[\s\S]*?JA block: missing; source line: missing/);
      assert.match(result.output, /MISMATCH: reorder\.md[\s\S]*?First differing block: 2[\s\S]*?EN block: 2; source line: 5[\s\S]*?JA block: 2; source line: 5/);
    },
  );
});

test("fence syntax variants compare while ordinary indented code is ignored", async () => {
  const en = [
    "```",
    "empty info",
    "```",
    "",
    "~~~JS title=x  flag",
    "const tick = `x`;",
    "~~~",
    "",
    "````md meta",
    "```js",
    "literal inner fence",
    "```",
    "````",
    "",
    "  ```text",
    "  list/container fence",
    "  ```",
    "",
    "    EN indented only",
    "",
  ].join("\n");
  const ja = en.replace("EN indented only", "JA indented only");
  await withCorpus({ en: { "variants.md": en }, ja: { "variants.md": ja } }, async ({ enRoot, jaRoot }) => {
    const result = await checkCodeParity({ enRoot, jaRoot });
    assert.equal(result.exitCode, 0, result.output);
    assert.match(result.output, /4 EN fenced blocks; 4 JA fenced blocks/);
  });
});

test("CRLF and CR inside code normalize to LF", async () => {
  await withCorpus(
    {
      en: { "newlines.md": "```text\r\na\r\nb\r\n```\r\n" },
      ja: { "newlines.md": "```text\ra\rb\r```\r" },
    },
    async ({ enRoot, jaRoot }) => {
      const result = await checkCodeParity({ enRoot, jaRoot });
      assert.equal(result.exitCode, 0, result.output);
    },
  );
  assert.equal(testing.normalizeNewlines("a\r\nb\rc\n"), "a\nb\nc\n");
});

test("zero-code mirrors pass but an overall zero-pair scan fails", async () => {
  await withCorpus({ en: { "prose.mdx": "English\n" }, ja: { "prose.mdx": "日本語\n" } }, async ({ enRoot, jaRoot }) => {
    const result = await checkCodeParity({ enRoot, jaRoot });
    assert.equal(result.exitCode, 0);
    assert.match(result.output, /inspected 1 mirror pairs; 0 EN fenced blocks; 0 JA fenced blocks/);
  });
  await withCorpus({}, async ({ enRoot, jaRoot }) => {
    const result = await checkCodeParity({ enRoot, jaRoot });
    assert.equal(result.exitCode, 1);
    assert.match(result.output, /SCAN ERROR: zero mirror pairs inspected/);
    assert.match(result.output, /Summary: inspected 0 mirror pairs/);
  });
});

test("generated EN, missing mirrors, and JA-only pages are visible non-failing skips", async () => {
  await withCorpus(
    {
      en: {
        "generated.mdx": "---\ngenerated: true\n---\n\n```js\nEN only\n```\n",
        "generated-pair.mdx": "---\ngenerated: true\n---\n\n```js\nx\n```\n",
        "missing.mdx": "# No mirror\n",
        "pair.mdx": "```js\nx\n```\n",
      },
      ja: {
        "generated-pair.mdx": "---\ngenerated: true\n---\n\n```js\nx\n```\n",
        "pair.mdx": "```js\nx\n```\n",
        "ja-only.mdx": "# JA only\n",
      },
    },
    async ({ enRoot, jaRoot }) => {
      const result = await checkCodeParity({ enRoot, jaRoot });
      assert.equal(result.exitCode, 0, result.output);
      assert.match(result.output, /Generated EN skips \(2\): generated-pair\.mdx, generated\.mdx/);
      assert.match(result.output, /Missing JA mirrors \(1\): missing\.mdx/);
      assert.match(result.output, /JA-only pages \(1\): ja-only\.mdx/);
      assert.match(result.output, /inspected 1 mirror pairs/);
    },
  );
});

test("missing roots and malformed MDX are hard failures with structured locations", async () => {
  await withCorpus({ en: { "pair.mdx": "ok\n" }, ja: { "pair.mdx": "ok\n" } }, async ({ root, enRoot, jaRoot }) => {
    const missingEn = await checkCodeParity({ enRoot: path.join(root, "absent"), jaRoot });
    assert.equal(missingEn.exitCode, 1);
    assert.match(missingEn.output, /SCAN ERROR: English root unavailable:/);
    assert.match(missingEn.output, /SCAN ERROR: zero mirror pairs inspected/);

    const missingJa = await checkCodeParity({ enRoot, jaRoot: path.join(root, "absent-ja") });
    assert.equal(missingJa.exitCode, 1);
    assert.match(missingJa.output, /SCAN ERROR: Japanese root unavailable:/);
  });

  await withCorpus(
    { en: { "bad.mdx": "# Heading\n\n<Component>\n" }, ja: { "bad.mdx": "# 見出し\n" } },
    async ({ enRoot, jaRoot }) => {
      const result = await checkCodeParity({ enRoot, jaRoot });
      assert.equal(result.exitCode, 1);
      assert.match(result.output, /PARSER ERROR: EN bad\.mdx: \[markdown\] .+ \(line \d+, column \d+\)/);
      assert.match(result.output, /SCAN ERROR: zero mirror pairs inspected/);
      assert.doesNotMatch(result.output, /Code parity: PASS/);
    },
  );

  await withCorpus(
    { en: { "bad.mdx": "# Heading\n" }, ja: { "bad.mdx": "# 見出し\n\n<Component>\n" } },
    async ({ enRoot, jaRoot }) => {
      const result = await checkCodeParity({ enRoot, jaRoot });
      assert.equal(result.exitCode, 1);
      assert.match(result.output, /PARSER ERROR: JA bad\.mdx: \[markdown\] .+ \(line \d+, column \d+\)/);
      assert.match(result.output, /SCAN ERROR: zero mirror pairs inspected/);
      assert.match(result.output, /Summary: inspected 0 mirror pairs; 0 EN fenced blocks; 0 JA fenced blocks/);
      assert.doesNotMatch(result.output, /Summary: inspected 1 mirror pairs/);
    },
  );
});

test("unified diagnostics label paths, counts, ordinal, tuple fields, and source lines", async () => {
  await withCorpus(
    {
      en: { "nested/page.mdx": "Intro\n\n```JS title=x\nconst x = 1;\n```\n" },
      ja: { "nested/page.mdx": "前書き\n\n```js title=x\nconst x = 2;\n```\n" },
    },
    async ({ enRoot, jaRoot }) => {
      const result = await checkCodeParity({ enRoot, jaRoot });
      assert.equal(result.exitCode, 1);
      assert.match(result.output, /MISMATCH: nested\/page\.mdx <> nested\/page\.mdx/);
      assert.match(result.output, /Block counts: EN 1, JA 1/);
      assert.match(result.output, /First differing block: 1/);
      assert.match(result.output, /EN block: 1; source line: 3/);
      assert.match(result.output, /JA block: 1; source line: 3/);
      assert.match(result.output, /Unified diff:/);
      assert.match(result.output, /--- EN nested\/page\.mdx block 1 line 3/);
      assert.match(result.output, /\+\+\+ JA nested\/page\.mdx block 1 line 3/);
      assert.match(result.output, /-Language: JS/);
      assert.match(result.output, /\+Language: js/);
    },
  );
});
