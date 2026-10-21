# Learning Studio Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild `/learn/:lessonId` as the "learning studio" Derin approved on 2026-10-20: course outline on the left, the conversation as the central stage, and a workspace on the right with the theme's files and a live WordPress Playground running them.

**Architecture:** The lesson page becomes a full-height three-pane studio. A `StudioProvider` owns the lesson's workspace files and the live preview. The feed, the bug hunt and the code checkpoint all read and write files through it, so there is one editor (in the workspace), not one per card. Lesson content arrives as authored section cards in the conversation. The AI tutor responds to the learner's answers and questions in that same conversation, using the existing `/api/tutor` `ask` mode. The record, checks, branching engine, spend cap and content stay as they are.

**Tech Stack:** Preact 11 + preact-iso, TypeScript, Vite, CodeMirror 6 (existing lazy editor), `@wp-playground/client` 3.1.57 (new), Vitest + @testing-library/preact + happy-dom.

**Spec:** The approved clickable mockup, copied into the repo by Task 1 as `docs/superpowers/mockups/2026-10-20-learning-studio.html`, plus `docs/superpowers/specs/2026-10-19-learn-wp-reimagined-design.md` (§3 goals, §3a record, §6 look, §7 constraints). Where they differ on the lesson page, the mockup wins.

## Design decisions (builder's calls, made in this plan)

- **Authored cards, AI conversation.** Each beat shows as a section card with the authored `beat.content`, which is accurate, instant and free. The studio does not call `/api/tutor` in `deliver` mode. The tutor speaks when the learner answers a beat's question or asks something, via `ask` mode. The server keeps `deliver` support, unused.
- **One editor.** The bug hunt and the code checkpoint don't embed editors. Their cards say which file to fix, open it in the workspace, and run checks against the workspace copy.
- **A preview scaffold.** Lesson 1 has no template, and an empty block theme won't render, so the path gets `previewFiles`: a small read-only scaffold. Its header band is painted with the `contrast` preset, so lesson 1's planted bug visibly breaks the live site.
- **When Playground updates.** It boots with the workspace files. After that it updates on "Apply to site", when the bug hunt starts (the buggy file goes live), and when a bug fix or code checkpoint passes. It never updates on every keystroke.

## Global Constraints

- Commit to `main` and push to `origin/main` immediately after every commit. Never push to `production`, and never create a local `production` branch.
- Browser verification uses the `agent-browser` CLI only. Never Puppeteer or Playwright, and never Chrome driven by hand. This applies to subagents.
- Exact dependency versions, no ranges. The only new dependency is `"@wp-playground/client": "3.1.57"`.
- Record events and xAPI statements are unchanged: no new `RecordEvent` types, and the same dispatches happen at the same moments as today (`beatViewed`, `fileEdited` with `lessonId`, `codeChecked`, `checkpointAnswered`, `lessonCompleted`).
- R3/R21 still hold: after 2 failed code checks the learner is offered "Keep trying" or review, never a recorded pass. R22 still holds: a completed lesson is read-only.
- Look (spec §6): EB Garamond for headings, Inter for UI, charcoal bars, WP blue `#3858E9` and `#9FB1FF`, the "unofficial concept" sticker, no WordPress "W" logo. Use the existing tokens in `src/styles/tokens.css`. No emojis in copy.
- WCAG 2.2 AA. Every motion respects `prefers-reduced-motion` and never hides core UI (the guard is `tests/styles/reduced-motion.test.ts`). The feed is a `role="log"` with `aria-live="polite"`.
- At 390px wide there is no horizontal scroll. At ≤960px the panes become a three-way switch: Outline / Lesson / Workspace.

## Review Focus

1. **Playground can't load** (offline, blocked, slow, `remote.html` errors). The lesson must stay fully usable, and the preview should show "Couldn't start WordPress here" plus an "Open in Playground" link, with no unhandled rejection. Tested in Task 2.
2. **Invalid JSON applied to the site** (a learner breaks `theme.json` and presses Apply). The write still goes through, because WordPress ignores a bad theme.json and that is itself a lesson. Nothing in the studio throws. Tested in Task 3.
3. **Reload in the middle of the bug hunt.** The workspace and preview restore the learner's in-progress edit of the bug file (saved with this lesson's id). They don't reset to `bug.code` or to the starter. Tested in Task 5.
4. **Moving to the next lesson.** The workspace swaps to the new lesson's files with no stale tabs. Edits made in the previous lesson stay in the record under that lesson's id. New edits are tagged with the new lesson's id. Tested in Task 6.
5. **The AI goes capped or off mid-conversation.** The composer turns into the cap notice, any pending turn shows the failure copy, and Continue still works through the whole lesson. Tested in Task 4.

