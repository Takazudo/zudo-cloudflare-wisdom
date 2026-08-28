import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  checkHtmlAnchors,
  checkHtmlLinks,
  extractHtmlIds,
  extractHtmlLinks,
} from "./check-links.js";

async function withDist(files, callback) {
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

const hrefs = (links) => links.map((l) => l.href);

// The production build minifies and drops attribute quotes. A quoted-only
// regex matched zero links across the whole site, which made the HTML link
// checker report "no broken links" while checking nothing at all.
test("extractHtmlLinks reads unquoted attribute values", () => {
  const html = "<a href=/docs/foo>a</a><a href='/docs/bar'>b</a><a href=\"/docs/baz\">c</a>";
  assert.deepEqual(hrefs(extractHtmlLinks(html)), ["/docs/foo", "/docs/bar", "/docs/baz"]);
});

test("extractHtmlLinks skips external and non-navigable schemes", () => {
  const html = [
    "<a href=https://example.com>x</a>",
    "<a href=//cdn.example.com/x>x</a>",
    "<a href=mailto:a@b.c>x</a>",
    "<a href=tel:+123>x</a>",
    "<a href=/docs/keep>x</a>",
  ].join("");
  assert.deepEqual(hrefs(extractHtmlLinks(html)), ["/docs/keep"]);
});

test("extractHtmlLinks includes same-page fragments only when asked", () => {
  const html = "<a href=#local>x</a><a href=/docs/foo>y</a>";
  assert.deepEqual(hrefs(extractHtmlLinks(html)), ["/docs/foo"]);
  assert.deepEqual(hrefs(extractHtmlLinks(html, { includeFragmentOnly: true })), [
    "#local",
    "/docs/foo",
  ]);
});

test("extractHtmlIds reads quoted, unquoted and legacy name anchors", () => {
  const html = '<h2 id=one>a</h2><h2 id="two">b</h2><a name=three></a>';
  const ids = extractHtmlIds(html);
  assert.ok(ids.has("one"));
  assert.ok(ids.has("two"));
  assert.ok(ids.has("three"));
});

test("checkHtmlLinks finds a broken path in minified output", async () => {
  await withDist(
    {
      "docs/a/index.html": "<a href=/docs/b>ok</a><a href=/docs/gone>bad</a>",
      "docs/b/index.html": "<p>b</p>",
    },
    async (root) => {
      const broken = await checkHtmlLinks(root, root, "/", []);
      assert.deepEqual(hrefs(broken), ["/docs/gone"]);
    },
  );
});

// zfb scopes sub-heading ids under their parent h2, so `### Images` under
// `## Bindings` becomes `bindings-images`. A hand-written `#images` looks
// plausible, the build only warns, and the link ships broken.
test("checkHtmlAnchors finds cross-page and same-page broken fragments", async () => {
  await withDist(
    {
      "docs/a/index.html": [
        "<a href=/docs/b#bindings-images>good</a>",
        "<a href=/docs/b#images>bad</a>",
        "<a href=#here>good-local</a>",
        "<a href=#nowhere>bad-local</a>",
        "<h2 id=here>here</h2>",
      ].join(""),
      "docs/b/index.html": "<h3 id=bindings-images>Images</h3>",
    },
    async (root) => {
      const broken = await checkHtmlAnchors(root, root, "/", []);
      assert.deepEqual(hrefs(broken).sort(), ["#nowhere", "/docs/b#images"]);
    },
  );
});

test("checkHtmlAnchors matches percent-encoded non-ASCII fragments", async () => {
  const ja = encodeURIComponent("バインディング-images");
  await withDist(
    {
      "ja/a/index.html": `<a href=/ja/b#${ja}>good</a><a href=/ja/b#${encodeURIComponent("ない")}>bad</a>`,
      "ja/b/index.html": "<h3 id=バインディング-images>Images</h3>",
    },
    async (root) => {
      const broken = await checkHtmlAnchors(root, root, "/", []);
      assert.equal(broken.length, 1);
      assert.ok(broken[0].href.endsWith(encodeURIComponent("ない")));
    },
  );
});

// Path breakage is checkHtmlLinks' job; reporting it here too would double-count.
test("checkHtmlAnchors stays quiet when the path itself is broken", async () => {
  await withDist(
    { "docs/a/index.html": "<a href=/docs/gone#anything>x</a>" },
    async (root) => {
      assert.deepEqual(await checkHtmlAnchors(root, root, "/", []), []);
    },
  );
});

test("checkHtmlAnchors ignores bare # and #top", async () => {
  await withDist(
    { "docs/a/index.html": "<a href=#>x</a><a href=#top>y</a>" },
    async (root) => {
      assert.deepEqual(await checkHtmlAnchors(root, root, "/", []), []);
    },
  );
});

test("checkHtmlAnchors respects the base path", async () => {
  await withDist(
    {
      "docs/a/index.html": "<a href=/base/docs/b#ok>good</a><a href=/base/docs/b#no>bad</a>",
      "docs/b/index.html": "<h2 id=ok>ok</h2>",
    },
    async (root) => {
      const broken = await checkHtmlAnchors(root, root, "/base/", []);
      assert.deepEqual(hrefs(broken), ["/base/docs/b#no"]);
    },
  );
});
