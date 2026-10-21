# Plan B: Bring Your Own Agent, Implementation Plan

> Revised 2026-10-20 for the learning-studio world (Plan C0) and the controller's rulings. The original draft was written before the studio redesign. This file is the plan of record for the `plan-b-agent` workstream; `docs/superpowers/plans/2026-10-21-plan-b-agent.md` is the short stream plan the common rules ask for and points here.

**Goal:** A learner can take the course inside the agent they already pay for (Claude, ChatGPT, Claude Code, Cursor, any MCP client). The site serves a remote MCP server over Streamable HTTP, built on Derin's `learning-mcp`. Progress in the agent is real xAPI in a `learning-mcp/record`, kept in a durable, rate-limited anonymous relay. The learner can carry their place from the site into the agent ("Continue in your agent") and bring the agent's progress back into the site record.

**Architecture:**
- **MCP endpoint:** a Spacefast Function at `functions/api/mcp.ts`, so the connector URL is `https://learn-wp-reimagined.space.fast/api/mcp` (ruling R-B1). Stateless. It wraps learning-mcp's `createCourseServer(...).fetch` behind a gate for body size and rate limits.
- **Records:** `D1RecordStore`, a learning-mcp `RecordStore` on `env.DB` (MySQL behind the broker; SQLite in tests and dev). Portable SQL, a `ver` column for compare-and-set, 30-day inactivity expiry enforced on read plus a daily cron sweep. Only the SHA-256 of a handle is stored.
- **Content:** the site's own `ContentBundle` is converted to a learning-mcp `Course` at runtime (memoised, validated with `parseCourse`), so new paths from other workstreams flow through with no second generated file (ruling R-B3).
- **Two record formats, converted at the edges:** the site keeps `learn-wp-reimagined/record` v1; the agent side uses `learning-mcp/record` v1. A handoff endpoint seeds an MCP record at the learner's lesson with their files. A pure importer turns an MCP record into site `RecordEvent`s applied through the site's own `applyEvent`, with conflicts shown for confirmation.

**Tech stack additions:** `@modelcontextprotocol/server` 2.3.1 (Apache-2.0, published 2026-10-05), `@modelcontextprotocol/client` 2.3.1 as a dev dependency, and a vendored copy of learning-mcp `packages/core` and `packages/server/src/server.ts`.

**Spec:** `docs/superpowers/specs/2026-10-19-learn-wp-reimagined-design.md` §3 (Bring your own agent), §3a (Learning record), §8 (MCP server design). learning-mcp `RULES.md`, `rules/AGENT_RULES.md`, `docs/STATUS.md`.

**Not in scope:** unifying the two record formats; settling the IRI namespace (learning-mcp open question 1); accounts; making the space public; deploying (the controller deploys).

## Rulings

Controller rulings on Derin's open questions:

- **R-a. Upstream edits are allowed.** learning-mcp is changed on a branch `plan-b-fixes` (never its `main`), with tests, and the branch is pushed. The site vendors from that branch's commit. The work is done in a scratch clone so Derin's own checkout is untouched.
- **R-b. Vendor, don't depend.** learning-mcp's packages are copied into `vendor/learning-mcp/` by `scripts/vendor-learning-mcp.ts`, with `VENDORED.json` recording the repo, the source commit, the file list and the one transform applied. The licence notice travels with it (`vendor/learning-mcp/LICENSE`, `vendor/learning-mcp/README.md`). No `github:` dependency, no submodule (both break for a private npm-workspaces monorepo and for future public clones).
- **R-c. Branch `when` text reuses `judgePrompt`'s wording** from `functions/_lib/prompts.ts`: advance "The answer meets the rubric.", review "The learner should revisit the material.", skip "The answer clearly shows mastery beyond the lesson." A test pins that the strings still appear in `judgePrompt`'s output, so the two can't drift.
- **R-d. Rate limits: per handle plus a global MCP ceiling,** with `functions/_lib/ratelimit.ts` and namespaced keys `mcp:g` (global), `mcp:new` (record creation) and `mcp:h:<32 hex of the handle hash>`. They never share a bucket with the AI keys (`g:global`, `c:…`, `ip:…`, `anon`).
- **R-e. Licence.** Bundling the Apache-2.0 SDK into the function makes the shipped `/api/mcp` bundle effectively GPLv3. The repo is GPL-2.0-or-later, so this is allowed. It is recorded in `vendor/learning-mcp/README.md` and flagged for Derin.