---

### Task 1: Preview scaffold and workspace file resolver

**Files:**
- Create: `docs/superpowers/mockups/2026-10-20-learning-studio.html`. Copy it verbatim from `/private/tmp/claude-501/-Users-cedarstone-Projects/958ee5f0-2f2e-421f-8c1f-34293bfb9ed1/scratchpad/studio/index.html`.
- Modify: `src/shared/types.ts` (`Path`), `src/shared/schema.ts` (`PathSchema`), `scripts/build-content.ts`, `content/paths/block-theme/path.yaml`, `tests/fixtures/content/paths/*/path.yaml` for the fixture's live path.
- Create: `src/studio/workspace.ts`
- Test: `tests/studio/workspace.test.ts`, `tests/scripts/build-content.test.ts`

**Interfaces:**
- Produces: `Path.previewFiles?: Record<string, string>`.
- Produces: `workspaceFiles(c: ContentBundle, r: LearningRecord, lessonId: string): { files: Record<string, string>; editable: string[] }`.
- Produces: `ownedFiles(l: Lesson): string[]`, moved from `src/finale/themeZip.ts` into `src/studio/workspace.ts` and exported. `themeZip.ts` imports it.

- [ ] **Step 1: Write failing tests** in `tests/studio/workspace.test.ts`, using the fixture content (`buildContent('tests/fixtures/content')`):
  - `first lesson = previewFiles overlaid by its starterFiles`: with `newRecord()`, `files` equals `{...previewFiles, ...lesson1.starterFiles}`, and `editable` equals `ownedFiles(lesson1)`.
  - `an earlier lesson's passing edit carries forward`: the learner edited `theme.json` in lesson 1 (`fileLessons['theme.json'] = lesson1.id`), the edit passes lesson 1's checks, and lesson 2 has no `theme.json` starter. Then lesson 2's `files['theme.json']` is the learner's text.
  - `an earlier edit that fails its owner's checks is replaced by the starter`, mirroring R25.
  - `this lesson's own saved edit wins over its starter`: `fileLessons[f] === lessonId` means `files[f]` is the saved text.
  - `another lesson's later edit is not used as this lesson's starting point`: an edit tagged with lesson 3 is not used when opening lesson 2.
  - `files outside previewFiles and owned files are not included`.
- [ ] **Step 2:** Run `npx vitest run tests/studio/workspace.test.ts`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement `workspaceFiles`.** Walk the path's lessons in order up to, but not including, `lessonId`. Start from `previewFiles`, then apply each earlier lesson's `starterFiles`. For each file, the last earlier lesson that owns it decides: the learner's edit wins only if `fileLessons[file]` is that lesson (or is missing), it passes that lesson's checks for the file, and `.json` parses. That is the R25 rule from `resolveTheme`, applied to earlier lessons only. Then apply this lesson's `starterFiles`, then this lesson's own saved edits. `editable = ownedFiles(lesson)`. Don't add `bug.file`'s `bug.code` here; Task 5 swaps it in when the hunt starts.
- [ ] **Step 4: Add `previewFiles`** to the type, to `PathSchema` (an optional string record, allowed only on live paths, like `finalFiles`), and to `build-content.ts`. The build fails if a live path lacks `previewFiles`, if it lacks `style.css` or `templates/index.html`, or if any `.json` in it doesn't parse. Add a test case for each failure to `tests/scripts/build-content.test.ts`.
- [ ] **Step 5: Author `previewFiles`** in `content/paths/block-theme/path.yaml`. Use the mockup's `STYLE_CSS`, `THEME_JSON` and `INDEX_HTML` constants verbatim: a contrast header band containing the site title, then a query loop on a `subtle` group. Add a comment above it: "Read-only scaffold so the live preview renders before lesson 3 teaches templates." Add a minimal `previewFiles` to the fixture's live path.
- [ ] **Step 6:** Run `npm test` and `npx tsc --noEmit`. Expected: all pass.
- [ ] **Step 7: Commit and push.** Message: `feat(studio): preview scaffold and workspace file resolver`.

