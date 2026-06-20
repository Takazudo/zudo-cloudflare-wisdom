# zudo-cloudflare-wisdom

Takazudo's Cloudflare dev notes, built with zudo-doc (zfb stack, MDX, Tailwind CSS v4).

## Commands

```bash
pnpm dev              # Start zfb dev server (port 4321)
pnpm build            # Build static site via zfb build
pnpm preview          # Preview built site
pnpm check            # zfb type checking
pnpm format:md        # Format MDX files
pnpm b4push           # Pre-push validation (format + typecheck + build)
pnpm setup:doc-skill  # Generate cloudflare-wisdom skill + symlink all skills
```

## Project Layout

```
pages/          # Host-app routing layer (zfb entry points)
src/
  components/   # Shared UI components
  config/       # settings.ts — site-wide config, docs-schema.ts — frontmatter schema
  content/      # MDX doc pages (docs/ + docs-ja/)
  utils/        # Shared utilities
plugins/        # zfb integration plugins (.mjs)
zfb.config.ts   # Build config (framework, collections, plugins, adapter)
```

## Content Structure

- English (default): `src/content/docs/` -> `/docs/...`
- Japanese: `src/content/docs-ja/` -> `/ja/docs/...`
- Japanese docs should mirror the English directory structure

**Bilingual rule**: When creating or updating any doc page, ALWAYS update both the English (`docs/`) and Japanese (`docs-ja/`) versions in the same PR. Keep code blocks identical between languages -- only translate surrounding prose. If a Japanese version does not yet exist, create it.

**Exception**: Pages with `generated: true` in frontmatter (e.g., claude-resources auto-generated pages) do not require Japanese translations.

## Content Categories

Top-level directories under `src/content/docs/`. Directories with header nav entries are mapped via `categoryMatch` in `src/config/settings.ts`:

- `getting-started/` - Overview, what this site covers, Cloudflare account setup
- `pages/` - Cloudflare Pages deployment, _redirects, base paths, preview deploys, Pages Functions
- `workers/` - Standalone Workers, wrangler config, deployment, compatibility dates
- `storage/` - KV, D1, R2 bindings and usage patterns
- `cicd/` - GitHub Actions deploy workflows, preview per PR, IFTTT notifications
- `recipes/` - Real-world patterns (Astro + Pages, search APIs, auth, multi-site)
- `claude/` - Claude Code integration docs

Auto-generated directories (no header nav entry, managed by claude-resources integration):

- `claude-md/` - CLAUDE.md file documentation (`noPage: true`)
- `claude-skills/` - Claude Skills documentation (`noPage: true`)

## Writing Docs

All documentation files use `.mdx` format with YAML frontmatter.

### Frontmatter Fields

Schema defined in `src/config/docs-schema.ts` (validated by `zfb check`):

| Field | Type | Required | Description |
|---|---|---|---|
| `title` | string | Yes | Page title, rendered as the page h1 |
| `description` | string | No | Subtitle displayed below the title |
| `sidebar_position` | number | No | Sort order within category (lower = higher). Always set this for predictable ordering |
| `sidebar_label` | string | No | Custom text for sidebar display (overrides `title`) |
| `tags` | string[] | No | Cross-category grouping tags |
| `draft` | boolean | No | Exclude from build entirely |
| `unlisted` | boolean | No | Built but noindexed, hidden from sidebar/nav |
| `hide_sidebar` | boolean | No | Hide the left sidebar, center content |
| `hide_toc` | boolean | No | Hide the right-side table of contents |
| `standalone` | boolean | No | Hidden from sidebar nav but still indexed |
| `slug` | string | No | Custom URL slug override |
| `generated` | boolean | No | Build-time generated content (skip translation) |
| `search_exclude` | boolean | No | Exclude from search results |
| `pagination_next` | string/null | No | Override next page link (null to hide) |
| `pagination_prev` | string/null | No | Override prev page link (null to hide) |

### Content Rules

- **No h1 in content**: The frontmatter `title` is automatically rendered as the page h1. Start your content with `## h2` headings. Do not write `# h1` in the MDX body.
- **Always set `sidebar_position`**: Without it, pages sort alphabetically which is unpredictable. Use integers starting from 1.
- **Kebab-case file names**: Use `my-article.mdx`, not `myArticle.mdx` or `my_article.mdx`.