Builder's rulings (each with its cost if wrong):

- **R-B1. The endpoint is `/api/mcp`, not `/mcp`.** `/api/*` is the only function prefix proven live on this space (Plan A Task 15), `scripts/assemble.ts` and `dev/apiPlugin.ts` already route it, and the SPA fallback in `sf.jsonc` would otherwise risk swallowing `/mcp`. *Cost if wrong:* a slightly less tidy URL; adding a top-level `/mcp` later is one file plus an assemble change.
- **R-B2. Vendored `server.ts` imports core by relative path.** The vendor script rewrites `from '@learning-mcp/core'` to `from '../core/index.ts'`, so no alias is needed in vite, vitest, esbuild or tsconfig. *Cost if wrong:* none at runtime; the transform is recorded in `VENDORED.json` and re-applied on every re-vendor.
- **R-B3. Runtime conversion instead of a generated `course.json`.** `getCourse()` converts `getContent()` once per isolate and validates it with `parseCourse`; a test over the real content and a check in `assemble.ts` fail the build if conversion breaks. *Cost if wrong:* a few milliseconds of zod parsing on a cold start.
- **R-B4. esbuild resolves with `conditions: ['workerd', 'worker', 'browser']`.** Otherwise the SDK's `_shims` export resolves to its Node shim, which imports `node:process` and Ajv. Applied to every route bundle, which only affects packages that publish those conditions (today only the SDK). *Cost if wrong:* a route bundle picking a browser build of some future dependency; the assemble test checks every bundle has no `node:` import.
- **R-B5. Store errors become actionable tool errors upstream.** learning-mcp gains `StoreError` (with a public message) and `StoreConflictError extends StoreError`. `createCourseServer` turns a `StoreError` into a tool error with its public message, and any other store failure into "the record store is unavailable right now; try again shortly", never echoing the inner message. *Cost if wrong:* low; the change is additive.
- **R-B6. Nested file names upstream.** learning-mcp's `fileName` accepts relative POSIX paths (`templates/index.html`) and rejects empty, `.` and `..` segments, a leading `/` and backslashes. *Cost if wrong:* low; IRIs already percent-encode each segment.
- **R-B7. A stored record is capped at 2,000,000 characters.** A put over the cap throws `StoreError("this record has reached its size limit; export it with get_record to keep it")`. With 120 calls per handle per 10 minutes a looping agent could otherwise grow one row without bound. *Cost if wrong:* a very long-running learner hits the cap; they keep their export.
- **R-B8. The handoff seeds placement and files only.** The seeded MCP record gets a `placed` statement (reason "Continued from the Learn WordPress, reimagined site.") and the learner's files for that path; the site's own statements stay in the site record. *Cost if wrong:* the agent record doesn't show earlier site progress; the site record still does, and import merges back.
- **R-B9. Trust on import.** The site record is learner-owned and local-only; nothing on the server trusts it. So an imported agent record gets the same trust as "Restore record": learning-mcp `parseRecord` validates it, only known lessons and the path's starter-file names are mapped, file sizes are capped, conflicts need a tick, and the result must pass the site's `parseRecord` before `restore`. Code checks that count are the ones the MCP server ran itself (`check_code`, `submit_checkpoint`), never a pass claimed by the agent. *Cost if wrong:* a hand-forged JSON could mark lessons done in the learner's own browser, which "Restore record" already allows.
- **R-B10. The handle is never stored by the site.** It is shown once in the handoff panel with a Copy button. The import field takes it pasted. *Cost if wrong:* the learner has to keep the handle themselves (which the agent rules already tell the agent to give them).
- **R-B11. Frontend touches stay small** because two other workstreams are changing `src/studio/*` and adding paths and a Proposal page. "Continue in your agent" and "Bring back your agent's progress" both live in the existing `RecordPanel` menu (which the CourseBar and the site header already render). The only other UI is the new `/connect` page and one `Route` line in `src/app.tsx`. `src/studio/*` is not touched.
- **R-B12. Allowed origins.** `createCourseServer` gets `allowedOrigins: [XAPI_BASE]`. Server-side clients (Claude.ai and ChatGPT connect from their clouds, Claude Code and Cursor from a local process) send no `Origin`, so they pass; a browser page on another origin gets 403 (RULES §1.2).