### Task 2: Live preview (Playground client)

**Files:**
- Modify: `package.json` (add `"@wp-playground/client": "3.1.57"`), `src/finale/playground.ts`
- Create: `src/studio/livePreview.ts`, `src/studio/LivePreview.tsx`
- Test: `tests/studio/live-preview.test.tsx`

**Interfaces:**
- Consumes: `playgroundBlueprint(files)` and `playgroundUrl(files)` from `src/finale/playground.ts`.
- Produces: `playgroundBlueprint(files, opts?: { login?: boolean })`. The default stays `true`, so the finale is unchanged; the studio passes `login: false`.
- Produces: `setPlaygroundImporter(fn: (() => Promise<typeof import('@wp-playground/client')>) | null): void`, for tests, with the same pattern as `setEditorImporter`.
- Produces: `startLivePreview(iframe: HTMLIFrameElement, files: Record<string, string>, signal?: AbortSignal): Promise<LivePreview>`, where `interface LivePreview { write(files: Record<string, string>): Promise<void> }`.
- Produces: `PREVIEW_BOOT_TIMEOUT_MS = 45_000`.
- Produces: `<LivePreview files={Record<string,string>} onReady={(p: LivePreview) => void} />`. It renders the status line and the iframe. Its states: `booting` ("Starting WordPress Playground"), `live` ("Live: your theme in WordPress Playground"), `failed` ("Couldn't start WordPress here." plus an `Open in Playground` link to `playgroundUrl(files)`, opening in a new tab).

- [ ] **Step 1: Write failing tests** with a fake client whose `writeFile`, `mkdir`, `goTo` and `isReady` are `vi.fn`:
  - `boots with the theme blueprint and login false`: `startPlaygroundWeb` receives `remoteUrl: 'https://playground.wordpress.net/remote.html'` and the blueprint from `playgroundBlueprint(files, { login: false })`.
  - `write() mkdirs new folders, writes each file under the theme dir, then goTo('/')`. Assert call order.
  - `importer rejects -> failed state with Open in Playground link` (Review Focus 1).
  - `boot exceeding PREVIEW_BOOT_TIMEOUT_MS -> failed state` (fake timers).
  - `no unhandled rejection when the iframe unmounts mid-boot`.
- [ ] **Step 2:** Run `npx vitest run tests/studio/live-preview.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.** Use the same lazy-import pattern as `LazyCodeEditor` so Playground is its own chunk. The theme dir comes from `THEME_SLUG`. Check `index.html`, `sf.jsonc` and `vite.config.*` for a Content-Security-Policy; if one exists, allow `frame-src https://playground.wordpress.net`.
- [ ] **Step 4:** Run `npm i`, `npm test` and `npx tsc --noEmit`. Expected: all pass.
- [ ] **Step 5: Commit and push.** Message: `feat(studio): live WordPress Playground preview`.

### Task 3: Studio state and the workspace pane

**Files:**
- Create: `src/studio/StudioContext.tsx`, `src/studio/Workspace.tsx`, `src/styles/studio.css` (imported where the other styles are)
- Modify: `src/components/CodeEditor.tsx` and `src/components/LazyCodeEditor.tsx`, adding a `readOnly?: boolean` prop if it's missing (CodeMirror `EditorState.readOnly`; the textarea fallback gets `readOnly`)
- Test: `tests/studio/workspace-pane.test.tsx`

**Interfaces:**
- Consumes: `workspaceFiles` (Task 1), `<LivePreview>` and `LivePreview` (Task 2), and `useFileEdits(lessonId)`.
- Produces: `<StudioProvider lesson={Lesson}>` and `useStudio(): Studio`, where:

