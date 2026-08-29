import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  checkHtmlLinksAndTrailing,
  checkMdxAnchors,
  extractHtmlLinks,
} from "./check-links.js";

async function withFiles(files, callback) {
  const root = await mkdtemp(path.join(os.tmpdir(), "check-links-"));
  for (const [name, value] of Object.entries(files)) {
    const target = path.join(root, name);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, value);
  }
  try {
    return await callback(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const hrefs = (links) => links.map((link) => link.href);

test("extractHtmlLinks reads quoted attribute values", () => {
  const html = "<a href='/docs/foo'>a</a><a href=\"/docs/bar\">b</a>";
  assert.deepEqual(hrefs(extractHtmlLinks(html)), ["/docs/foo", "/docs/bar"]);
});

test("extractHtmlLinks skips external and non-navigable schemes", () => {
  const html = [
    '<a href="https://example.com">x</a>',
    '<a href="mailto:a@b.c">x</a>',
    '<a href="tel:+123">x</a>',
    '<a href="/docs/keep">x</a>',
  ].join("");
  assert.deepEqual(hrefs(extractHtmlLinks(html)), ["/docs/keep"]);
});

test("extractHtmlLinks includes same-page fragments", () => {
  const html = '<a href="#local">x</a><a href="/docs/foo">y</a>';
  assert.deepEqual(hrefs(extractHtmlLinks(html)), ["#local", "/docs/foo"]);
});

test("checkHtmlLinksAndTrailing reports broken paths and invalid fragments", async () => {
  await withFiles(
    {
      "docs/a/index.html": [
        '<a href="/docs/b#bindings-images">good</a>',
        '<a href="/docs/b#images">bad-anchor</a>',
        '<a href="#here">good-local</a>',
        '<a href="#nowhere">bad-local</a>',
        '<a href="/docs/gone#anything">bad-path</a>',
        '<h2 id="here">here</h2>',
      ].join(""),
      "docs/b/index.html": '<h3 id="bindings-images">Images</h3>',
    },
    async (root) => {
      const result = await checkHtmlLinksAndTrailing(root, root, "/", []);
      assert.deepEqual(hrefs(result.broken), ["/docs/gone#anything"]);
      assert.deepEqual(hrefs(result.anchors).sort(), ["#nowhere", "/docs/b#images"]);
    },
  );
});

test("checkHtmlLinksAndTrailing matches percent-encoded non-ASCII fragments", async () => {
  const ja = encodeURIComponent("バインディング-images");
  const missing = encodeURIComponent("ない");
  await withFiles(
    {
      "ja/a/index.html": `<a href="/ja/b#${ja}">good</a><a href="/ja/b#${missing}">bad</a>`,
      "ja/b/index.html": '<h3 id="バインディング-images">Images</h3>',
    },
    async (root) => {
      const result = await checkHtmlLinksAndTrailing(root, root, "/", []);
      assert.equal(result.anchors.length, 1);
      assert.ok(result.anchors[0].href.endsWith(missing));
    },
  );
});

test("checkHtmlLinksAndTrailing respects the base path", async () => {
  await withFiles(
    {
      "docs/a/index.html": '<a href="/base/docs/b#ok">good</a><a href="/base/docs/b#no">bad</a>',
      "docs/b/index.html": '<h2 id="ok">ok</h2>',
    },
    async (root) => {
      const result = await checkHtmlLinksAndTrailing(root, root, "/base/", []);
      assert.deepEqual(hrefs(result.anchors), ["/base/docs/b#no"]);
    },
  );
});

test("checkMdxAnchors validates hierarchical source headings without dist", async () => {
  await withFiles(
    {
      "source.mdx": [
        "[good](./target.mdx#parent-child)",
        "[bad](./target.mdx#child)",
      ].join("\n"),
      "target.mdx": "## Parent\n### Child\n",
    },
    async (root) => {
      const result = await checkMdxAnchors([root], root, "/", [], []);
      assert.deepEqual(hrefs(result), ["./target.mdx#child"]);
      assert.equal(result[0].reason, "missing target id");
    },
  );
});

test("checkMdxAnchors accepts static id targets", async () => {
  await withFiles(
    {
      "source.mdx": "[static](./target.mdx#custom-target)\n",
      "target.mdx": '<div id="custom-target">Target</div>\n',
    },
    async (root) => {
      assert.deepEqual(await checkMdxAnchors([root], root, "/", [], []), []);
    },
  );
});