### Linking Between Docs

Use relative file paths with the `.mdx` extension:

```markdown
[Link text](./sibling-page.mdx)
[Link text](../other-category/page.mdx)
[Link text](../other-category/page.mdx#anchor)
```

The remark plugin resolves these during build. External links use standard URLs.

### Admonitions

Available globally without imports. Two syntax forms:

**Directive syntax** (preferred for longer content):

```markdown
:::note[Custom Title]
Content here.
:::
```

**JSX syntax** (for inline use):

```markdown
<Note>Short note content.</Note>
```

Types: `<Note>`, `<Tip>`, `<Info>`, `<Warning>`, `<Danger>`

### Mermaid Diagrams

Mermaid is enabled. Use fenced code blocks:

````markdown
```mermaid

graph TB
  A --> B

```
````

### HtmlPreview Component

For interactive HTML/CSS/JS previews with code display:

```markdown
<HtmlPreview html="<div>Hello</div>" css="div { color: red; }" />
```

Use `js`/`displayJs` props for JavaScript demos.

## Navigation Structure

Navigation is filesystem-driven. Directory structure directly becomes sidebar navigation.

### Sidebar Ordering

- Pages are ordered by `sidebar_position` (ascending). Without it, alphabetical order is used.
- Category index pages (`index.mdx`) control category position via their own `sidebar_position`.

### Category Index Pages

Create `index.mdx` in a category directory when you want custom intro copy, description, or explicit sidebar ordering. The framework auto-generates category index pages when missing, but explicit ones give better control.

### Category Configuration

Use `_category_.json` for category-level metadata when needed:

```json
{
  "label": "Category Name",
  "position": 900,
  "description": "Category description",
  "noPage": true
}
```

The `noPage: true` flag means the category has no landing page (just groups items).

### Header Navigation

Defined in `src/config/settings.ts` via `headerNav`. Each item maps to a top-level content directory via `categoryMatch`:

```typescript
{ label: "Overview", path: "/docs/getting-started", categoryMatch: "getting-started" }
```

`categoryMatch` must be a single top-level directory name. Adding a new header nav item requires editing `settings.ts`.

## Content Creation Workflow

### Adding a New Article

1. Create the English `.mdx` file in the appropriate category under `src/content/docs/`
2. Add frontmatter with at least `title` and `sidebar_position`
3. Write content starting with `## h2` headings (not `# h1`)
4. Create the matching Japanese file under `src/content/docs-ja/` with the same path
5. Keep code blocks, Mermaid diagrams, and `<HtmlPreview>` blocks identical -- only translate prose
6. Run `pnpm format:md` to format the MDX files
7. Run `pnpm build` to verify the site builds correctly

### Adding a New Category

1. Create the directory under `src/content/docs/` (kebab-case)
2. Create `index.mdx` with `title`, `description`, and `sidebar_position`
3. Add a `headerNav` entry in `src/config/settings.ts` with `categoryMatch` pointing to the directory name
4. Mirror the directory structure under `src/content/docs-ja/`
5. Run `pnpm build` to verify

## MDX Components

Available globally in MDX without imports:

- `<Note>`, `<Tip>`, `<Info>`, `<Warning>`, `<Danger>` - Admonitions
- `<HtmlPreview>` - Interactive HTML/CSS/JS preview with code display

## Typography

- Futura for page h1 titles and header site name (`font-futura` class)
- Noto Sans JP for body text
- Headings use font-weight 400 (normal), not bold

## Doc Skill (cloudflare-wisdom)

The `cloudflare-wisdom` skill (`.claude/skills/cloudflare-wisdom/SKILL.md`) is **generated** by `pnpm setup:doc-skill` (runs `scripts/setup-doc-skill.sh`). It is gitignored -- do NOT track it in git or edit it directly. To update the skill content, edit the generator script and re-run `pnpm setup:doc-skill`.

## Site Config

- Base path: `/`
- Live URL: `https://zudo-cloudflare-wisdom.takazudomodular.com/`
- Settings: `src/config/settings.ts`

## Hosting & CI/CD

- **Hosting**: Cloudflare Workers static assets
- **PR checks**: typecheck + build + Cloudflare Workers preview
- **Main deploy**: build → Workers production + IFTTT notification
- **Secrets**: `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, `IFTTT_PROD_NOTIFY`