```ts
interface Studio {
  files: Record<string, string>;
  editable: string[];
  active: string;                            // open tab
  openFile(name: string): void;              // also switches the mobile pane to Workspace
  setFile(name: string, text: string): void; // editable files dispatch fileEdited (debounced, lessonId) via useFileEdits
  replaceFile(name: string, text: string): void; // like setFile but programmatic (bug hunt start)
  apply(names?: string[]): Promise<void>;    // default: every file whose text differs from what the preview has
  dirty: string[];                           // files changed since last apply
  flush(): void;                             // useFileEdits flush
}
```

- [ ] **Step 1: Write failing tests:**
  - `tabs list every workspace file, with the open tab aria-selected`.
  - `a provided (non-editable) file opens read-only, labelled "Provided"`.
  - `typing in an editable file dispatches fileEdited with this lesson's id after the debounce`.
  - `Apply to site writes only dirty files to the preview and clears the dirty dots`.
  - `applying invalid JSON still writes it and nothing throws` (Review Focus 2).
- [ ] **Step 2:** Run `npx vitest run tests/studio/workspace-pane.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement `StudioProvider` and `<Workspace>`.**
  - Layout follows the mockup's `.workspace`: a tab strip with dirty dots, an "Apply to site" button, the editor (about 45% of the height), the status line, then the preview (about 55%).
  - Initial files come from `workspaceFiles(content, manager.record, lesson.id)`, read once after `manager.init()`.
  - A file added after boot (for example `parts/header.html`) goes through `write()`, which mkdirs.
- [ ] **Step 4:** Run `npm test` and `npx tsc --noEmit`. Expected: all pass.
- [ ] **Step 5: Commit and push.** Message: `feat(studio): workspace pane with tabs, editor and apply`.

### Task 4: The conversation feed

**Files:**
- Create: `src/studio/Feed.tsx`, `src/studio/SectionCard.tsx`, `src/studio/Composer.tsx`
- Test: `tests/studio/feed.test.tsx`

**Interfaces:**
- Consumes: `tutorStream`, `ChatMessage` and `useAiStatus`/`reportAiError`, as `Tutor.tsx` uses them today, plus `Markdown`, `tidy` and `CapNotice`.
- Produces: `<Feed lesson={Lesson} step={number} readOnly={boolean} nextLabel={string} onNext={() => void}>{children}</Feed>`. Children are the post-beat cards from Task 5 and Task 6, rendered after the last section.
- Produces: `Turn { role: 'user' | 'assistant'; content: string; beatIndex: number; failed?: boolean }`, held in `Feed` state and not persisted (as today).

Behaviour:
- **Welcome message.** The first tutor message is fixed copy: "Hi. On the right is a real WordPress running your theme, and the files that make it. Everything we talk about, you'll see and change there."
- **Section cards.** Beats `0..step` each render a `SectionCard`, as in the mockup's `.section-card`. The header is `{lessonNumber}.{i+1}` plus `beat.goal`, the body is `<Markdown text={beat.content}>`, and the footer reads "Based on" plus the lesson's sources as links that open in a new tab. The heading gets focus when the card becomes active, as today.
- **Questions.** If `beat.question` is set, a tutor message with the question follows the card.
- **Composer.** It is fixed at the bottom of the stage. Its placeholder is "Answer, or ask the tutor anything". Enter sends; Shift+Enter adds a new line. A send goes to `tutorStream({ lessonId, beatIndex: step, mode: 'ask', messages })`, with the same 12-message and 1500-character limits as `Tutor.tsx`. While the current beat's question is still unanswered, the first send is wrapped as `Answering your question "${beat.question}": ${text}`. The learner bubble shows only `text`.
- **Where turns go.** Each turn renders under the beat it was sent in.
- **Continue.** A Continue button sits under the active beat, labelled with `nextLabel` (the current rules from `LessonView`, with "Next" renamed "Continue").
- **AI capped or off.** The composer area shows `<CapNotice />`, and questions stay as plain tutor prompts. **Loading:** a skeleton field. **Failure:** the copy from `Tutor.tsx`.
- **Read-only (completed lesson).** Every card shows, there is no composer, and Continue is replaced by children (`CompletedSummary`).

- [ ] **Step 1: Write failing tests:**
  - `renders the welcome, then one section card per reached beat with sources`.
  - `beat question appears as a tutor message after its card`.
  - `first send answers the question: request content is prefixed, bubble is not`.
  - `a later send is a plain ask with beatIndex = step`.
  - `turns stay under the beat they were sent in after Continue`.
  - `capped mid-conversation: pending turn shows failure copy, composer becomes CapNotice, Continue still advances` (Review Focus 5).
  - `no /api/tutor deliver request is ever made`.
- [ ] **Step 2:** Run `npx vitest run tests/studio/feed.test.tsx`. Expected: FAIL.
- [ ] **Step 3:** Implement the feed, cards and composer, with styles in `src/styles/studio.css` following the mockup.
- [ ] **Step 4:** Run `npm test` and `npx tsc --noEmit`. Expected: all pass.
- [ ] **Step 5: Commit and push.** Message: `feat(studio): conversation feed with section cards and tutor composer`.

### Task 5: Bug hunt and code checkpoint use the workspace

**Files:**
- Modify: `src/components/CatchTheBug.tsx` (renamed to `src/studio/BugCard.tsx`), `src/components/Checkpoint.tsx` (the `Code` part)
- Test: `tests/studio/bug-card.test.tsx`, plus updates to the existing checkpoint tests in `tests/components/lesson.test.tsx` and `tests/components/lesson-files.test.tsx`

**Interfaces:**
- Consumes: `useStudio()` (Task 3).
- Produces: `<BugCard lesson ai onSolved />`, which no longer takes `saved`, `onEdit` or `flush`.
- Produces: `Checkpoint` without the `files`, `onEdit` and `flush` props. Its code kind reads `useStudio().files[cp.file]`.

Behaviour:
- **Starting the hunt.** When `BugCard` mounts unsolved, it uses the record's saved copy of `bug.file` if `fileLessons[bug.file] === lesson.id`. Otherwise it calls `replaceFile(bug.file, bug.code)`. Either way it then calls `openFile(bug.file)` and `apply([bug.file])`, so the broken site goes live.
- **Card copy.** The card keeps `BUG_LABEL` and the "Catch the bug" title. It adds the line "Look at the preview on the right, then fix `{file}` there by hand." It has buttons "Check my fix" and "Open {file}", and a checklist of `fixChecks` messages: grey before the first check, then pass or fail.
- **Checks.** They run on `files[bug.file]`. A pass calls `apply([bug.file])`. Misses, hints after 2, the AI note only on a pass, the `codeChecked` dispatch and `onSolved` are all unchanged.
- **Code checkpoint.** Same pattern: a "Edit {file} in the workspace" button, and "Check my code" runs `cp.checks` on the workspace copy. A pass calls `apply([cp.file])`. The R3/R21 help block is unchanged.

- [ ] **Step 1: Write failing tests:**
  - `starting the hunt swaps in bug.code, opens the file and applies it`.
  - `reload mid-hunt restores the saved partial fix, not bug.code` (Review Focus 3).
  - `a passing fix applies the file and marks every check passed`.
  - `code checkpoint checks the workspace copy; two misses offer Keep trying / Review only` (R21).
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3: Implement.** So the app and the suite stay green before Task 6, wrap `LessonView`'s current output in `<StudioProvider lesson={lesson}>` and render `<Workspace />` after `.lesson__read`. Task 6 replaces this temporary arrangement.
- [ ] **Step 4:** Run `npm test` and `npx tsc --noEmit`. Expected: all pass.
- [ ] **Step 5: Commit and push.** Message: `feat(studio): bug hunt and code checkpoint edit in the workspace`.

### Task 6: Studio layout, outline and course bar

**Files:**
- Modify: `src/pages/Lesson.tsx` (rewrite `LessonView` as the studio), `src/app.tsx` (the `Shell`), `src/shared/record.ts`
- Create: `src/studio/Outline.tsx`, `src/studio/CourseBar.tsx`
- Delete: `src/components/BeatView.tsx`, `src/components/Tutor.tsx`, and their now-dead CSS in `src/styles/lesson.css`. Delete or move their tests, keeping every behaviour test that still applies.
- Test: `tests/studio/studio.test.tsx`, plus updates to `tests/components/routing.test.tsx` and `tests/components/shell.test.tsx`

**Interfaces:**
- Consumes: Tasks 3–5.
- Produces: `branchHistory(r: LearningRecord): { from: string; to: string; outcome: Outcome }[]` in `src/shared/record.ts`, read from `branched` statements, oldest first.

Behaviour:
- **Shell.** On `/learn/*`, `Shell` renders `CourseBar` in place of `Header`, and no `Footer`. Other routes are unchanged. The skip link stays and targets the feed.
- **CourseBar** (charcoal, 56px):
  - the wordmark linking to `/`, and `Sticker`
  - "{path.title} · Lesson n of N"
  - a progress meter, `role="progressbar"`, showing completed lessons out of the path's lessons
  - the pane switch, shown at ≤960px, using `aria-pressed`
  - `RecordPanel`, with `SaveWarning` kept visible
- **Outline** (248px):
  - "Course", the path title, and "{N} lessons · about {sum of minutes} min · adaptive"
  - lesson rows marked done (`completedLessons`), current, or skipped (`branchSkippedLessons` and the placement's `skip`, in muted text with "Skipped"), each linking to `/learn/:id`
  - the current lesson expands to its beats (`beat.goal`), then "Catch the bug" (tag Code) if it has a bug, then "Checkpoint" (tag Branch), each marked done, current or upcoming from the step
  - "Your path" lists `branchHistory` as "Lesson n → {outcome}: {target title}", with the empty-state copy "Branches you take appear here."
- **Grid.** `248px minmax(0,1fr) minmax(380px,44%)` with `grid-template-rows: minmax(0,1fr)`, and `min-height: 0` on each pane. The page itself never scrolls; each pane scrolls on its own.
- **Lesson state.** Step, resume, read-only, `next()`, `complete()`, `onResolved` and `onBugSolved` keep their current logic in `LessonView`. Only the render changes: `<StudioProvider><CourseBar/><Outline/><Feed>{post cards}</Feed><Workspace/></StudioProvider>`.

- [ ] **Step 1: Write failing tests:**
  - `/learn/:id renders course bar, outline, feed and workspace; no site footer`.
  - `outline marks done/current/skipped lessons and the current lesson's sections`.
  - `Your path lists branches from the record`.
  - `navigating to the next lesson swaps workspace files and tags new edits with the new lesson id; old edits keep theirs` (Review Focus 4).
  - `pane switch shows one pane at a time below 960px` (set `matchMedia`).
  - `completed lesson opens read-only with CompletedSummary`.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement. Copy the mockup's CSS structure into `src/styles/studio.css` using tokens.
- [ ] **Step 4:** Run `npm test`, `npx tsc --noEmit` and `npm run build`. Expected: all pass, and the build output has a separate Playground chunk.
- [ ] **Step 5: Commit and push.** Message: `feat(studio): three-pane learning studio replaces the lesson page`.

### Task 7: Browser verification and private deploy

**Files:**
- Modify: only what the verification turns up.
- Screenshots: `.superpowers/sdd/2026-10-20-plan-c0-learning-studio/shots/` (gitignored)

- [ ] **Step 1: Verify on desktop.** Run `npm run dev`, then use `agent-browser` at 1440×900. Walk lesson 1 end to end:
  - Playground goes live with the contrast band.
  - Answering a question gets a tutor reply.
  - The bug hunt makes the band and title disappear from the live site.
  - A hand fix brings them back, and the checks tick.
  - The checkpoint branches, and the outline and "Your path" update.
  - Continue loads lesson 2 with its files.

  Screenshot each stage.
- [ ] **Step 2: Verify on a phone.** At 390×844: `document.scrollingElement.scrollWidth === 390` on all three panes, and "Open theme.json" switches to the Workspace pane.
- [ ] **Step 3: Verify accessibility.** Keyboard only: tab through the course bar, outline, feed, composer and workspace. Focus lands on each new section heading. Reduced motion: no animation, and nothing is hidden.
- [ ] **Step 4:** Run `npm test` and `npx tsc --noEmit`. Expected: all pass. Commit any fixes, then push.
- [ ] **Step 5: Deploy privately.** Run `npm run build`, then deploy to the existing private Spacefast space with the same command as Plan A's ledger. Confirm the new version serves `/learn/bt-what-is-a-block-theme` to the signed-in owner and still returns 403 to anonymous requests. Record the version in the ledger.