## Global Constraints

- **Repos and git.** Site: this worktree, branch only; push with `git push -u origin HEAD`, never `main`. learning-mcp: a scratch clone at `$SCRATCH/lmcp`, branch `plan-b-fixes`, pushed to `github.com/derintolu/learning-mcp`; never its `main`. Every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **No deploy, nothing public.** Never `sf publish`, never `sf share grant --to public`, no share links. Task 10 writes the readiness checklist only.
- **Backend patterns.** Routes live under `functions/api/*`, export `Handler`s, and use `functions/_lib/{http,guards,db,ratelimit}`. Portable SQL only: `CREATE TABLE IF NOT EXISTS`, `VARCHAR`/`BIGINT`/`INT`/`MEDIUMTEXT`, no upsert syntax; only duplicate-key errors are tolerated (`isDuplicateKey`).
- **No AI on the MCP path.** `/api/mcp`, `/api/agent/*` and `/api/mcp-sweep` never import `functions/_lib/{ai,budget,prompts}.ts` or `functions/_lib/providers/*`, and make no outbound `fetch`. They keep working at the spending cap. (The `BRANCH_WHEN` copy is a constant; its test imports `judgePrompt`, the runtime does not.)
- **Handles are bearer secrets.** Never logged, never in a statement, never in a URL, never in an error message. Only `SHA-256(handle)` is stored. Rate-limited per handle. 30-day expiry and a delete path (`delete_record` and the site's "Delete the agent's copy").
- **Validate everything an agent sends.** learning-mcp validates tool input and runs checks on the server; the gate caps bodies at 1 MiB; handoff input is capped at 256 KB and filtered to the path's starter-file names.
- **Teaching rules and xAPI.** learning-mcp builds every MCP statement and owns its rules. Site statements are only ever produced by the site's `applyEvent`. No new site `RecordEvent` types; `parseRecord` still accepts every old record.
- **UI.** Brand tokens from `src/styles/tokens.css`; EB Garamond and Inter; no logos for client names; no emojis; WCAG 2.2 AA; respects `prefers-reduced-motion`; no horizontal scroll at 390px. Browser checks with `agent-browser --session plan-b-agent` on port 5175 only.

## Review Focus

1. **Two tool calls on one handle at once.** One write wins; the other gets "the record was changed by another call at the same time; call this tool again". No statement is lost or duplicated. *Tests: Task 4 (store), Task 5 (over MCP).*
2. **A pasted record that disagrees with the site** (other position, differing file, other course, newer format, another learner, lessons that no longer exist). Nothing changes without a tick, unknown parts are listed, the result passes the site's `parseRecord`. *Test: Task 7.*
3. **A flood or an oversized body** (a 4 MB `link_record`, a `start_placement` loop, one handle hammered). 413/429 as JSON-RPC errors, the global ceiling holds, the AI buckets are untouched. *Test: Task 5.*
4. **An expired, deleted, malformed or mistyped handle.** A clear message saying what to do; no record created or changed; an expired row is deleted. *Tests: Tasks 4 and 6.*
5. **The spending cap is reached or no AI is configured.** The connector and handoff still work with zero outbound requests. *Test: Task 5.*

---

## File structure

```
vendor/learning-mcp/                 core/*.ts, server/server.ts, LICENSE, README.md (licence notice), VENDORED.json
scripts/vendor-learning-mcp.ts       copies a pinned learning-mcp commit into vendor/ (git archive)
scripts/verify-mcp.ts                SDK client check against a URL (headers from a file, never printed)
src/shared/course-meta.ts            COURSE_ID, COURSE_ACTIVITY_BASE, MCP_URL, BRANCH_WHEN, BRANCH_SUCCESS, agentPrompt()
src/agent/client.ts                  startHandoff, fetchAgentRecord, deleteAgentRecord
src/agent/importRecord.ts            classifyPaste, planImport, applyImport (pure)
src/agent/clients.ts                 CLIENT_SETUPS
src/components/AgentHandoff.tsx      "Continue in your agent" panel content
src/components/ImportAgentProgress.tsx
src/pages/Connect.tsx                /connect
functions/api/mcp.ts                 POST/GET/DELETE /api/mcp
functions/_lib/mcp/{course,recordStore,gate,seed}.ts
functions/api/agent/{handoff,record,delete}.ts
functions/api/mcp-sweep.ts           cron target, Bearer CRON_SECRET
tests/helpers/mcpClient.ts           SDK client wired to a handler
```

Modified: `package.json`, `scripts/assemble.ts` (esbuild conditions, course check), `functions/_lib/env.ts` (`CRON_SECRET?`), `sf.jsonc` (`crons`), `src/config.ts` (`FEATURES.agent = true`), `src/app.tsx` (one route), `src/components/RecordPanel.tsx` (two menu entries), `src/styles/components.css`, and the tests that pin the Home and CapNotice copy.

---

### Task 1: Spike: learning-mcp inside a Spacefast Function

- Vendor learning-mcp `48e3271` with `vendorLearningMcp(srcRepo, commit, outDir)` (`git archive`; refuses an unknown commit; writes `VENDORED.json`; rewrites the core import per R-B2; adds a one-line provenance header to each file).
- Add the SDK packages (exact versions). Add `conditions` to `bundleFunctions` (R-B4).
- Spike `functions/api/mcp.ts`: serves the vendored example course from a `MemoryStore` at `endpoint: '/api/mcp'`.
- `tests/helpers/mcpClient.ts`: `connectMcp(fetchFn, era)` (legacy, or modern pinned to `2026-07-28`, after learning-mcp's `packages/server/test/helpers.ts`) and `mcpFetch(env)`.
- `scripts/verify-mcp.ts <url> [legacy|modern]`: headers from `$MCP_HEADERS_FILE`, prints only the server name and tool names.
- **Tests:** `tests/functions/mcp-spike.test.ts` lists exactly the 11 tools in both eras, and `GET` gives 405. `tests/scripts/assemble.test.ts` bundles `mcp.ts` under `BUNDLE_LIMIT` with no `node:` import, no `import`/`require(` line, and exports `POST`, `GET`, `DELETE`.
- **Local HTTP check:** `npm run dev -- --port 5175 --strictPort`, then `verify-mcp.ts http://localhost:5175/api/mcp` in both eras. The live private spike from the draft moves to the readiness checklist (no deploys in this stream).

### Task 2: Upstream learning-mcp fixes (branch `plan-b-fixes`)

- `packages/core/src/schema.ts`: nested `fileName` (R-B6).
- `packages/core/src/store.ts`: `StoreError`, `StoreConflictError` (R-B5).
- `packages/server/src/server.ts`: every `store.get`/`put`/`delete` failure becomes a tool error and the record is unchanged (`withRecord`, `start_placement`, `link_record`, `get_record`, `delete_record`).
- **Tests:** `schema.test.ts` accepts `templates/index.html`, `parts/header.html`; rejects `../x`, `/x`, `a//b`, `a\\b`, `./x`, `x/`. A check on `templates/index.html` runs and its activity IRI contains `templates%2Findex.html`. `server.test.ts`, both eras: a `StoreConflictError` on put gives that exact text and `get_record` shows the record unchanged; a store throwing `Error('secret detail')` gives the unavailable text without the detail; a `StoreError` passes its public message through.
- `npm test` and `npm run typecheck` green in learning-mcp; commit and push the branch; re-vendor in the site.

### Task 3: Course conversion

- `src/shared/course-meta.ts`: `COURSE_ID = 'learn-wp-reimagined'`, `COURSE_VERSION = '0.1.0'`, `COURSE_ACTIVITY_BASE = ${XAPI_BASE}/course`, `MCP_URL = ${XAPI_BASE}/api/mcp`, `BRANCH_SUCCESS` (advance and skip true, review false), `BRANCH_WHEN` (R-c), and `agentPrompt(handle)`: ``Continue my "Learn WordPress, reimagined" course with the learn-wp-reimagined tools. My record handle is ${handle}. Call start_placement with that handle, then next_beat. Keep the handle private.``
- `functions/_lib/mcp/course.ts`: `toCourse(bundle)`, `buildCourse(bundle)` (throws `course: <errors joined by '; '>`), `getCourse()` memoised over `getContent()`, `setCourseForTests()`. Course fields: title "Learn WordPress, reimagined", a one-sentence description, `language: 'en'`, `license: 'CC BY-SA 4.0'`, a placement intro with `maxQuestions: 4`, and three course rules (adapted from Learn WordPress and not reviewed by the Training Team, so say so and link the sources; when unsure say so and point to the sources; the learner edits files by hand, so never write a whole file for them). Paths drop `finalFiles` and `previewFiles`; lessons drop `checkpoint.fallback`; each branch becomes `{ id: outcome, when, success, to, message }`.
- **Tests:** the real content converts and passes `parseCourse`; outcome to id and success; dropped fields; `starterFiles`, `bug` and `checks` kept byte for byte; coming-soon paths with no lessons kept; an invalid bundle throws naming `branches`; `BRANCH_WHEN` strings appear in `judgePrompt` output (R-c); over `connectMcp`, `get_lesson` never returns the bug's explanation.

### Task 4: `D1RecordStore` on `env.DB`

- `ensureMcpSchema(db)`: `mcp_records (h VARCHAR(64) PRIMARY KEY, body MEDIUMTEXT NOT NULL, ver INT NOT NULL, touched BIGINT NOT NULL)`.
- `handleKey(handle)`: SHA-256 hex via `crypto.subtle`.
- `D1RecordStore(db, now, ttlMs)`, made per request, remembers the `ver` it read per handle. `get`: missing gives `undefined`; older than the TTL is deleted (`WHERE h = ? AND ver = ?`) and gives `undefined`; an unparseable body gives `undefined` and logs `mcp record unreadable` with no handle or hash; otherwise refreshes `touched` at most hourly without changing `ver`. `put`: with a known `ver`, a conditional `UPDATE … WHERE h = ? AND ver = ?` (`changes !== 1` throws `StoreConflictError`); without one, `INSERT` (duplicate key throws `StoreConflictError`); over the size cap throws `StoreError` (R-B7). `delete`: `changes === 1`.
- `sweepExpired(db, now, ttlMs)` and `GET /api/mcp-sweep`: 503 without `CRON_SECRET`, 401 unless `authorization: Bearer <CRON_SECRET>` (constant-time compare), else `{ deleted }`. `sf.jsonc` gains `"crons": [{ "path": "/api/mcp-sweep", "schedule": "daily" }]` (Spacefast config docs: crons send nothing by themselves; declare `CRON_SECRET` and check the bearer header).
- **Tests (SQLite D1):** round trip, stored key is the hash, body never contains the handle; stale writer conflicts and the first write stands; two inserts of one new handle, exactly one wins; several puts in one request succeed; expiry at +30 d +1 ms deletes the row, +29 d refreshes `touched`; corrupt body logs no handle; size cap; sweep deletes only stale rows; delete true then false; no upsert syntax in the module; sweep route 401/401/503/200.

### Task 5: The real `/api/mcp` endpoint

- `functions/_lib/mcp/gate.ts`: `MCP_LIMITS = { bodyBytes: 1_048_576, global: 1200 per 10 min, perHandle: 120 per 10 min, create: 60 per 10 min }`, the keys from R-d, `inspectMcpBody(text)` (handles from `tools/call` arguments; `link_record` and handle-less `start_placement` count as creates; invalid JSON gives nothing and the SDK answers with its parse error), and `gateMcp(req, env, now)` giving 413 or 429 as JSON-RPC error bodies, then a rebuilt request.
- `handleMcp(req, env, deps?)`: `ensureSchema`, `ensureMcpSchema`, `gateMcp`, then `createCourseServer({ course: getCourse(), store, endpoint: '/api/mcp', allowedOrigins: [XAPI_BASE] }).fetch(req)`.
- **Tests:** lesson 1 end to end over the SDK client in both eras with a new handler per call (placement, beats with replies, the planted bug in `theme.json` caught, the checkpoint, `advance`, cursor at lesson 2); an invented branch is refused listing `advance, review, skip`; a failed code check allows only `review`; two simultaneous `next_beat` calls on one handle (barrier store): one succeeds, the other is the retry error, one new `experienced` statement; a disallowed Origin gets 403; a body over 1 MiB gets 413; the 121st call on one handle gets 429 and another handle still works; the 61st creation gets 429; after 50 calls every `hits` key starts with `mcp:`; `inspectMcpBody` handles batches and invalid JSON; no outbound `fetch`; works with `spend` at the month cap; an esbuild metafile of the MCP routes has no AI module.

### Task 6: Handoff, record and delete endpoints

- `functions/_lib/mcp/seed.ts`: `seedRecord(course, lessonId, files, ctx)` per R-B8; keeps only names in the path's `starterFiles`, each at most `LIMITS.file`, at most `LIMITS.files`.
- `POST /api/agent/handoff` `{ lessonId, files? }` (256 KB cap; `mcp:g` and `mcp:new` limits) gives `{ handle, mcpUrl, prompt }`; unknown or not-live lesson gives 400 and creates no row.
- `POST /api/agent/record` `{ handle }` (per-handle limit) gives `{ record }`; malformed: 400 "That doesn't look like a record handle. It starts with lr_."; unknown or expired: 404 "No record for that handle. It may have expired after 30 days without use, or been deleted."
- `POST /api/agent/delete` `{ handle }` gives `{ deleted }`.
- `src/agent/client.ts` with the 20 s JSON timeout (R27): `startHandoff`, `fetchAgentRecord`, `deleteAgentRecord`, each `{ ok: true, … } | { ok: false, message }`; a timeout gives "The connector didn't answer. Try again in a moment."
- **Tests:** a handoff seeds a record that continues at that lesson over MCP; starter files kept, others and oversized dropped; 400 with no row; record returns what the agent wrote and passes learning-mcp `parseRecord`; exact 400/404 messages; delete then `{ deleted: false }`; the 61st handoff gets 429; no handle in any `console.*` output; client maps 404/429/timeout.

### Task 7: `planImport` and `applyImport`

- `classifyPaste(text)`: a handle, JSON, or invalid with "Paste a record handle (it starts with lr_) or the exported JSON."
- `planImport(site, raw, content)` gives `{ events, conflicts, ignored, summary }` or the learning-mcp `parseRecord` error, or "This record has no progress in this course yet."
- Mapping, in statement order: `answered` on a checkpoint remembers the response; `branched` with `advance`/`review`/`skip` emits `checkpointAnswered` with the authored `to` (skipped, with an ignored line, when the site already answered that checkpoint); `passed`/`failed` on a file emits `codeChecked` unless the site already has a statement on that file activity; `experienced`, beat `answered`, `caught`, `placed` and path `completed` are counted as ignored; then `completedLessons` missing on the site emit `lessonCompleted`; agent files that are starter files of the path emit `fileEdited` (new) or a `file:<name>` conflict (different); placement emits `placed` or a `placement` conflict; a cursor not `done` emits `beatViewed` (no site position) or a `position` conflict. Other courses and unknown lessons are listed as ignored.
- `applyImport(site, plan, accepted, content)` applies events, then accepted conflicts, restores `current`/`placement` unless accepted, and throws if the result fails the site's `parseRecord`.
- **Tests** (MCP records made by driving learning-mcp's `session.ts` on the converted course): fresh import; no duplicate checkpoint; conflicts not applied unless ticked; accepted conflicts applied; ignored list; rejects a site record, a newer version and another learner's statement with the parser's message and never mutates the input; the result passes `parseRecord` and the site statements are an unchanged prefix; `classifyPaste` cases.

### Task 8: The `/connect` page

- `src/agent/clients.ts`: `CLIENT_SETUPS` for Claude, ChatGPT, Claude Code, Cursor and "Any MCP client" (plain text names, `docsUrl` each, the Claude Code snippet exactly `claude mcp add --transport http learn-wp-reimagined ${MCP_URL}`, the Cursor `mcp.json` snippet, "no authentication" for Claude and ChatGPT). Steps are written from the vendors' documented flows as of this date and are re-checked on launch day (readiness checklist).
- `src/pages/Connect.tsx`: heading "Connect your *agent*"; the connector URL with Copy; one section per client; a "Continue where you left off" note pointing to "Your record"; a "Bring your agent's progress back" section rendering `ImportAgentProgress`.
- `ImportAgentProgress`: textarea "Record handle or exported JSON", "Check it", a summary, the ignored list in a disclosure, one unticked "Use the agent's version" checkbox per conflict (files show the first 3 differing lines), "Bring it back" (`restore(applyImport(…))`, then "Your agent's progress is on the site now."), and for handle input only "Delete the agent's copy" with a confirmation. Privacy copy: "The handle is the only key to your agent's copy. It holds no personal data and expires after 30 days without use."
- **Tests:** five clients as text with no images; exact Claude Code command; Copy writes `MCP_URL`; a position conflict leaves the position unless ticked; handle import shows the 404 message; invalid paste message; delete asks first; every control has a label.

### Task 9: "Continue in your agent" and `FEATURES.agent = true`

- `RecordPanel` gains two entries (R-B11), shown when `FEATURES.agent` is on: "Continue in your agent" (only when there is a lesson: the open `/learn/:id` route, else `record.current`) and "Bring back your agent's progress". Each opens a sub-view inside the existing dialog (`AgentHandoff`, `ImportAgentProgress`) with a Back button.
- `AgentHandoff`: calls `startHandoff(lessonId, record.files)` and shows the connector URL, the handle and the prompt with Copy buttons, "Keep this handle private. It's the key to your progress in the agent.", and "Set up your agent" linking `/connect`. Failure copy: "Couldn't create a handle right now. You can still connect your agent from the Connect page."
- Flip `FEATURES.agent`; the Home MCP band and `CapNotice` copy tests are updated to present tense and the `/connect` link.
- **Tests:** handoff with the lesson id and files, then URL, handle and exact prompt; failure copy and link; Escape still closes the dialog and returns focus; Home band and CapNotice link.
- **Browser round trip** (agent-browser, 1440×900 and 390×844, port 5175): open lesson 3, "Continue in your agent", copy the handle to a scratch file without printing it, continue over `verify-mcp.ts --handle-file`, export with `get_record`, import on `/connect`.

### Task 10: Private-deploy readiness checklist (written, not executed)

A checklist for the controller in the stream report, covering: `CRON_SECRET` set as a secret; `npm run build` lists `dist/functions/api/mcp.js`, `api/agent/*.js` and `api/mcp-sweep.js` under 8 MiB; private publish and `sf runtime status`/`sf crons ls`; a non-browser access method for the private space (machine audience or handoff cookie) with headers in a 0600 scratch file; `verify-mcp.ts` both eras live; Inspector CLI; Claude Code with `--header`; the live handoff round trip; `sf crons run` with the bearer header; logs show no `lr_` string; `sf share check --as public` gives `none`. Then the launch-day items: decide the IRI namespace; confirm the GPLv3 note; make the space public; **test the Claude.ai, ChatGPT and Cursor connectors once public**; recheck `/connect` against vendor docs; review `MCP_LIMITS` against the first day's `hits`.
