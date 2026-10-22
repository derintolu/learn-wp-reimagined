# Plan C: Learner and Vibe Coder Paths, Proposal and How This Works, Launch Polish. Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** All three paths are live in the learning studio, the Proposal and How this works pages exist, and the site is ready for Derin to make it public.

**Architecture:**
- **Paths say what they build.** Each live path declares a `preview` kind: `theme` (block theme, today's behaviour), `plugin` (the Vibe coder path builds a plugin on the default theme), or `site` (the Learner path edits pages as block markup on the default theme).
- **The studio, Playground blueprint, live-preview writer and finale read that kind** instead of assuming `block-theme`.
- **File names stay unique across paths**, enforced at build time. The record format (`learn-wp-reimagined/record` v1, which keys files by name) does not change.
- **Content is authored YAML** in the existing schema, checked against live sources before it's written, with a generic test proving every checkpoint and bug behaves.
- **The two new pages** are static Preact pages in the `/connect` pattern, with a shared prose style.

**Tech Stack:** unchanged. Preact 11 + preact-iso, TypeScript, Vite, CodeMirror 6, `@wp-playground/client` 3.1.57, zod, Vitest + @testing-library/preact + happy-dom. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-19-learn-wp-reimagined-design.md` (§2 audience, §3 goals: three paths, Proposal, How this works; §6 look; §8 builder's calls: planted bugs, 5-minute test, accuracy gate; §9 sourcing and credit). The Plan C scope line is in `docs/superpowers/plans/2026-10-19-plan-a-foundation-and-block-theme-path.md:19`. Also read `docs/content-accuracy.md`, the format the new accuracy docs copy.

## Global Constraints

- **Git:** commit to `main` and run `git push origin main` immediately after every commit. Never push to `production`, and never create a local `production` branch. Every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Don't commit the untracked `.DS_Store` files.
- **Browser verification:** use the `agent-browser` CLI only. Never Puppeteer or Playwright, and never Chrome driven by hand. Repeat this in every subagent prompt that involves a browser.
- **Research before relying on memory** (spec §7): lesson facts, WordPress 7 behaviour, function signatures and Playground blueprint steps are checked against live sources while building. Sources are learn.wordpress.org, developer.wordpress.org, WordPress core source on the current branch, and wordpress.github.io/wordpress-playground. Every adapted lesson lists its source in `sources`.
- **Copy:**
  - No emojis.
  - Warm, casual, learner-first.
  - "WordPress" appears only in descriptive copy, never as a logo.
  - Each lesson is credited as adapted from Learn WordPress, not reviewed by the Training Team; the existing `REVIEW_DISCLAIMER` covers this.
  - Planted bugs are labelled "AI-written code. We planted one bug. Find it."
- **Licences:** lesson content is CC BY-SA 4.0 (`content/LICENSE`); code is GPL-2.0-or-later.
- **Look (spec §6):**
  - EB Garamond for headings and Inter for UI.
  - Charcoal bands, WP blue `#3858E9` and `#9FB1FF`.
  - The "unofficial concept" sticker, and no WordPress "W" logo.
  - Use only the tokens in `src/styles/tokens.css`.
- **Accessibility:**
  - WCAG 2.2 AA.
  - Every motion respects `prefers-reduced-motion` (guard: `tests/styles/reduced-motion.test.ts`, which only scans `src/styles/*.css`, so new CSS goes there).
  - At 390px wide there is no horizontal scroll.
- **Record and xAPI:** no new `RecordEvent` types, and no change to `learn-wp-reimagined/record` v1 or `learning-mcp/record` v1.
- **The 5-minute test** (spec §8): lesson 1 of each new path has a branching checkpoint; Vibe coder lesson 1 also has the planted bug.
- **Branch messages** reuse the R-c `when` wording. Every checkpoint has advance, review and skip branches and a fallback (schema-enforced).
- **AI spend:** stay within the existing caps ($100/month, $10/day). The only paid run in this plan is the placement eval in Task 9.
- **Every task ends with** `npm test`, `npx tsc --noEmit` and `npm run build` all passing.

## Review Focus

1. **A learner with block-theme progress starts another path.** Their block-theme files must neither appear in nor be overwritten by the new path's workspace (`workspaceFiles` today always reads `block-theme`). Test: Task 2, "workspace never mixes paths".
2. **A learner reopens a Vibe coder lesson with a saved edit that is a PHP fatal.** The preview must still boot, rather than the `activatePlugin` step failing. Expected: the plugin is activated from the known-good `previewFiles` copy, and the learner's version is written after boot. Test: Task 2, "plugin blueprint activates the known-good main file".
3. **A record saved before Plan C** (block-theme only) still restores, still opens `/finale`, and still downloads `my-block-theme.zip` with the same files. Test: Task 3, "legacy /finale still resolves the block theme".
4. **"Continue in your agent" from a Learner or Vibe coder lesson.** The handoff seeds an MCP record whose files include nested plugin names and `pages/*.html`, and the agent sees the lesson's beats. Test: Task 4, "every live path's lessons convert and seed".
5. **Learner-authored page markup reaches Playground's PHP.** It must never be spliced into PHP source, where it could break the step or inject code. Test: Task 2, "site pages are read from files, never inlined into PHP".

---

## Phase 1: Paths that aren't block themes

### Task 1: `preview` kinds, landing pages and cross-path file rules in the schema and build

**Files:**
- Modify: `src/shared/schema.ts` (`PathSchema`, `LessonSchema`)
- Modify: `src/shared/types.ts`
- Modify: `scripts/build-content.ts:66-102`
- Modify: `content/paths/block-theme/path.yaml`
- Modify: `tests/fixtures/content/block-theme/path.yaml`
- Test: `tests/scripts/build-content.test.ts`

**Interfaces:**
- Produces:
  - `type Preview = { kind: 'theme'; slug: string } | { kind: 'plugin'; slug: string } | { kind: 'site' }`.
  - `Path.preview?: Preview`. It is required when `status: live`, like `previewFiles`.
  - `Lesson.landing?: string`: the URL path Playground opens for that lesson. It must start with `/`. The default is `/`.
  - `slug` matches `^[a-z0-9-]+$`.

- [ ] **Step 1: Write failing tests** in `tests/scripts/build-content.test.ts`, mutating the fixture as the existing cases do:
  - `a live path without preview is rejected` (error mentions `preview`)
  - `theme preview still requires style.css and templates/index.html` (the existing rule, now scoped to `kind: theme`)
  - `plugin preview requires every file under <slug>/ and a main file with a Plugin Name header`: `previewFiles` must contain `<slug>/<slug>.php` matching `/^\s*\*\s*Plugin Name:\s*\S/m`, and every file the path owns (starters, checkpoint and bug files, `previewFiles`, `finalFiles`) starts with `<slug>/`
  - `site preview requires files named pages/<slug>.html`
  - `two live paths may not own the same file name`: the error names the file and both path ids
  - `landing must start with /`
- [ ] **Step 2: Run** `npx vitest run tests/scripts/build-content.test.ts`. Expected: the new cases FAIL.
- [ ] **Step 3: Implement.** Add `PreviewSchema` (a discriminated union on `kind`) and `landing` to the zod schema and types. In `buildContent`, replace the unconditional `previewFiles` theme rule with per-kind rules, and add the cross-path ownership check over live paths. Add `preview: { kind: theme, slug: my-block-theme }` to both block-theme `path.yaml` files.
- [ ] **Step 4: Run** `npm test`. Expected: PASS. The vendored learning-mcp `parseCourse` in `npm run build` must still pass, because `functions/_lib/mcp/course.ts` copies only fields it knows.
- [ ] **Step 5: Commit** `feat(content): paths declare a preview kind; file names unique across live paths`.

### Task 2: Path-aware workspace, blueprint and live-preview writer

**Files:**
- Modify: `src/studio/workspace.ts` (drop `PATH_ID`)
- Modify: `src/finale/playground.ts`
- Modify: `src/studio/previewClient.ts`
- Modify: `src/studio/LivePreview.tsx`
- Modify: `src/studio/WorkspacePane.tsx` (pass the path's preview and the lesson's landing)
- Test: `tests/studio/workspace.test.ts`, `tests/studio/playground.test.ts` (create if absent), `tests/studio/previewClient.test.ts` (create if absent)

**Interfaces:**
- Consumes: `Preview` and `Lesson.landing` (Task 1).
- Produces:
  - `workspaceFiles(c, r, lessonId)`: same signature, now reading `c.paths[c.lessons[lessonId].pathId]`.
  - `playgroundBlueprint(files: Record<string,string>, preview: Preview, opts?: { login?: boolean; landing?: string; known?: Record<string,string> }): Blueprint`.
  - `playgroundUrl(files, preview): string`.
  - `previewTarget(preview: Preview): string`, the directory the files live under:
    - theme: `/wordpress/wp-content/themes/<slug>`
    - plugin: `/wordpress/wp-content/plugins`, because plugin file names already carry `<slug>/`
    - site: `/tmp/learn-pages`
  - `BlueprintStep.step` widens to `'mkdir' | 'writeFile' | 'activateTheme' | 'activatePlugin' | 'runPHP'`, adding `pluginPath?: string` and `code?: string`.
  - `startLivePreview(iframe, files, preview, landing, signal?, onLateReady?)`.

- [ ] **Step 1: Research.**
  - Confirm on wordpress.github.io/wordpress-playground the current shapes of the `activatePlugin` step (`pluginPath`), the `runPHP` step (`code`), and the client's `run({ code })`, `writeFile`, `mkdir` and `goTo` for `@wp-playground/client` 3.1.57.
  - Confirm which default theme a `wp: latest` Playground activates.
  - Note the URLs in the commit body.
- [ ] **Step 2: Write failing tests:**
  - `workspace never mixes paths`: a record holding a passing block-theme `theme.json` (with `fileLessons` from `bt-style-css-and-theme-json`) gives a fixture plugin-path lesson a `files` map with no block-theme names, and its editable list is that lesson's own files.
  - `theme blueprint is unchanged for block-theme`: `playgroundBlueprint(files, {kind:'theme', slug:'my-block-theme'})` deep-equals a snapshot of today's output.
  - `plugin blueprint activates the known-good main file`: given `opts.known` (the path's `previewFiles`) and a workspace main file of `<?php syntax error`, the `writeFile` before `activatePlugin` carries the known-good text, the learner's text is not in the boot blueprint at all, and `pluginPath` is `<slug>/<slug>.php`.
  - `site pages are read from files, never inlined into PHP`: for a page whose content is `<?php echo 1; ?>' ); exit; //`, no `runPHP.code` contains the page text. The code reads `/tmp/learn-pages/pages/<name>.html` with `file_get_contents`, upserts a page by slug `<name>`, and when `pages/home.html` exists sets `show_on_front=page` and `page_on_front`.
  - `writer targets the preview kind and lands on the lesson's page`: with a fake client, a plugin write goes to `/wordpress/wp-content/plugins/<slug>/…`, a site write re-runs the same pages PHP through `client.run`, and every kind ends with `goTo(landing)`.
- [ ] **Step 3: Run** these test files. Expected: FAIL.
- [ ] **Step 4: Implement.**
  - The site PHP is one exported `sitePagesPhp(names: string[]): string`, built from file names only. Names are already constrained to `^pages/[a-z0-9-]+\.html$` by Task 1.
  - The plugin boot uses `opts.known` for the main file, and `startLivePreview` writes the full workspace with the writer once boot finishes.
  - Theme behaviour stays byte-identical.
- [ ] **Step 5: Run** `npm test`. Expected: PASS.
- [ ] **Step 6: Commit** `feat(studio): workspace, blueprint and live preview follow the lesson's path`.

### Task 3: Finale per path

**Files:**
- Modify: `src/finale/themeZip.ts`: rename `resolveTheme` to `resolveFiles`, and `themeZip` to `pathZip`
- Modify: `src/pages/Finale.tsx`
- Modify: `src/app.tsx:76`
- Modify: `src/pages/Lesson.tsx:166`
- Modify: `src/pages/PathOverview.tsx:60`
- Test: `tests/finale/finale.test.ts`, `tests/finale/finale-page.test.tsx`, `tests/components/routing.test.tsx`

**Interfaces:**
- Consumes: `playgroundUrl(files, preview)` (Task 2).
- Produces:
  - `resolveFiles(c: ContentBundle, r: LearningRecord, pathId: PathId): ResolvedTheme`. The type name is kept; the R25 rule is unchanged.
  - `pathZip(files, preview): Uint8Array`. Theme files go under `<slug>/`. Plugin names already have it. Site has no zip.
  - Route `/finale/:pathId`. `/finale` renders the block-theme finale.

- [ ] **Step 1: Write failing tests:**
  - `legacy /finale still resolves the block theme`: a pre-Plan-C fixture record gives the same files and zip entries as today.
  - `/finale/vibe-coder downloads my-first-plugin.zip and opens Playground with the plugin active`
  - `/finale/learner offers "Open your site in Playground" and no download`
  - `the last lesson's button goes to its own path's finale`
  - `PathOverview's finale link uses the path id`
  - Routing table rows: `/finale/learner`, `/finale/vibe-coder` and `/connect` (the last is currently missing), each with its h1.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Each kind's finale copy is authored in `Finale.tsx`:
    - theme: today's copy
    - plugin: "your first plugin"
    - site: "your first site"
  - Use the path's `SketchIcon`.
  - An unknown or non-live `:pathId` renders `NotFound`.
- [ ] **Step 4: Run** `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(finale): a finale for every path; /finale stays the block theme`.

### Task 4: Path-neutral copy, MCP course text, and a generic content harness

**Files:**
- Modify: `src/studio/Feed.tsx:17,20` and `src/studio/LivePreview.tsx:45,55`: "your theme" becomes per-kind words via one helper `buildNoun(preview): 'theme' | 'plugin' | 'site'` in `src/studio/workspace.ts`
- Modify: `src/pages/PathOverview.tsx:32`: the coming-soon copy no longer names the block theme path
- Modify: `src/pages/Home.tsx:105`: drop "The paths still to come…"
- Modify: `functions/_lib/mcp/course.ts:16,67`: `COURSE_RULES[2]` becomes "The learner edits their files by hand", and `description` names all live paths
- Create: `tests/content/paths.test.ts`, `tests/content/solutions.ts`
- Test: `tests/functions/mcp-course.test.ts`, `tests/agent/mcp-seed.test.ts` (or the existing seed test file)

**Interfaces:**
- Produces: `SOLUTIONS: Record<string, Record<string, string>>` in `tests/content/solutions.ts`, keyed by checkpoint id or bug id, then by file name to the learner's intended text. Every content task adds its entries here.

- [ ] **Step 1: Write the harness.** `tests/content/paths.test.ts` iterates every live path in the real bundle:
  - `every code checkpoint fails on its starting workspace`: run `workspaceFiles` for an empty record at that lesson, then `runChecks`.
  - `every code checkpoint passes on its solution`
  - `every planted bug fails its fixChecks and its solution passes them`
  - `every code checkpoint and bug has a SOLUTIONS entry`
  - `finalFiles pass every lesson's checks` (already built, now asserted for all paths)
  - `lesson 1 has a checkpoint`
  - `every lesson credits a learn.wordpress.org or developer.wordpress.org source`

  Port the block-theme solutions from `tests/content/block-theme-checks.test.ts` into `SOLUTIONS`, and keep that file for its mistake cases and key audit.
- [ ] **Step 2: Write failing tests:**
  - In `mcp-course.test.ts`: `course text names no single path`
  - In the seed test: `every live path's lessons convert and seed`. For each live path's first and last lesson, seeding a handoff with that lesson's files gives a record whose current lesson matches, and `get_lesson` returns its beats.
- [ ] **Step 3: Run.** Expected: FAIL (the harness passes for block-theme only once the solutions are ported).
- [ ] **Step 4: Implement** the copy changes and the course text.
- [ ] **Step 5: Run** `npm test`. Expected: PASS.
- [ ] **Step 6: Commit** `refactor: studio, finale and MCP copy name no single path; a content harness for every path`.

## Phase 2: Content

Every content task follows the same method, which the steps below abbreviate as "the accuracy method":

1. **Research first** (WebFetch or the firecrawl skill). Read the named Learn lessons and the current Developer Handbook pages, and record the facts taken, with URLs.
2. **Write or extend the path's accuracy doc** (`docs/content-accuracy-<pathId>.md`), in the format of `docs/content-accuracy.md`: sources and the facts taken, then a `- [x]` checklist per lesson.
3. **Author the lessons.** Use 3 to 5 beats each, each beat with a goal, content and a question. Adapt the sources rather than copying them, and list each one in `sources`.
4. **Add SOLUTIONS entries.** Add a plausible-mistake case per code checkpoint in `tests/content/<pathId>-checks.test.ts`.
5. **Run** `npm test` and `npm run build`.
6. **Check in the browser** with the agent-browser CLI against `npm run dev` on port 5175, at 1440x900 and 390x844. For each new lesson:
   - the beats render
   - the preview boots and shows the edit after "Apply to site"
   - the bug hunt and checkpoint pass with the solution
   - there is no horizontal scroll at 390px

   Save the screenshots in the scratchpad, not the repo.
7. **Commit and push.**

The lesson outlines below are the builder's proposal. Research may change titles and order, but not the counts, the preview kind or where the planted bug sits. A change goes in the accuracy doc with its reason.

### Task 5: Learner path, lessons 1 to 3 (path goes live)

**Files:**
- Modify: `content/paths/learner/path.yaml`
  - `status: live`, `preview: { kind: site }`, real `placementHints` ("Start at <lesson-id> if…", like block-theme)
  - `previewFiles: { pages/home.html }`, a small known-good front page in block markup
- Create: `content/paths/learner/01-…yaml` to `03-…yaml`
- Create: `docs/content-accuracy-learner.md`
- Create: `tests/content/learner-checks.test.ts`

**Sources:** *Beginner WordPress User* on learn.wordpress.org.

**Outline (ids start `ln-`):**

| # | Lesson | `landing` | Checkpoint |
| --- | --- | --- | --- |
| 1 | `ln-what-is-wordpress`: what a site is, and the dashboard tour | `/wp-admin/` | free-text: "which part of the dashboard would you use to…" |
| 2 | `ln-posts-and-pages`: when to use which | `/wp-admin/edit.php?post_type=page` | free-text |
| 3 | `ln-blocks`: the block editor and the Code editor view | | code |

Lesson 3:
- **Starter:** `pages/about.html` in block markup.
- **Planted bug:** in an AI-written About page, a paragraph's closing `<!-- /wp:paragraph -->` is missing, so the editor reports invalid content. Its `fixChecks` count opening and closing paragraph comments with a regex.
- **Code checkpoint:** add a heading block and a paragraph to `pages/about.html` (`regex` checks on `<!-- wp:heading` and `<!-- /wp:heading -->`).

- [ ] **Step 1: Apply the accuracy method** to lessons 1 to 3.
- [ ] **Step 2: Confirm** `PathCards`, `PlacementChat` and `/path/learner` show the path as live (existing tests plus one `placement.test.tsx` case: "the learner path card links to /path/learner").
- [ ] **Step 3: Commit** `feat(content): the Learner path, lessons 1 to 3`.

### Task 6: Learner path, lessons 4 to 6

**Files:**
- Create: `content/paths/learner/04-…yaml` to `06-…yaml`
- Modify: `content/paths/learner/path.yaml` (`finalFiles`)
- Modify: `docs/content-accuracy-learner.md`, `tests/content/learner-checks.test.ts`

**Sources:** *Beginner WordPress User* for lesson 4; *AI-Powered WordPress* (launched 2026-09-18) for lesson 5. Lesson 5 must describe only WordPress 7 AI features the course and core docs confirm exist.

**Outline:**

| # | Lesson | `landing` | Checkpoint |
| --- | --- | --- | --- |
| 4 | `ln-navigation-and-site-editor` | `/wp-admin/site-editor.php` | free-text |
| 5 | `ln-ai-in-wordpress`: using WordPress 7's built-in AI and checking what it writes | | free-text: what you check before publishing AI text |
| 6 | `ln-publish`: publishing and next steps | | none; auto-completes like `bt-ship-it` |

- [ ] **Step 1: Apply the accuracy method** to lessons 4 to 6.
- [ ] **Step 2: Walk the whole path** in the browser from placement to `/finale/learner`, and confirm "Open your site in Playground" boots with the learner's pages.
- [ ] **Step 3: Commit** `feat(content): the Learner path, lessons 4 to 6`.

### Task 7: Vibe coder path, lessons 1 to 3 (path goes live)

**Files:**
- Modify: `content/paths/vibe-coder/path.yaml`
  - `status: live`, `preview: { kind: plugin, slug: my-first-plugin }`, real `placementHints`
  - `previewFiles: { my-first-plugin/my-first-plugin.php }`, with a valid plugin header and nothing else
- Create: `content/paths/vibe-coder/01-…yaml` to `03-…yaml`
- Create: `docs/content-accuracy-vibe-coder.md`
- Create: `tests/content/vibe-coder-checks.test.ts`

**Sources:** the Plugin Handbook (hooks, enqueueing, security) on developer.wordpress.org, plus the hooks and enqueueing lessons in *Beginner WordPress Developer*.

**Outline (ids start `vc-`):**

| # | Lesson | Planted bug | Checkpoint |
| --- | --- | --- | --- |
| 1 | `vc-actions-and-filters` | AI-written `the_content` filter that `echo`es instead of `return`ing, so every post's content vanishes in the preview. `fixChecks`: a `return` of the filtered value inside the callback, and no `echo` | free-text: predict what a filter callback must give back |
| 2 | `vc-enqueueing` | | code: enqueue a stylesheet on `wp_enqueue_scripts` (not `init`) with `plugins_url` |
| 3 | `vc-escaping-and-sanitizing` | AI-written output of a query var without escaping | code: `esc_html` on output, `sanitize_text_field` on input |

- [ ] **Step 1: Apply the accuracy method** to lessons 1 to 3. The checks are `regex`/`contains` on PHP text. State in the accuracy doc that the checks are textual, not executed.
- [ ] **Step 2: Confirm in the browser** that the lesson 1 bug visibly breaks the preview (post content missing) and the fix brings it back.
- [ ] **Step 3: Commit** `feat(content): the Vibe coder path, lessons 1 to 3`.

### Task 8: Vibe coder path, lessons 4 to 6

**Files:**
- Create: `content/paths/vibe-coder/04-…yaml` to `06-…yaml`
- Modify: `content/paths/vibe-coder/path.yaml` (`finalFiles`)
- Modify: `docs/content-accuracy-vibe-coder.md`, `tests/content/vibe-coder-checks.test.ts`

**Outline:**

| # | Lesson | Checkpoint |
| --- | --- | --- |
| 4 | `vc-template-hierarchy`: which template renders a request, and what a plugin may and may not change | free-text: predict which template a URL uses on the active default theme (verified against that theme's files) |
| 5 | `vc-theme-json-from-code`: the `wp_theme_json_data_theme` filter | code: the filter callback calls `update_with` and returns the data object |
| 6 | `vc-ship-it`: header fields, prefixing, and the plugin directory's guidelines | none |

- [ ] **Step 1: Apply the accuracy method** to lessons 4 to 6.
- [ ] **Step 2: Walk the whole path** in the browser to `/finale/vibe-coder`, and confirm the zip unpacks to `my-first-plugin/…` and Playground boots with it active.
- [ ] **Step 3: Commit** `feat(content): the Vibe coder path, lessons 4 to 6`.

### Task 9: Placement across three live paths

**Files:**
- Modify: `tests/eval/cases.yaml` (it currently says block-theme is the only live path)
- Modify: `tests/fixtures/content/` (live learner and vibe-coder fixture paths with 2 lessons each, so the eval and placement tests see three)
- Modify: `docs/model-eval.md`
- Test: `tests/components/placement.test.tsx`, `tests/functions/prompts.test.ts`

- [ ] **Step 1: Write failing tests.**
  - `placementPrompt lists all three live paths with their hints`
  - Placement chat: `a placement into vibe-coder opens /learn/<vc lesson>`
- [ ] **Step 2: Add eval cases.** Add at least 3 placement cases per new path: a total beginner goes to `ln-what-is-wordpress`; "I ship with Cursor but don't read the PHP" goes to `vc-actions-and-filters`; an ambiguous case is acceptable on either.
- [ ] **Step 3: Run** `npx tsx scripts/eval-models.ts --only placement --models gpt-oss-120b` (one model, placement only: a few cents). Record the pass rate in a new dated section of `docs/model-eval.md`.
- [ ] **Step 4: Fix and re-run if needed.** If the pass rate is below the block-theme-only run's, adjust `placementHints` (content, not prompt code) and run once more. Report the before and after numbers.
- [ ] **Step 5: Commit** `test(eval): placement across three live paths`.

## Phase 3: Pages and launch polish

### Task 10: Prose style, page titles, and the How this works page

**Files:**
- Create: `src/pages/HowItWorks.tsx`, `src/styles/prose.css` (imported in `src/main.tsx`), `src/usePageTitle.ts`
- Modify: `src/app.tsx` (route `/how-it-works`), `src/components/Header.tsx` (nav item "How this works"), `src/components/Footer.tsx` (links to How this works and Proposal), `src/pages/Home.tsx` (the "How this works" band links to the page)
- Modify: every page in `src/pages/` to call `usePageTitle`
- Test: `tests/components/how-it-works.test.tsx`, `tests/components/routing.test.tsx`, `tests/components/shell.test.tsx`, `tests/components/placement.test.tsx:365-376` (band titles unchanged; add the link assertion)

**Interfaces:**
- Produces:
  - `usePageTitle(title: string | null): void`. It sets `document.title` to `${title} · Learn WordPress, reimagined`, or the bare site name for `null`.
  - `.prose`: long-form column styles at `--measure`, with headings, lists, tables, blockquote and footnote-style source lists.

**Content (spec §3, "How this works"):** what's real and what's concept, said plainly.
- **Real:** live open-model AI on Workers AI, the models per task from `docs/model-eval.md`, real adapted Learn content with sources, real authored branching, deterministic checks, real xAPI in a record the learner owns, the MCP server.
- **Concept:** no accounts, unofficial, not affiliated, and not reviewed by the Training Team.
- How planted bugs are made (AI-generated ahead of time, bug planted by the author), what the AI may and may not do, the provider interface (Workers AI live, Anthropic adapter off), and the spending cap.
- Credits to Learn WordPress and the Training Team, CC BY-SA 4.0, and the repo link.
- Every number comes from the repo (`docs/model-eval.md`, `functions/_lib/budget.ts`, `functions/_lib/mcp/gate.ts`), and the page names its source.

- [ ] **Step 1: Write failing tests.**
  - `/how-it-works renders h1 "How this works"`
  - `it states the not-affiliated and not-reviewed disclaimers`
  - `it links to the repo and to learn.wordpress.org`
  - `every route sets a document title` (an `it.each` over the routing table)
  - The header and footer link tests.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Check in the browser** with the agent-browser CLI at 1440x900 and 390x844: no horizontal scroll, and reading order and heading levels make sense.
- [ ] **Step 5: Commit** `feat(pages): How this works, page titles and a prose style`.

### Task 11: The Proposal page

**Files:**
- Create: `src/pages/Proposal.tsx`
- Modify: `src/app.tsx` (`/proposal`)
- Test: `tests/components/proposal.test.tsx`, `tests/components/routing.test.tsx`

**Content (spec §2 and §3, "Proposal page").** It should read like a well-made Make/Training post, in this order:
1. **The gap, with sources:** Learn runs on Sensei; Learning Pathways (2024) are fixed sequences; the April 2026 AI work and the AI-Powered WordPress course are aimed at authors and site owners, and nothing adapts to the learner. Re-verify each claim against its live source before writing, and link it.
2. **What the demo proves:** the three success-test ideas from spec §1.
3. **A phased path onto Learn:** a tutor and placement layer alongside Sensei first, not a rewrite; then the WordPress.org login adapter for the record (spec §3a); then Sensei progress.
4. **How authored branching fits the team's content workflow** and its April 2026 authoring tools.
5. **Cost per learner** on open models: about $4.97 per 1000 learners at the documented mix, with the assumptions stated, from `docs/model-eval.md`. Plus privacy (anonymous xAPI actor, local-first record, 30-day relay), accessibility, and maintenance load.
6. **Design decisions:** the tradeoffs, each with its cost. Draw from the rulings in the plans and from learning-mcp `docs/STATUS.md`.

The byline stays understated (the footer's "Concept and build by Derin Tolu"); there is no sales pitch.

- [ ] **Step 1: Write failing tests.**
  - `/proposal renders h1 and the six section headings in order`
  - `every claim in "The gap" has a link`
  - `the cost figure matches docs/model-eval.md`: import the number from one constant in `src/shared/course-meta.ts`, used by both the page and How this works
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Research and implement.** Record each source URL and the date checked in a comment block at the top of `Proposal.tsx`.
- [ ] **Step 4: Check in the browser** as in Task 10.
- [ ] **Step 5: Commit** `feat(pages): the Proposal`.

### Task 12: Launch polish and the readiness checklist

**Files:**
- Modify: `index.html` (`<link rel="canonical" href="https://learn-wp-reimagined.space.fast/">`, `<meta name="theme-color" content="#1E1E1E">`)
- Create: `public/robots.txt`
- Create: `docs/launch-checklist.md`
- Test: `tests/site/index-html.test.ts`

The robots file:

```
User-agent: *
Allow: /
Disallow: /api/
```

`docs/launch-checklist.md` is Plan B Task 10's list, written down and not executed. Plan B wrote the spec for it at `docs/superpowers/plans/2026-10-20-plan-b-bring-your-own-agent.md:159-161`. Add:
- recheck `src/agent/clients.ts:19-20` connector steps
- re-run the full placement eval if content changed after Task 9
- remove the leftover `.claude/worktrees/` (Derin's call)

- [ ] **Step 1: Write failing tests** in `index-html.test.ts`: canonical and theme-color are present; `public/robots.txt` disallows `/api/`.
- [ ] **Step 2: Implement and run** `npm test`, `npx tsc --noEmit`, `npm run build`. Expected: all PASS, and the `dist/` function bundles are each under 8 MiB (print their sizes).
- [ ] **Step 3: Run a final browser pass** with the agent-browser CLI at 1440x900 and 390x844 on `/`, `/path/learner`, `/path/vibe-coder`, `/how-it-works`, `/proposal` and `/connect`, plus lesson 1 of each path. Check: no horizontal scroll, keyboard focus is visible, and nothing moves under reduced motion (`--prefers-reduced-motion` or the CLI's equivalent).
- [ ] **Step 4: Commit** `chore(launch): canonical, theme colour, robots and the readiness checklist`. Do not deploy or make the space public; that is Derin's.
