# Learn WordPress Reimagined on Sensei, course-xapi-mcp and Learning Ledger: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the live prototype so Sensei on Space A holds courses and learners, the course server in Spacefast Functions is the only writer of an official xAPI record held by Learning Ledger on a separate LRS space at `lrs.sqwrlz.com`, and agents connect through the standard's reference server with MCP authorization, without the studio looking, feeling or performing any differently.

**Architecture:** Nine phases (0 to 8), each shipped to the live site behind a flag and each leaving the site working. Phases 0 to 2 touch only this repo and Spacefast. Phase 3 onward consume named deliverables of the course-xapi-mcp standard and the Learning Ledger plugin, each behind an explicit gate (G1 to G6). One write path for learning facts: studio or agent → `/api/events` (the course server decides) → LRS → connector → Sensei.

**Tech Stack:** Preact 11 + preact-iso + Vite 8 (studio), Spacefast Functions with D1-shaped `env.DB` (course server), vitest 5 + happy-dom + `dev/sqliteD1.ts` (tests), esbuild bundling via `scripts/assemble.ts`, WebCrypto Ed25519 (signing), fflate (ZIP), the vendored course-xapi-mcp reference packages (`core`, `validator`, `server`), WordPress 7.1.x with Sensei LMS 4.26.4, Sensei LMS Certificates 2.6.0 and Learning Ledger (installed via Spacefast WP-CLI), the agent-browser CLI (browser checks).

**Spec:** `docs/superpowers/specs/2026-10-27-sensei-backend-prototype-design.md` (the design; section numbers below like "§7.2" refer to it). Still binding for look, audience and constraints: `docs/superpowers/specs/2026-10-19-learn-wp-reimagined-design.md`. Owner decisions and cross-design rulings: `/private/tmp/claude-501/-Users-cedarstone-Projects-learn-wp-reimagined/5376001d-2862-4ef6-85e3-26e5bd4cbe50/scratchpad/designs/decisions.md` and `/private/tmp/claude-501/-Users-cedarstone-Projects-learn-wp-reimagined/5376001d-2862-4ef6-85e3-26e5bd4cbe50/scratchpad/designs/reconciliation.md`. Companions: the standard (`/Users/cedarstone/Projects/learning-mcp/docs/superpowers/specs/2026-10-27-course-xapi-mcp-design.md`) and Learning Ledger (`/private/tmp/claude-501/-Users-cedarstone-Projects-learn-wp-reimagined/5376001d-2862-4ef6-85e3-26e5bd4cbe50/scratchpad/designs/2026-10-27-wordpress-lrs-plugin-design.md`). Spacefast facts: `/private/tmp/claude-501/-Users-cedarstone-Projects-learn-wp-reimagined/5376001d-2862-4ef6-85e3-26e5bd4cbe50/scratchpad/spacefast-platform.md` and `/private/tmp/claude-501/-Users-cedarstone-Projects-learn-wp-reimagined/5376001d-2862-4ef6-85e3-26e5bd4cbe50/scratchpad/sf-spike/` (docs, `sfapi.sh`, `s2/wp.sh`).

## Global Constraints

- Git: commit to `main` and push to `origin/main` immediately after every commit (`git push origin main`); never batch pushes. Never push to `production` unless Derin says so; never create a local `production` branch. Stage named files only (never `git add .`; untracked `.DS_Store` files exist and must never be committed). Every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Any `docs/*.md` file (including `docs/spikes/*.md`, `docs/page-copy-draft.md`, accuracy docs) is shown to Derin as a complete diff and committed only after approval. This plan itself is not committed by the planner.
- Browser checks use the agent-browser CLI only. Never Puppeteer or Playwright, never Chrome driven by hand (`--headless --screenshot`, DevTools Protocol). Every subagent prompt involving a browser must say so verbatim.
- AI spend: $100/month hard cap and $10/day sub-cap across all providers, unchanged (`functions/_lib/budget.ts`). The new plumbing adds no inference; the MCP path runs no inference on our account.
- Accessibility: WCAG 2.2 AA, full keyboard use, `prefers-reduced-motion` respected, no horizontal scroll at 390px. Applies to every new panel and page: "What Sensei sees", badges, consent, claim, delete, carry-over, the backend-view banner, and the LRS pages.
- Look (original spec §6): EB Garamond and Inter, charcoal bands, WP blue `#3858E9` and `#9FB1FF`, the "unofficial concept" sticker, no WordPress "W" logo anywhere. The backend-view banner and LRS pages use the same tokens (`src/styles/tokens.css`).
- No emojis in code, copy, commits or docs.
- Secrets never cross WP-CLI: only public keys and SHA-256 hashes appear in WP-CLI arguments. No `wp config set` of a secret, ever. Secrets live in `.env.server` (gitignored, synced to Spacefast secrets on publish) and are never printed by scripts.
- Never modify WPO365, or any existing OAuth/SSO plugin settings. The MCP authorization server in phase 7 is our own Functions code (owner answer 5).
- Any step that creates or changes a Spacefast space, its WordPress, DNS, secrets, or anything public (including `sf publish` to the live space) is a **controller step, needs owner**. Subagents write and test code only.
- Studio speed budget (§12): after each phase, lesson open and beat advance no slower than baseline + 10%, first checkpoint result no slower than baseline + 300 ms, at 1440x900 and 390x844 (baseline from Task 8).
- Flags: each phase's behaviour sits behind a constant in `src/config.ts` (`FEATURES`) and/or `functions/_lib/config.ts` (`SERVER_FLAGS`). Rollback = set it to `false` and republish. Pages describe a behaviour only in the phase that ships it.
- Portable SQL only (runs on SQLite in tests and MySQL via the broker): no upsert syntax, `CREATE TABLE IF NOT EXISTS`, duplicate-key detection via `isDuplicateKey` in `functions/_lib/db.ts`.
- Licences: prototype code GPL-2.0-or-later; vendored standard code Apache-2.0 with `VENDORED.json`; content CC BY-SA 4.0 (`content/LICENSE` stays with the snapshot).
- Test command for a single file: `npx vitest run <path>` (the `pretest` content build runs only with `npm test`). Full suite before every commit that touches shared code: `npm test`.

## Review Focus

1. **The same event arrives twice** (double-click, a retry after a timeout, the 30 s beat flush racing a `pagehide` beacon). Expected: exactly one set of statements; statement ids derive from the client `eventId`, so the LRS PUT is idempotent. Test added in Task 5 (`same eventId twice yields identical statement ids`) and Task 30 (`re-enqueueing a statement id is a no-op`).
2. **A forged or replayed outcome** (the browser posts `checkpointAnswered` with `outcome: 'skip'` and no `decisionId`, someone else's `decisionId`, a used one, or one for another lesson). Expected: accepted only as a learner-chosen fallback if that outcome is one of the authored fallback options, and recorded as learner-chosen; otherwise rejected. Test added in Task 5.
3. **A batch mentions a lesson that no longer exists or was moved to draft in wp-admin.** Expected: that event alone fails with `unknown-lesson`; the rest of the batch is recorded; the studio keeps its local copy. Test added in Task 5 (`one unknown lesson does not sink the batch`).
4. **The session cookie is missing, expired, tampered with, or session creation is rate-limited or the connector is down.** Expected: the studio keeps working exactly as before a session exists, nothing is recorded officially, the bad cookie is cleared, and creation is retried at the next recorded action. Tests added in Task 11 and Task 25.
5. **The studio and an agent write the files State document at the same time, or files exceed 2 MB.** Expected: no lost write (ETag `If-Match`, refetch and merge newest-per-file on 412) and a plain message on the size limit while local editing keeps working. Tests added in Task 35.

---

## Gates (dependencies on the other two plans)

A gate is passed when the controller has confirmed the named deliverable exists at a tagged commit or release, and recorded the tag in the task that consumes it.

- **G0 (phase 0 results):** `docs/spikes/2026-10-phase0-results.md` approved by Derin. Any "no" amends the design before dependent tasks start. Task 3 needs probe 1's answer; Task 30 needs probe 9; Task 43 needs probe 3; Task 50 needs probe 4; Task 48 needs probes 5 and 7.
- **G1 (phase 3):** Learning Ledger release with P1 (Sensei integration blocks `learning-ledger/beat`, `/checkpoint`, `/rubric`, `/planted-bug`, lesson and course fields, stable key meta, program post type), P2 (package export, both flavours, ETag, content-changed ping to a configured URL), P3 (idempotent import by URL via `wp learning-ledger package import`), P8 (WP-CLI-only config, `connector trust-key`, `GET learning-ledger/v1/status`), and the signed `GET learning-ledger/v1/course-server/packages/{program}` route, plus a published Ed25519 request-signature test vector. The standard's reference `core` package reader and types for the package format (S1, S6) and the `validator` (S5) at a tag, with the namespaced-extension rule.
- **G2 (phase 4):** Learning Ledger P4 learner routes: `POST course-server/learners`, `POST course-server/learners/{id}/enrolments`, `GET course-server/learners/{id}/progress` (incl. tested-out), `DELETE course-server/learners/{id}`, the `create_learners` capability and its WP-CLI grant command.
- **G3 (phase 5):** Learning Ledger P6 LRS role (Statements with voiding, State 2 MB, Agent Profile, About; `PUT learning-ledger/v1/courses`; `client create --secret-sha256 --scopes`; `actors/erase`; `view-links`; NDJSON export per actor) and the standard's `core` statement builder (S2: cmi5 defined + allowed statements, `{au@id}/au`, `waived` with Tested Out and Administrative + carried-over, learner-chosen marker) and option-2 LRS client contract (S3: registration storage, State ids for files and resume). Owner answer 13: course-xapi-mcp is public and its IRIs under `https://course-xapi-mcp.sqwrlz.com/` resolve.
- **G4 (phase 6):** Learning Ledger P5 apply rules (moveOn met → complete; waived → complete + tested-out; echo guard; direction 2 per-course and off), LRS → connector signed notifications with `shutdown` processing, subscriptions, the `since` catch-up poll, `connector connect`; and an `actors/erase` option that leaves claimed badges valid (needed by the 180-day retention rule, §6.3).
- **G5 (phase 7):** The standard's reference `server` package with record option 2 (S3), a pluggable course source and MCP authorization hooks (S4: host maps a token to actor + registration), `get_badges` returning metadata and the claim-page URL (S7), the content split with `reveal_bug` (S8), `restart_course`, stateless Streamable HTTP, extension id `com.sqwrlz/course-xapi-mcp`.
- **G6 (phase 8):** Learning Ledger P7 badges (issuer `did:web:lrs.sqwrlz.com`, configurable issuer name, achievements from imported declarations, satisfaction recomputed before signing, `POST badges/{badge}/claim-links`, claim page, public badge page, status list, revoke on erase) and the P4 certificate route (`GET` a learner's Sensei certificate PDF for a course).

Not in this plan: the "Keep my progress" email magic link (owner answer 1 says "later"), the cmi5 player demo of custody option 1, and the relay carry-back flow unless Task 47 finds real relay users.

## Waves

Tasks in one wave touch disjoint files and can run in parallel. "C" marks a controller step that needs Derin.

- Wave 1 (now): 1, 4, 7, 8, 9
- C: 2 → G0
- Wave 2: 3, 5, 6
- C: 10
- Wave 3: 11, 12
- C: 13 → wait for G1
- Wave 4: 14, 16, 18, 22, 23
- Wave 5: 15, 19, 21
- Wave 6: 17, 20
- C: 24 → wait for G2
- Wave 7: 25, 26
- C: 27 → wait for G3; C: 28
- Wave 8: 29
- Wave 9: 30, 31
- Wave 10: 32
- C: 33 → wait for G4
- Wave 11: 34, 35, 38, 40, 41
- Wave 12: 36, 37, 39
- C: 42 → wait for G5
- Wave 13: 43, 44, 45, 46
- C: 47 → wait for G6; C: 48
- Wave 14: 49, 50, 51
- Wave 15: 52
- C: 53

## File map (new or reshaped)

| Path | Responsibility |
| --- | --- |
| `spikes/phase0/` | Throwaway spike site, spike plugin and probe runner (never bundled into `dist/`) |
| `src/pages/appRoutes.ts` | The app's route list, shared by `src/app.tsx` and the `sf.jsonc` rewrite test |
| `src/shared/statements.ts` | Phase 1 statement building from an event (shared browser/server) |
| `src/shared/events.ts` | `ServerEvent` and `EventResult` types and validation |
| `functions/_lib/events/decide.ts` | The course server's decision for each event |
| `functions/api/events.ts` | `POST /api/events` |
| `src/record/eventClient.ts` | Batching and sending events from the studio |
| `functions/_lib/session/session.ts` | Session cookie, `sessions` table |
| `functions/api/session.ts` | `POST`/`GET`/`DELETE /api/session` |
| `src/record/session.ts` | Client side of sessions |
| `src/content.ts` | `CourseSource` (`bundled`, `wordpress`) and the live `content` binding |
| `src/shared/package.ts` | Package ⇄ `ContentBundle` adapter and `compareBundles` |
| `vendor/course-xapi-mcp/` | Vendored standard (`core`, `validator`, later `server`) |
| `scripts/lib/spacefast.ts` | Spacefast API client (WP-CLI, publish status) |
| `scripts/provision.ts`, `scripts/keys.ts` | Idempotent WP-CLI provisioning for both spaces; local key generation |
| `scripts/migrate-to-sensei.ts`, `scripts/content-pull.ts`, `scripts/house-rules.ts`, `scripts/yaml-content.ts` | Migration and the snapshot |
| `content/snapshot/` | Committed package export (unzipped) |
| `functions/_lib/ledger/` | Ed25519 request signing and the connector client |
| `functions/_lib/course/cache.ts`, `functions/api/course.ts`, `functions/api/course-changed.ts` | Course cache and projection |
| `wordpress/lwr-backend-view/` | Tiny WordPress plugin: the backend-view banner on Sensei pages |
| `functions/_lib/lrs/` | LRS client, outbox |
| `functions/_lib/record/` | Registration, official statements, shadow facts, official projection |
| `functions/_lib/oauth/`, `functions/api/oauth/` | MCP authorization server |

---

## Phase 0: spikes (no product change)

### Task 1: Spike kit

**Files:**
- Create: `spikes/phase0/site/index.html`, `spikes/phase0/site/sf.jsonc`, `spikes/phase0/site/functions/api/selfcall.ts`, `spikes/phase0/site/functions/api/wk.ts`, `spikes/phase0/site/functions/api/ctx.ts`
- Create: `spikes/phase0/lwr-spike/lwr-spike.php`
- Create: `spikes/phase0/probe.ts`
- Test: `tests/spikes/probe.test.ts`
- Modify: `tsconfig.json` / `vitest.config.ts` only if needed so `spikes/` is type-checked but never bundled (`scripts/assemble.ts` already bundles only `functions/api`)

**Interfaces:**
- Produces: `evaluateProbes(results: ProbeResult[]): { id: ProbeId; pass: boolean; note: string }[]` and `runProbes(base: string, lrsBase: string): Promise<ProbeResult[]>` in `spikes/phase0/probe.ts`. `ProbeId` = `'wp-json-through-rewrites' | 'functions-self-fetch' | 'well-known-oauth' | 'sensei-installed' | 'certificate-headless' | 'lrs-host-basic-auth' | 'sodium' | 'did-json' | 'user-create-route' | 'functions-wait-until'` (probes 1 to 8 of spec §13 phase 0, plus 9 `functions-wait-until`).

Spike site: `sf.jsonc` has **no** `fallback`; explicit `rewrites` send `/`, `/learn/*`, `/path/*` to `index.html`, and `/.well-known/oauth-protected-resource` and `/.well-known/oauth-authorization-server` to `/api/wk`. Read the rewrite grammar from https://spacefast.com/docs/routing and `/private/tmp/claude-501/-Users-cedarstone-Projects-learn-wp-reimagined/5376001d-2862-4ef6-85e3-26e5bd4cbe50/scratchpad/sf-spike/docs/config-file.md`. `selfcall.ts` fetches `https://<own host>/wp-json/lwr-spike/v1/ping` and returns its status and body. `ctx.ts` returns the keys of the handler's second argument (to learn whether `waitUntil` exists). Spike plugin routes under `lwr-spike/v1`: `GET ping` (PHP version, `extension_loaded('sodium')`, `function_exists('fastcgi_finish_request')`, whether an `Authorization: Basic` header reached PHP, Sensei and Certificates versions); `POST users` (creates a user with no email and the `subscriber` role, gated by a header whose SHA-256 must equal option `lwr_spike_token_sha256`); `POST cert-test` (same gate: creates a course with one lesson, a user, completes the lesson via `Sensei_Utils::sensei_start_lesson( $lesson, $user, true )`, then renders that user's certificate PDF in this request with no login and returns `{ bytes, contentType }`).

- [ ] **Step 1: Write the failing test** `tests/spikes/probe.test.ts`:

```ts
it('fails wp-json-through-rewrites when /wp-json/ returns the app shell', () => {
  const r = evaluateProbes([{ id: 'wp-json-through-rewrites', status: 200, contentType: 'text/html', body: '<div id="app">' }]);
  expect(r[0]).toMatchObject({ pass: false });
});
it('passes did-json only for application/did+json or application/json with an id of did:web:lrs.sqwrlz.com', ...);
it('passes certificate-headless only when bytes > 1000 and contentType is application/pdf', ...);
```

- [ ] **Step 2:** Run `npx vitest run tests/spikes/probe.test.ts`. Expected: FAIL (module not found).
- [ ] **Step 3:** Implement `evaluateProbes` and `runProbes`, the spike site and the spike plugin. `runProbes` never prints secrets; the gate token is read from `SPIKE_TOKEN` in the environment.
- [ ] **Step 4:** Run `npx vitest run tests/spikes/probe.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `git add spikes/phase0 tests/spikes/probe.test.ts && git commit -m "chore(spikes): phase 0 spike site, plugin and probe runner" && git push origin main`

### Task 2: Run the phase 0 spikes (controller step, needs owner)

- [ ] **Step 1:** With Derin: create a claimed public throwaway space `lwr-spike-<date>` and the real LRS space `learn-wp-reimagined-lrs` (claimed, public), and point `lrs.sqwrlz.com` at the LRS space (DNS). The LRS space runs only the spike plugin until Task 28.
- [ ] **Step 2:** Publish `spikes/phase0/site` to the throwaway space. Install on the throwaway space via `POST /v1/spaces/{id}/wp-cli` (pattern: `sf-spike/s2/wp.sh`): `["plugin","install","sensei-lms","--version=4.26.4","--activate"]`, `["plugin","install","sensei-certificates","--version=2.6.0","--activate"]`, `["plugin","install","<URL of lwr-spike.zip>","--activate","--force"]`, `["option","update","lwr_spike_token_sha256","<sha256 hex>"]`. Install the spike plugin on the LRS space the same way.
- [ ] **Step 3:** Run `SPIKE_TOKEN=... npx tsx spikes/phase0/probe.ts https://lwr-spike-<date>.space.fast https://lrs.sqwrlz.com`. On Space A run only read-only probes (`GET https://learn-wp-reimagined.space.fast/wp-json/` with today's fallback); make no change to Space A.
- [ ] **Step 4:** Write `docs/spikes/2026-10-phase0-results.md`: one row per probe (pass/fail, evidence, consequence per §13.1). Show Derin the full diff; commit only after approval. G0 is passed when approved.

---

## Phase 1: server authority

### Task 3: Explicit app routes instead of the SPA fallback

Consumes G0 probe 1 (the rewrite form that lets `/wp-json/*` reach WordPress).

**Files:**
- Create: `src/pages/appRoutes.ts`
- Modify: `src/app.tsx` (Router built from `APP_ROUTES`), `sf.jsonc` (drop `fallback`; add `rewrites`)
- Test: `tests/site/routes-config.test.ts`; existing `tests/components/routing.test.tsx`, `tests/scripts/assemble.test.ts` still pass

**Interfaces:**
- Produces: `APP_ROUTES: readonly { pattern: string; rewrite: string }[]` with exactly `/`, `/path/*`, `/learn/*`, `/finale`, `/finale/*`, `/connect`, `/how-it-works`, `/proposal`. Later tasks append `/consent` (Task 43) and `/badges/*` (Task 49) to both `APP_ROUTES` and `sf.jsonc`.

Note: the spec's §4.5 list (`/paths/*`, `/lessons/*`) does not match the app's real routes; the real ones above win.

- [ ] **Step 1: Write the failing test**:

```ts
it('every app route has an sf.jsonc rewrite to index.html', () => {
  for (const r of APP_ROUTES) expect(rewrites).toContainEqual(expect.objectContaining({ source: r.pattern, destination: '/index.html' }));
});
it('has no catch-all fallback', () => expect(sf.fallback).toBeUndefined());
it.each(['/wp-json/*', '/wp-admin/*', '/wp-login.php', '/course/*', '/lesson/*', '/xapi/*'])('leaves %s to WordPress', (p) => {
  expect(rewrites.some((r) => matches(r.source, p.replace('*', 'x')))).toBe(false);
});
```

- [ ] **Step 2:** Run `npx vitest run tests/site/routes-config.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement `appRoutes.ts`, wire `src/app.tsx`, rewrite `sf.jsonc` (parse it in the test with a JSONC comment stripper).
- [ ] **Step 4:** Run `npx vitest run tests/site tests/components/routing.test.tsx tests/scripts/assemble.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(site): explicit app rewrites so WordPress paths fall through`

### Task 4: Extract statement building from `applyEvent`

**Files:**
- Create: `src/shared/statements.ts`
- Modify: `src/shared/record.ts` (`applyEvent` calls `statementsForEvent`; behaviour unchanged)
- Test: `tests/shared/statements.test.ts`; `tests/shared/record.test.ts` unchanged and passing

**Interfaces:**
- Produces: `statementsForEvent(learnerId: string, e: RecordEvent, c: ContentBundle, opts?: { ids?: string[]; timestamp?: string; chosenBy?: 'judge' | 'learner' }): XapiStatement[]`. When `opts.ids` is given, statement `i` gets `ids[i]`. `chosenBy: 'learner'` adds result extension `EXT_CHOSEN_BY = \`${XAPI_BASE}/xapi/extensions/chosen-by\`` with value `'learner'` on the `branched` statement (phase 1 stand-in for the standard's learner-chosen marker). Export `EXT_CHOSEN_BY` from `src/shared/xapi.ts`.

- [ ] **Step 1: Write the failing test**: for each `RecordEvent` type, `statementsForEvent` returns the same verbs, object ids and results as the statements `applyEvent` appended before the change (compare with ids and timestamps stripped); `checkpointAnswered` yields `answered`, `passed|failed`, `branched` in that order; `fileEdited` and `placed` yield `[]`; `opts.ids` are used in order.
- [ ] **Step 2:** Run `npx vitest run tests/shared/statements.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement; make `applyEvent` delegate.
- [ ] **Step 4:** Run `npx vitest run tests/shared`. Expected: PASS.
- [ ] **Step 5: Commit** `refactor(record): statementsForEvent shared by browser and server`

### Task 5: `POST /api/events`: the course server decides

**Files:**
- Create: `src/shared/events.ts`, `functions/_lib/events/decide.ts`, `functions/_lib/events/ids.ts`, `functions/api/events.ts`
- Modify: `functions/_lib/db.ts` (`decisions` table in `ensureSchema`), `functions/api/checkpoint.ts` (returns `decisionId`), `functions/_lib/config.ts` (`SERVER_FLAGS`)
- Test: `tests/functions/events.test.ts`, additions to `tests/functions/endpoints.test.ts`

**Interfaces:**
- Consumes: `statementsForEvent` (Task 4), `runChecks` (`src/shared/checks.ts`), `resolveBranch`, `validatePlacement` (`src/shared/engine.ts`), `getContent()`, `rateLimit`, `clientKey`, `readJsonCapped`.
- Produces in `src/shared/events.ts`:

```ts
export type ServerEvent =
  | { eventId: string; type: 'placed'; placement: Placement }
  | { eventId: string; type: 'beatViewed'; lessonId: string; beatIndex: number }
  | { eventId: string; type: 'checkpointAnswered'; lessonId: string; response: string; outcome: Outcome; decisionId?: string; files?: Record<string, string> }
  | { eventId: string; type: 'codeSubmitted'; lessonId: string; target: 'checkpoint' | 'bug'; file: string; files: Record<string, string> }
  | { eventId: string; type: 'lessonCompleted'; lessonId: string };
export type EventResult =
  | { eventId: string; ok: true; statements: XapiStatement[]; passed?: boolean; outcome?: Outcome; to?: string; chosenBy?: 'judge' | 'learner' }
  | { eventId: string; ok: false; error: 'unknown-lesson' | 'invalid' | 'not-allowed' };
export function parseEvents(raw: unknown): { ok: true; learnerId: string; events: ServerEvent[] } | { ok: false; error: string };
export const EVENTS_MAX = 50; export const EVENTS_MAX_BYTES = 256_000;
```
- Produces: `decideEvents(env: Env, actorName: string, events: ServerEvent[], now: number): Promise<EventResult[]>`; `deriveStatementId(eventId: string, n: number): Promise<string>` (SHA-256 of `${eventId}:${n}`, formatted as a version-8 RFC 9562 UUID); `SERVER_FLAGS = { serverEvents: true }` (later tasks add keys); `/api/checkpoint` response gains `decisionId: string`.

Rules: `decisions(id VARCHAR(40) PRIMARY KEY, lesson_id VARCHAR(120), outcome VARCHAR(10), created BIGINT, used INT)`, TTL 30 minutes, single use. Free-text `checkpointAnswered`: a valid unused `decisionId` for that lesson and outcome → `chosenBy: 'judge'`; otherwise accepted only if `outcome` is in the checkpoint's `fallback` options → `chosenBy: 'learner'`; otherwise `not-allowed`. Code `checkpointAnswered`: `advance` only if `files` pass the checkpoint's checks server-side; `review` always allowed. `codeSubmitted` re-runs `checks` (target `checkpoint`) or the bug's `fixChecks` (target `bug`) and returns `passed`. Phase 1 actor = the body's `learnerId` (a UUID). Rate limit `events:<clientKey>` 120 per 10 min. Body above `EVENTS_MAX_BYTES` → 413; more than `EVENTS_MAX` events → 400.

- [ ] **Step 1: Write the failing tests** in `tests/functions/events.test.ts` (fixture content via `setContentForTests(buildContent('tests/fixtures/content'))`, `createSqliteD1()`):

```ts
it('re-runs code checks server-side and ignores any client "passed"', ...);           // failing files → passed:false, 'failed' statement
it('accepts a judged outcome once per decisionId', ...);                                // second use → chosenBy 'learner' or not-allowed
it('rejects a decisionId issued for another lesson', ...);
it('accepts a fallback outcome without a decision and marks it learner-chosen', ...);   // EXT_CHOSEN_BY === 'learner'
it('rejects an outcome that is neither judged nor a fallback option', ...);            // error 'not-allowed'
it('refuses advance on a code checkpoint whose files fail', ...);
it('one unknown lesson does not sink the batch', ...);                                  // Review Focus 3
it('same eventId twice yields identical statement ids', ...);                           // Review Focus 1
it('caps batches at 50 events and 256000 bytes', ...);
```
  In `tests/functions/endpoints.test.ts`: `checkpoint returns a decisionId stored in decisions`.
- [ ] **Step 2:** Run `npx vitest run tests/functions/events.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement `src/shared/events.ts`, `ids.ts`, `decide.ts`, `functions/api/events.ts` (503 `disabled` when `SERVER_FLAGS.serverEvents` is false), the `decisions` table and the `decisionId` in `checkpoint.ts`.
- [ ] **Step 4:** Run `npx vitest run tests/functions`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(api): /api/events, the course server decides and builds statements`

### Task 6: Studio sends events; the local record keeps server statements

**Files:**
- Create: `src/record/eventClient.ts`
- Modify: `src/record/store.ts` (`RecordManager.dispatch`), `src/config.ts` (`FEATURES.serverEvents`), `src/ai/client.ts` (`judge` result type gains `decisionId?: string`), `src/components/Checkpoint.tsx` (passes `decisionId` and, for code checkpoints, `files`), `src/studio/BugCard.tsx` (sends `codeSubmitted` with files), `src/pages/Lesson.tsx` (passes `decisionId` through `checkpointAnswered`; flushes on lesson change)
- Test: `tests/record/event-client.test.ts`, additions to `tests/record/store.test.ts`, `tests/components/lesson.test.tsx`

**Interfaces:**
- Consumes: `ServerEvent`, `EventResult`, `parseEvents` shape (Task 5).
- Produces: `class EventClient { send(e: Omit<ServerEvent,'eventId'>): Promise<EventResult | null>; queueBeat(lessonId: string, beatIndex: number): void; flush(): Promise<void> }` with `BEAT_FLUSH_MS = 30_000`; beats flush on timer, on `flush()` (lesson change) and on `pagehide` via `navigator.sendBeacon('/api/events', ...)`. `RecordEvent` variants `checkpointAnswered` and `codeChecked` gain optional `decisionId` and `files` fields (ignored by `applyEvent`). `RecordManager.dispatch(e)`: applies `applyEvent` for position, files and completion as today, but when `FEATURES.serverEvents` is on and the server answers, appends the server's statements instead of locally built ones; on network failure or `ok:false` it falls back to today's local statements (phase 1 record is still learner-held). Exported `getEventClient(): EventClient`.

- [ ] **Step 1: Write the failing tests**: `queues beats and sends one batch after 30 s` (fake timers); `flush sends immediately`; `pagehide uses sendBeacon`; `dispatch appends server statements when the server answers`; `dispatch falls back to local statements when fetch rejects`; `beat advance never awaits the network` (dispatch of `beatViewed` resolves before the fetch mock resolves).
- [ ] **Step 2:** Run `npx vitest run tests/record`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(record): studio sends events to the course server`

### Task 7: `CourseSource` interface (bundled only)

**Files:**
- Modify: `src/content.ts`
- Test: `tests/content/course-source.test.ts`

**Interfaces:**
- Produces in `src/content.ts`: `interface CourseSource { initial(): ContentBundle; latest(): Promise<{ bundle: ContentBundle; etag: string } | null> }`, `bundledSource: CourseSource` (`latest` resolves `null`), `export let content: ContentBundle` (live binding, unchanged name so the 20+ importers keep working), `adoptLatest(): Promise<boolean>` (swaps `content` if a newer bundle is pending; called only at lesson open, Task 21), `setCourseSourceForTests(s: CourseSource | null)`.

- [ ] **Step 1: Write the failing test**: `content equals bundledSource.initial()`; `adoptLatest returns false with the bundled source`; `a source returning a newer bundle swaps content only when adoptLatest is called`.
- [ ] **Step 2:** Run `npx vitest run tests/content/course-source.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `refactor(content): CourseSource with a bundled implementation`

### Task 8: Studio speed baseline

Browser work uses the agent-browser CLI only; never Puppeteer or Playwright, never Chrome by hand.

**Files:**
- Create: `scripts/speed/measure.sh` (agent-browser CLI against a base URL; writes JSON), `scripts/speed/compare.ts`, `perf/baseline-2026-10.json`
- Test: `tests/scripts/speed-compare.test.ts`

**Interfaces:**
- Produces: `compareSpeed(base: SpeedRun, run: SpeedRun): { metric: string; viewport: string; ok: boolean; base: number; now: number }[]` with `SpeedRun = Record<'1440x900' | '390x844', { lessonOpenMs: number; beatAdvanceMs: number; checkpointResultMs: number }>` (medians of 5). Budget: `lessonOpenMs` and `beatAdvanceMs` ≤ base × 1.10; `checkpointResultMs` ≤ base + 300.

Measurements: lesson open = navigate to `/learn/<first block-theme lesson>` until the first beat is visible; beat advance = activate the continue control until the next beat is visible; checkpoint result = submit a fixed free-text answer until the result is shown.

- [ ] **Step 1: Write the failing test**: `flags lessonOpen 11% slower`, `allows checkpoint +299 ms`, `flags checkpoint +301 ms`.
- [ ] **Step 2:** Run `npx vitest run tests/scripts/speed-compare.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement `compare.ts` and `measure.sh`; run `measure.sh https://learn-wp-reimagined.space.fast > perf/baseline-2026-10.json` against today's live site (read-only).
- [ ] **Step 4:** Run the test. Expected: PASS.
- [ ] **Step 5: Commit** `chore(perf): studio speed baseline and budget check`

### Task 9: Draft page copy for every phase

**Files:**
- Create: `docs/page-copy-draft.md`

Drafts, per phase, the exact sentences the How this works and Proposal pages will gain or lose (§10 rows "Proposal page" and "How this works page"; §6.4 privacy statements), so later page tasks paste approved copy. Each block is headed by the phase and the flag that turns it on. No emojis; plain, unofficial-concept tone.

- [ ] **Step 1:** Write the draft.
- [ ] **Step 2:** Show Derin the complete diff; wait for approval.
- [ ] **Step 3: Commit** (after approval) `docs: draft page copy for the Sensei rebuild`

### Task 10: Ship phase 1 (controller step, needs owner)

- [ ] **Step 1:** `npm test && npm run build`; `sf publish dist` to Space A.
- [ ] **Step 2:** agent-browser: `/wp-json/` returns WordPress JSON, every `APP_ROUTES` path renders the app, a full lesson with a checkpoint and the bug works at 1440x900 and 390x844 with no horizontal scroll.
- [ ] **Step 3:** `scripts/speed/measure.sh` → `npx tsx scripts/speed/compare.ts perf/baseline-2026-10.json <run>`; all within budget, else set `FEATURES.serverEvents`/`SERVER_FLAGS.serverEvents` to `false` and republish.

---

## Phase 2: sessions without WordPress

### Task 11: Sessions on the course server

**Files:**
- Create: `functions/_lib/session/session.ts`, `functions/api/session.ts`
- Modify: `functions/_lib/env.ts` (`SESSION_KEY?: string`), `functions/_lib/db.ts` (`sessions` table), `functions/api/events.ts` (actor from the session when present), `functions/_lib/config.ts` (`SERVER_FLAGS.sessions`), `.env.server.example` (`SESSION_KEY=` with a generation note)
- Test: `tests/functions/session.test.ts`

**Interfaces:**
- Produces: `SESSION_COOKIE = 'lwr_sid'`; `SESSION_IDLE_MS = 180 * 24 * 60 * 60 * 1000`; `TOUCH_EVERY_MS = 3_600_000`; `readSession(req: Request, env: Env, now: number): Promise<Session | null>`; `createSession(env: Env, now: number, actorName?: string): Promise<{ session: Session; cookie: string }>`; `deleteSession(env: Env, s: Session): Promise<void>`; `clearCookie(): string`. `Session = { sidHash: string; actorName: string; wpUserId: number | null; createdAt: number; touchedAt: number }`. Table `sessions(sid_hash VARCHAR(64) PRIMARY KEY, actor_name VARCHAR(64), wp_user_id BIGINT NULL, created BIGINT, touched BIGINT)`; `sid_hash = hex(HMAC-SHA256(SESSION_KEY, cookieValue))`, cookie value 32 random bytes base64url, cookie `HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=15552000`.
- Routes: `POST /api/session` → `{ actor: { homePage: XAPI_BASE, name } }` + `Set-Cookie` (rate limits `sess:new:<clientKey>` 10 per 10 min and `sess:new:g` 300 per 10 min; 429 `limited` otherwise); `GET /api/session` → `{ actor } | { actor: null }`; `DELETE /api/session` → deletes the row and clears the cookie (`{ deleted: true }`). `/api/events`: with a valid session the actor is the session's; without one, phase 1 behaviour (body `learnerId`) while `SERVER_FLAGS.sessions` is off, and `401 no-session` when it is on.

- [ ] **Step 1: Write the failing tests**: `creates a session and stores only the HMAC`; `GET returns the actor for a valid cookie`; `expired cookie is treated as no session and cleared` (Review Focus 4); `tampered cookie yields no session, not a 500`; `11th create in a window is 429`; `DELETE removes the row and clears the cookie`; `events use the session actor and ignore body learnerId`; `touch writes at most once an hour`.
- [ ] **Step 2:** Run `npx vitest run tests/functions/session.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npx vitest run tests/functions`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(api): anonymous studio sessions`

### Task 12: Studio sessions and "Delete my data"

**Files:**
- Create: `src/record/session.ts`
- Modify: `src/record/eventClient.ts` (calls `ensureSession()` before the first send), `src/record/store.ts` (`RecordManager.reset(): Promise<void>` clears the primary store and starts a new record), `src/components/RecordPanel.tsx` ("Delete my data" with a confirm dialog), `src/config.ts` (`FEATURES.sessions`)
- Test: `tests/record/session.test.ts`, `tests/components/record-delete.test.tsx`

**Interfaces:**
- Consumes: `POST/GET/DELETE /api/session` (Task 11).
- Produces: `ensureSession(): Promise<SessionActor | null>` (single in-flight request; `null` on 429/5xx/network, retried on the next recorded action); `deleteMyData(): Promise<boolean>` (DELETE, then `RecordManager.reset()`, then `getEventClient()` drops queued events). After the session exists, the local record's `learnerId` is set to the session actor's name.

Copy: dialog title "Delete my data?"; body "This deletes your progress on this site and in this browser. It can't be undone."; buttons "Delete" and "Keep it". Focus moves into the dialog and back to the trigger on close.

- [ ] **Step 1: Write the failing tests**: `ensureSession makes one request for concurrent callers`; `returns null on 429 and retries next time`; `delete clears the browser record after the server confirms`; `delete leaves the record when the server fails and says so`; dialog `is keyboard operable and returns focus`.
- [ ] **Step 2:** Run `npx vitest run tests/record/session.test.ts tests/components/record-delete.test.tsx`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(record): studio sessions and delete my data`

### Task 13: Ship phase 2 (controller step, needs owner)

- [ ] **Step 1:** Generate `SESSION_KEY` locally into `.env.server` (32 random bytes base64url; never printed). `npm test && npm run build && sf publish dist`.
- [ ] **Step 2:** agent-browser: first recorded action sets `lwr_sid`; "Delete my data" clears it and the record; 390px no horizontal scroll; keyboard-only delete flow.
- [ ] **Step 3:** Speed compare within budget, else flags off and republish.

---

## Phase 3: content in Sensei (after G1)

### Task 14: Vendor the standard (core and validator)

**Files:**
- Create: `scripts/vendor-course-xapi-mcp.ts`, `vendor/course-xapi-mcp/` (`core/`, `validator/`, `LICENSE`, `NOTICE`, `VENDORED.json`, `README.md`)
- Test: `tests/scripts/vendor-course-xapi-mcp.test.ts`

**Interfaces:**
- Produces: `vendorCourseXapiMcp(srcRepo: string, commit: string, opts: { packages: ('core' | 'validator' | 'server')[] }, outDir = 'vendor/course-xapi-mcp'): string[]`, same approach as `scripts/vendor-learning-mcp.ts` (git archive of `reference/packages/<p>/src`, provenance header, relative imports instead of `@course-xapi-mcp/*`), `VENDORED.json` with `"license": "Apache-2.0"`. `vendor/learning-mcp` stays until Task 52.

- [ ] **Step 1: Write the failing test** (temp git repo fixture as in the existing vendor test): `rewrites @course-xapi-mcp/core imports to relative paths`; `records the full commit and Apache-2.0`; `refuses a dirty or unknown commit`.
- [ ] **Step 2:** Run it. Expected: FAIL.
- [ ] **Step 3:** Implement; vendor the G1 tag with `--packages core,validator`.
- [ ] **Step 4:** Run `npx vitest run tests/scripts`. Expected: PASS.
- [ ] **Step 5: Commit** `chore(vendor): course-xapi-mcp core and validator @ <tag>`

### Task 15: Package adapter and round-trip comparator

**Files:**
- Create: `src/shared/package.ts`
- Test: `tests/shared/package.test.ts`

**Interfaces:**
- Consumes: the vendored core's package types and reader/writer (Task 14), `ContentBundle` (`src/shared/types.ts`).
- Produces: `STUDIO_EXT = 'https://learn-wp-reimagined.space.fast/cxm/studio/v1'` (namespaced extension carrying `preview`, `landing`, `previewFiles`, `finalFiles`); `COURSE_IRI = 'https://learn-wp-reimagined.space.fast/activities/course'`; `bundleToPackage(b: ContentBundle): PackageFiles` (`PackageFiles = Record<string, string>`: `cmi5.xml`, `cxm/course.json`, `cxm/lessons/<key>.json`); `packageToBundle(files: PackageFiles): ContentBundle`; `compareBundles(a: ContentBundle, b: ContentBundle): string[]` (empty when semantically identical: same ids, beats, checks, branches, files, whitespace-normalised text). IRIs per §5.3: block `…/activities/paths/<path-id>`, AU `…/activities/lessons/<lesson-id>`. `bundleToPackage` also emits one badge declaration per live path: `awardOn: 'block-satisfied'`, `countWaived: true`, with no per-lesson or course badge (§7.5).

- [ ] **Step 1: Write the failing tests**: `the 18 live lessons round-trip with no differences` (`compareBundles(yamlBundle, packageToBundle(bundleToPackage(yamlBundle)))` is `[]`, using `buildContentFromYaml('content')` from Task 20's `scripts/yaml-content.ts`, or the current `buildContent('content')` before Task 20 lands); `the package passes the standard's validator with no errors`; `compareBundles reports a changed check value by lesson id`; `studio fields live only under STUDIO_EXT`; `one badge declaration per live path with countWaived true`.
- [ ] **Step 2:** Run `npx vitest run tests/shared/package.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run it. Expected: PASS.
- [ ] **Step 5: Commit** `feat(content): package adapter between the standard and the studio bundle`

### Task 16: Spacefast client, local keys and Space A provisioning

**Files:**
- Create: `scripts/lib/spacefast.ts`, `scripts/keys.ts`, `scripts/provision.ts`
- Modify: `.env.server.example` (`CONNECTOR_SIGNING_KEY=`, `CONNECTOR_KEY_ID=`, `CONNECTOR_PING_PUBLIC_KEY=`)
- Test: `tests/scripts/provision.test.ts`

**Interfaces:**
- Produces: `interface SpacefastApi { wpCli(spaceId: string, args: string[]): Promise<{ ok: boolean }> }` and `httpSpacefastApi(token: string): SpacefastApi` (`POST https://api.spacefast.com/v1/spaces/{id}/wp-cli` with `{ args }`, token from env `SPACEFAST_TOKEN`, never logged); `generateKeys(envFile = '.env.server'): { publicKeyB64: string }` (Ed25519 via `node:crypto`, writes `CONNECTOR_SIGNING_KEY` as PKCS8 base64 and `CONNECTOR_KEY_ID=course-server` only if absent); `provisionSpaceA(api: SpacefastApi, status: () => Promise<LedgerStatus>, cfg: { spaceId: string; ledgerZipUrl: string; backendViewZipUrl: string; publicKeyB64: string }): Promise<StepReport[]>`. Steps, in order, each skipped when status already shows it and each followed by a status read: `["plugin","install","sensei-lms","--version=4.26.4","--activate"]`, `["plugin","install","sensei-certificates","--version=2.6.0","--activate"]`, `["plugin","install",ledgerZipUrl,"--activate","--force"]`, `["plugin","install",backendViewZipUrl,"--activate","--force"]`, `["rewrite","structure","/%postname%/"]`, `["learning-ledger","role","enable","connector"]`, `["learning-ledger","connector","trust-key","--id=course-server","--public-key=" + publicKeyB64]`, plus the program's content-changed ping URL `https://learn-wp-reimagined.space.fast/api/course-changed` via the plugin's documented command (G1). `LedgerStatus` is Task 18's type.

- [ ] **Step 1: Write the failing tests** with a fake `SpacefastApi`: `issues the exact arg arrays in order`; `skips steps the status already reports`; `stops and reports on the first failed step`; `no argument contains a value from .env.server other than the public key` (load a fake env and assert no secret substring appears in any arg).
- [ ] **Step 2:** Run `npx vitest run tests/scripts/provision.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement. CLI: `npx tsx scripts/provision.ts space-a` reads `SPACE_A_ID` and `SPACEFAST_TOKEN` from the environment.
- [ ] **Step 4:** Run it. Expected: PASS.
- [ ] **Step 5: Commit** `feat(scripts): idempotent Space A provisioning through WP-CLI`

### Task 17: Migration script

**Files:**
- Create: `scripts/migrate-to-sensei.ts`
- Test: `tests/scripts/migrate.test.ts`

**Interfaces:**
- Consumes: `bundleToPackage`, `packageToBundle`, `compareBundles` (Task 15), the vendored validator (Task 14), `SpacefastApi` (Task 16), `ConnectorClient.getPackage` (Task 18).
- Produces: `buildMigrationZip(yamlDir: string): Uint8Array` (validates; throws with the validator's error codes); `migrate(deps: { api: SpacefastApi; connector: ConnectorClient; spaceId: string; packageUrl: string; yaml: ContentBundle }): Promise<{ imported: boolean; diffs: string[] }>` which runs `["learning-ledger","package","import",packageUrl]`, then pulls the full package back and returns `compareBundles(yaml, packageToBundle(pulled))`. CLI: `npx tsx scripts/migrate-to-sensei.ts zip` writes `dist/wp-zips/learn-wp-reimagined-authoring.zip`; `... run <packageUrl>` imports and prints diffs; exit code 1 on any diff.

- [ ] **Step 1: Write the failing tests**: `zip contains cmi5.xml, cxm/course.json and 18 lesson files`; `invalid content fails with validator codes`; `migrate reports diffs from a fake connector that drops a check`; `re-running with an unchanged package yields no diffs`.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5: Commit** `feat(scripts): YAML to Sensei migration with a round-trip check`

### Task 18: Request signing and the connector client

**Files:**
- Create: `functions/_lib/ledger/sign.ts`, `functions/_lib/ledger/connector.ts`
- Modify: `functions/_lib/env.ts` (`CONNECTOR_SIGNING_KEY?`, `CONNECTOR_KEY_ID?`, `CONNECTOR_PING_PUBLIC_KEY?`), `functions/_lib/config.ts` (`LEDGER_BASE = 'https://learn-wp-reimagined.space.fast/wp-json/learning-ledger/v1'`, or the Abilities route if G0 probe 2 failed; `PROGRAM_KEY = 'learn-wp-reimagined'`)
- Test: `tests/functions/ledger-sign.test.ts`, `tests/functions/connector.test.ts`

**Interfaces:**
- Produces: `signRequest(i: { method: string; path: string; body: Uint8Array; keyId: string; privateKeyPkcs8B64: string; now: number; nonce: string }): Promise<Record<'X-Learning-Ledger-Key' | 'X-Learning-Ledger-Timestamp' | 'X-Learning-Ledger-Nonce' | 'X-Learning-Ledger-Signature', string>>` over `method + "\n" + path + "\n" + SHA-256(body) + "\n" + timestamp + "\n" + nonce` (encodings exactly as the plugin's G1 test vector); `verifySigned(i: { timestamp: string; body: Uint8Array; signatureB64: string; publicKeyB64: string; now: number }): Promise<boolean>` over `timestamp + "." + body`, 5-minute window; `class ConnectorClient { constructor(env: Env, fetchFn = fetch); status(): Promise<LedgerStatus>; getPackage(program: string, etag?: string): Promise<{ status: 304 } | { status: 200; etag: string; version: number; zip: Uint8Array }> }` with a 3 s timeout per request and `ConnectorUnavailable` thrown on timeout or 5xx. `LedgerStatus = { versions: Record<string, string>; roles: string[]; sensei: string | null; certificates: string | null; sodium: 'native' | 'compat' | null; trustedKeys: string[]; connectorSecretSha256?: string }`. Task 25 adds learner methods to this class.

- [ ] **Step 1: Write the failing tests**: `matches the plugin's published test vector`; `verifySigned rejects a timestamp 301 s old`; `verifySigned rejects a changed body`; `getPackage sends If-None-Match and maps 304`; `throws ConnectorUnavailable after 3 s`.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement with WebCrypto `Ed25519` (works in Functions and Node).
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5: Commit** `feat(ledger): Ed25519 signed requests and the connector client`

### Task 19: Course cache, `/api/course` and the content-changed ping

**Files:**
- Create: `functions/_lib/course/cache.ts`, `functions/api/course.ts`, `functions/api/course-changed.ts`
- Modify: `functions/_lib/db.ts` (`course_cache`), `functions/_lib/content.ts` (`setCurrentContent(b: ContentBundle)` used by the cache), `functions/_lib/ai.ts` (`preflight` awaits `refreshContent(env)`), `functions/api/events.ts` (awaits `refreshContent(env)`), `functions/_lib/config.ts` (`SERVER_FLAGS.wordpressContent: false`)
- Test: `tests/functions/course-cache.test.ts`

**Interfaces:**
- Consumes: `ConnectorClient.getPackage`, `verifySigned` (Task 18), `packageToBundle` (Task 15), the vendored package reader (Task 14).
- Produces: `COURSE_REVALIDATE_MS = 300_000`; `refreshContent(env: Env, now = Date.now(), opts?: { force?: boolean }): Promise<{ etag: string; version: number; changed: boolean }>` (no-op returning the baked etag when `SERVER_FLAGS.wordpressContent` is false; otherwise revalidates when older than 5 min or forced; on `ConnectorUnavailable` serves the last good row); `onNewVersion(fn: (zip: Uint8Array, etag: string) => Promise<void>)` hook list (Task 30 registers the LRS import). Table `course_cache(course_id VARCHAR(64) PRIMARY KEY, etag VARCHAR(80), version INT, body MEDIUMTEXT, fetched BIGINT)` (use `TEXT` if `MEDIUMTEXT` fails on SQLite; check `dev/sqliteD1.ts`). `GET /api/course` → the bundle with `ETag`, `Cache-Control: max-age=60, stale-while-revalidate=86400`, 304 on `If-None-Match`. `POST /api/course-changed` → verifies the connector's signed ping with `CONNECTOR_PING_PUBLIC_KEY`, forces a refresh, 202.

Decision: one `/api/course` returning the whole bundle (three paths, 18 lessons) instead of `/api/course/{path}`; same fields the browser bundle carries today.

- [ ] **Step 1: Write the failing tests**: `serves the cached copy for 5 minutes without calling the connector`; `revalidates after 5 minutes with If-None-Match`; `serves the last good copy when the connector is down`; `a signed ping forces a refresh`; `an unsigned or stale ping is 401`; `GET /api/course answers 304 for a matching ETag`; `new version runs onNewVersion hooks once`.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npx vitest run tests/functions`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(api): course cache with revalidation and a content-changed ping`

### Task 20: Snapshot loader, `content:pull` and house rules

**Files:**
- Create: `scripts/yaml-content.ts` (today's YAML loader, moved from `scripts/build-content.ts` and renamed `buildContentFromYaml`), `scripts/content-pull.ts`, `scripts/house-rules.ts`, `content/snapshot/` (initially written from YAML by `npx tsx scripts/content-pull.ts --from-yaml`)
- Modify: `scripts/build-content.ts` (`buildContent(dir = 'content/snapshot')` reads a snapshot via `packageToBundle`, runs the standard's validator and `houseRules`, writes `src/generated/content.json`), `package.json` (`"content:pull": "tsx scripts/content-pull.ts"`), `tests/fixtures/content/` (replaced by a small snapshot generated from the current fixture YAML; YAML fixtures deleted)
- Test: `tests/scripts/build-content.test.ts` (updated), `tests/scripts/house-rules.test.ts`, `tests/content/snapshot-fresh.test.ts`

**Interfaces:**
- Consumes: `bundleToPackage`, `packageToBundle` (Task 15), `signRequest` (Task 18) for the pull.
- Produces: `houseRules(b: ContentBundle): string[]` enforcing: at least 2 checkpoints per live path; advance, review and skip branches on every checkpoint; a `preview` on every live path; file names unique across paths; `finalFiles` pass every lesson's checks; at least one source per lesson. `writeSnapshot(files: PackageFiles, dir: string): void` (sorted keys, 2-space JSON, LF, no timestamps; `content/snapshot/VERSION.json` holds `{ version, etag }`). `pullSnapshot(env): Promise<void>` (signed `GET course-server/packages/learn-wp-reimagined`, full flavour). `snapshot-fresh` runs only when `CONTENT_PULL_CHECK=1` and fails if a fresh pull differs.

- [ ] **Step 1: Write the failing tests**: `buildContent of the snapshot equals buildContentFromYaml of content/` (until Task 24 deletes YAML); each house rule has a failing fixture; `writeSnapshot is byte-stable across runs`; existing content harness tests (`tests/content/*-checks.test.ts`) pass unchanged against the snapshot.
- [ ] **Step 2:** Run `npx vitest run tests/scripts tests/content`. Expected: FAIL.
- [ ] **Step 3:** Implement; generate `content/snapshot/` and the fixture snapshot.
- [ ] **Step 4:** Run `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(content): build from a committed package snapshot`

### Task 21: WordPress course source in the studio

**Files:**
- Modify: `src/content.ts` (`wordpressSource`), `src/pages/Lesson.tsx` (`await adoptLatest()` before rendering a newly opened lesson, never mid-lesson)
- Test: `tests/content/course-source.test.ts` (extended), `tests/components/lesson.test.tsx`

**Interfaces:**
- Consumes: `GET /api/course` (Task 19), `CourseSource` (Task 7), `FEATURES.wordpressContent` (defined by Task 23).
- Produces: `wordpressSource: CourseSource` (`initial()` = baked bundle; `latest()` = `fetch('/api/course', { headers: { 'If-None-Match': etag } })`, `null` on 304 or any failure, 3 s timeout); the active source is `wordpressSource` when `FEATURES.wordpressContent`.

- [ ] **Step 1: Write the failing tests**: `a newer bundle never replaces content mid-lesson`; `it is adopted at the next lesson open`; `a failed fetch keeps the baked bundle`; `lesson open does not await the network when nothing is pending`.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(studio): read course updates from WordPress at lesson open`

### Task 22: Backend-view banner plugin

**Files:**
- Create: `wordpress/lwr-backend-view/lwr-backend-view.php`, `wordpress/lwr-backend-view/banner.css`, `scripts/zip-wp-plugin.ts`
- Modify: `scripts/assemble.ts` (copies `dist/wp-zips/*.zip`)
- Test: `tests/wordpress/backend-view.test.ts`

**Interfaces:**
- Produces: plugin slug `lwr-backend-view`, GPL-2.0-or-later; on singular `course` and `lesson` posts it prints, via `wp_body_open`, a banner: "This is the backend view: Sensei's own page for this lesson." plus a link "Take the lesson in the studio" to `https://learn-wp-reimagined.space.fast/learn/<stable key>` (course pages link to `/path/<stable key>`), and the "unofficial concept" sticker; styles use Inter, `#3858E9` / `#9FB1FF`, AA contrast, no W logo, wraps at 390px. `zipWpPlugin(dir: string, outDir = 'dist/wp-zips'): string` (zip named `<slug>-<Version header>.zip`).

Decision: the banner is a separate small plugin of ours, because Learning Ledger must not carry prototype-specific code.

- [ ] **Step 1: Write the failing test**: the PHP file hooks `wp_body_open` only when `is_singular( array( 'course', 'lesson' ) )`, escapes the URL with `esc_url`, contains the exact banner copy; `zipWpPlugin` names the zip from the Version header.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5: Commit** `feat(wordpress): backend-view banner for Sensei pages`

### Task 23: Pages: Sensei and the backend view

**Files:**
- Modify: `src/pages/HowItWorks.tsx`, `src/pages/Proposal.tsx`, `src/config.ts` (defines `FEATURES.wordpressContent: false`, consumed by Task 21)
- Test: `tests/components/how-it-works.test.tsx`, `tests/components/proposal.test.tsx`

Uses the approved phase 3 copy from `docs/page-copy-draft.md`: "What's real" names Sensei LMS with the pinned version (`SENSEI_VERSION = '4.26.4'` in `src/shared/course-meta.ts`) and links to the backend view (`/course/<block-theme course slug>/`); Proposal phase 1 section says lessons now live in Sensei. All new copy renders only when `FEATURES.wordpressContent` is true.

- [ ] **Step 1: Write the failing tests**: with the flag on, the backend-view link and Sensei version render; with it off, today's text is unchanged.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5: Commit** `feat(pages): Sensei as the content backend, behind its flag`

### Task 24: Provision Space A, migrate, prove the round trip, flip (controller step, needs owner)

- [ ] **Step 1:** Confirm G1 tags; record them in `vendor/course-xapi-mcp/VENDORED.json` (Task 14) and here.
- [ ] **Step 2:** `npx tsx scripts/keys.ts`; build the Learning Ledger and `lwr-backend-view` zips into `dist/wp-zips/`; with Derin, `sf publish dist`; `npx tsx scripts/provision.ts space-a`. Every step's status read must pass; Sensei 4.26.4 and Certificates 2.6.0 reported.
- [ ] **Step 3:** `npx tsx scripts/migrate-to-sensei.ts zip`, publish, `... run <packageUrl>`. **Gate: zero diffs for all 18 lessons.** Republish without the authoring zip afterwards.
- [ ] **Step 4:** `npm run content:pull`; `npm test`; the snapshot must equal the YAML (`compareBundles`). In one commit: delete `content/paths/**`, `scripts/yaml-content.ts` usages and the equality test, set `FEATURES.wordpressContent` and `SERVER_FLAGS.wordpressContent` to true. Commit `feat(content): WordPress is the source of truth` and push.
- [ ] **Step 5:** `npm run build && sf publish dist`. agent-browser: Sensei course and lesson pages show the banner and render no rubric, bug explanation or fix checks; an edit in wp-admin appears in the studio at the next lesson open within 5 minutes (or at once after the ping); speed compare within budget.

---

## Phase 4: learners in Sensei (after G2)

### Task 25: Sessions bound to headless Sensei learners

**Files:**
- Modify: `functions/_lib/ledger/connector.ts` (learner methods), `functions/_lib/session/session.ts` (`createSession` calls the connector), `functions/_lib/db.ts` (`enrolments`), `functions/_lib/events/decide.ts` (enrol on `placed` and on the first event in a path), `functions/api/session.ts` (DELETE also deletes the WordPress learner), `functions/_lib/config.ts` (`SERVER_FLAGS.senseiLearners`)
- Test: `tests/functions/connector.test.ts`, `tests/functions/session.test.ts`, `tests/functions/events.test.ts` (extended)

**Interfaces:**
- Produces on `ConnectorClient`: `createLearner(): Promise<{ userId: number; actor: { homePage: string; name: string } }>`; `enrol(userId: number, courseKey: PathId): Promise<void>`; `progress(userId: number, program: string): Promise<SenseiProgress>`; `deleteLearner(userId: number): Promise<void>`. `SenseiProgress = { enrolled: string[]; completedLessons: string[]; testedOutLessons: string[]; completedCourses: string[]; certificates: string[] }` (keys are stable ids). Table `enrolments(wp_user_id BIGINT, course_key VARCHAR(64), created BIGINT, PRIMARY KEY (wp_user_id, course_key))`; insert first, then call `enrol`; on duplicate key skip.
- With `senseiLearners` on, `POST /api/session` creates the learner first and uses its actor; `ConnectorUnavailable` → 503 `connector-unavailable`, no session, and the studio retries at the next recorded action (decision: nothing is recorded officially until a learner exists).

- [ ] **Step 1: Write the failing tests**: `session actor comes from the connector`; `connector down → 503 and no session row` (Review Focus 4); `enrols once per path` (two `placed` events → one `enrol` call); `enrol failure does not fail the event` (retried on the next event in that path); `DELETE session deletes the WordPress learner`.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npx vitest run tests/functions`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(api): sessions bound to headless Sensei learners`

### Task 26: Pages: "You get an anonymous account"

**Files:**
- Modify: `src/pages/HowItWorks.tsx`, `src/pages/Proposal.tsx`, `src/config.ts` (`FEATURES.senseiLearners`)
- Test: `tests/components/how-it-works.test.tsx`, `tests/components/proposal.test.tsx`

Approved phase 4 copy: "There are no accounts" becomes "You get an anonymous account" (random id, no email, created at your first recorded step, how to delete it). Proposal's "no accounts" design decision is replaced by the anonymous-user model. Renders only with the flag.

- [ ] **Step 1:** Failing tests for flag on/off copy. **Step 2:** Run, FAIL. **Step 3:** Implement. **Step 4:** Run, PASS.
- [ ] **Step 5: Commit** `feat(pages): anonymous accounts, behind their flag`

### Task 27: Ship phase 4 (controller step, needs owner)

- [ ] **Step 1:** Grant `create_learners`, `enrol`, `read_progress`, `delete_learners`, `read_packages` to key `course-server` through the plugin's WP-CLI command.
- [ ] **Step 2:** Flags on; `npm test && npm run build && sf publish dist`.
- [ ] **Step 3:** agent-browser: a fresh learner's first recorded action creates a Sensei user (confirm via the signed progress route) enrolled in that path; delete removes it; speed within budget.

---

## Phase 5: the record in the LRS, in shadow (after G3)

### Task 28: Provision the LRS space (controller step, needs owner)

- [ ] **Step 1:** Dispatch a subagent to extend `scripts/provision.ts` with `provisionSpaceB` and `tests/scripts/provision.test.ts` (same test pattern as Task 16; commit and push): `["plugin","deactivate","lwr-spike"]`, `["plugin","install",ledgerZipUrl,"--activate","--force"]`, `["learning-ledger","role","enable","lrs"]`, `["learning-ledger","client","create","--id=course-server","--secret-sha256=" + sha256(LRS_SECRET),"--scopes=all,void,courses/write,badges/claim-links,records/view-links,actors/erase"]`. `scripts/keys.ts lrs` writes `LRS_KEY=course-server` and a random `LRS_SECRET` to `.env.server` and prints only the hash.
- [ ] **Step 2:** With Derin, run it against `learn-wp-reimagined-lrs`; status at `https://lrs.sqwrlz.com/wp-json/learning-ledger/v1/status` shows the LRS role; `GET https://lrs.sqwrlz.com/xapi/about` answers with Basic auth.

### Task 29: LRS client

**Files:**
- Create: `functions/_lib/lrs/client.ts`
- Modify: `functions/_lib/env.ts` (`LRS_KEY?`, `LRS_SECRET?`), `functions/_lib/config.ts` (`LRS_XAPI = 'https://lrs.sqwrlz.com/wp-json/learning-ledger/xapi'`, `LRS_API = 'https://lrs.sqwrlz.com/wp-json/learning-ledger/v1'`), `vendor/course-xapi-mcp/` (re-vendor `core` at the G3 tag with Task 14's script)
- Test: `tests/functions/lrs-client.test.ts`

**Interfaces:**
- Produces: `class LrsClient { constructor(env: Env, fetchFn = fetch); putStatement(s: XapiStatement): Promise<void>; postStatements(s: XapiStatement[]): Promise<void>; getStatements(q: { agent: Actor; registration?: string; since?: string; limit?: number }): Promise<{ statements: XapiStatement[]; more?: string }>; getState(q: StateKey): Promise<{ body: unknown; etag: string } | null>; putState(q: StateKey, body: unknown, ifMatch?: string): Promise<{ etag: string } | { conflict: true }>; importCourse(zip: Uint8Array, etag: string): Promise<void>; eraseActor(actor: Actor, opts: { revokeBadges: boolean }): Promise<void>; mintViewLink(actor: Actor): Promise<string>; mintClaimLink(actor: Actor, badge: string): Promise<string>; listBadges(registration: string): Promise<BadgeSummary[]> }`. `StateKey = { activityId: string; agent: Actor; registration: string; stateId: string }`. Every xAPI call sends `Authorization: Basic base64(LRS_KEY:LRS_SECRET)` and `X-Experience-API-Version: 2.0.0`; timeout 3 s; `LrsUnavailable` on timeout or 5xx.

- [ ] **Step 1: Write the failing tests** with a fake fetch: headers on every call; `putStatement` uses `PUT ?statementId=`; 204 on an identical re-PUT is success; `putState` maps 412 to `{ conflict: true }`; `eraseActor` passes `revokeBadges`; never logs the secret.
- [ ] **Step 2:** Run. Expected: FAIL. **Step 3:** Implement. **Step 4:** Run. Expected: PASS.
- [ ] **Step 5: Commit** `feat(lrs): LRS client for the course server`

### Task 30: Official statements, registration, outbox and shadow posting

**Files:**
- Create: `functions/_lib/record/registration.ts`, `functions/_lib/record/official.ts`, `functions/_lib/lrs/outbox.ts`, `functions/api/lrs-drain.ts`
- Modify: `functions/_lib/events/decide.ts` (after deciding, build official statements and enqueue them; record shadow facts), `src/shared/events.ts` (adds `lessonOpened` and `lessonLeft` events), `functions/_lib/db.ts` (`lrs_outbox`, `au_sessions`, `shadow_facts`), `functions/_lib/session/session.ts` (`registration` column), `functions/_lib/course/cache.ts` (registers the LRS import with `onNewVersion`), `sf.jsonc` (cron `{ "path": "/api/lrs-drain", "schedule": "*/5 * * * *" }`), `functions/_lib/config.ts` (`SERVER_FLAGS.lrsShadow`)
- Test: `tests/functions/official.test.ts`, `tests/functions/outbox.test.ts`

**Interfaces:**
- Consumes: the vendored standard's statement builder (G3), `LrsClient` (Task 29), `deriveStatementId` (Task 5).
- Produces: `getRegistration(env: Env, s: Session): Promise<string>` (minted once per learner for the program, stored in the LRS State document the standard names, cached in `sessions.registration`); `buildOfficial(ctx: { actor: Actor; registration: string; bundle: ContentBundle; auSession: AuSession }, e: ServerEvent, r: EventResult & { ok: true }): XapiStatement[]` (cmi5 defined statements on `{au@id}/au`; `waived` reason Tested Out for placement skips and for lessons a `skip` branch jumps over; allowed `experienced`, `answered`, `branched`, `placed`, `caught` with the standard's category; learner-chosen marker when `chosenBy === 'learner'`; ids from `deriveStatementId(eventId, n)` offset past the phase 1 ids); `enqueue(env, statements): Promise<void>`; `drain(env, now, budgetMs): Promise<{ sent: number; left: number }>` (batches of 50, backoff 1, 5, 15, 60 minutes, rows deleted once stored); `recordShadowFact(env, actor, fact: LearningFact)` with `LearningFact = { lessonId: string; kind: 'completed' | 'waived' | 'branched' | 'caught' | 'placed' }`; `listShadowFacts(env, day: string): Promise<{ actor: string; facts: LearningFact[] }[]>`. Tables: `lrs_outbox(statement_id VARCHAR(36) PRIMARY KEY, body TEXT, created BIGINT, attempts INT, next_at BIGINT)`, `au_sessions(actor_name VARCHAR(64), au_key VARCHAR(120), session_id VARCHAR(36), started BIGINT, last BIGINT, PRIMARY KEY (actor_name, au_key))`, `shadow_facts(day VARCHAR(10), actor_name VARCHAR(64), lesson_id VARCHAR(120), kind VARCHAR(12))`.
- Delivery: if G0 probe 9 found `waitUntil` on the handler context, drain after responding; otherwise drain inline with an 800 ms budget and leave the rest to the cron. The drain cron also ends AU sessions idle for 30 minutes with `abandoned`. `GET /api/lrs-drain` requires `Authorization: Bearer <CRON_SECRET>` (same check as `functions/api/mcp-sweep.ts`). The studio still receives the phase 1 statements for its local record.

- [ ] **Step 1: Write the failing tests**: `placement skip emits one waived Tested Out per skipped lesson`; `a skip branch waives every jumped lesson`; `review marks nothing`; `learner-chosen fallback carries the marker`; `activity ids are {au@id}/au`; `re-enqueueing a statement id is a no-op` (Review Focus 1); `LRS down: the event still answers and the outbox keeps the row`; `drain deletes rows once stored and backs off on failure`; `idle AU session is abandoned by the cron`; `a new course version is imported into the LRS once`.
- [ ] **Step 2:** Run. Expected: FAIL. **Step 3:** Implement. **Step 4:** Run `npx vitest run tests/functions`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(record): official statements to the LRS in shadow`

### Task 31: Studio emits AU session events

**Files:**
- Modify: `src/pages/Lesson.tsx` (`lessonOpened` at open, `lessonLeft` on lesson change), `src/record/eventClient.ts` (`lessonLeft` also sent by beacon on `pagehide`)
- Test: `tests/components/lesson.test.tsx`, `tests/record/event-client.test.ts`

**Interfaces:**
- Consumes: `ServerEvent` variants `{ eventId; type: 'lessonOpened'; lessonId }` and `{ eventId; type: 'lessonLeft'; lessonId }` (Task 30 adds them to `src/shared/events.ts`; this task only sends them).

- [ ] **Step 1:** Failing tests: `opening a lesson sends lessonOpened without awaiting it`; `changing lesson sends lessonLeft for the previous one`; `pagehide beacons lessonLeft`. **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS.
- [ ] **Step 5: Commit** `feat(studio): AU session events`

### Task 32: Shadow comparison report

**Files:**
- Create: `functions/api/admin/shadow.ts`
- Test: `tests/functions/shadow.test.ts`

**Interfaces:**
- Consumes: `listShadowFacts` (Task 30), `LrsClient.getStatements` (Task 29).
- Produces: `GET /api/admin/shadow?day=YYYY-MM-DD` (Bearer `ADMIN_TOKEN`, as `functions/api/admin/spend.ts`) → `{ day, actors: number, diffs: { actor: string; missingInLrs: LearningFact[]; extraInLrs: LearningFact[] }[] }`; `factsFromStatements(s: XapiStatement[]): LearningFact[]`.

- [ ] **Step 1:** Failing tests: `zero diffs when the LRS holds every fact`; `reports a fact missing in the LRS`; `401 without the admin token`. **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS.
- [ ] **Step 5: Commit** `feat(admin): shadow record comparison`

### Task 33: Ship shadow mode and compare for a week (controller step, needs owner)

- [ ] **Step 1:** Confirm owner answer 13 is met (course-xapi-mcp public, IRIs resolve). `SERVER_FLAGS.lrsShadow = true`; publish (secrets `LRS_KEY`, `LRS_SECRET` via `.env.server`).
- [ ] **Step 2:** Daily `GET /api/admin/shadow` for 7 days or until zero diffs on 3 consecutive active days; share the report with Derin. Speed within budget.

---

## Phase 6: flip the record (after G4)

### Task 34: Official record API, export and LRS view link

**Files:**
- Create: `src/shared/official.ts`, `functions/api/record.ts`, `functions/api/record/export.ts`, `functions/api/record/view-link.ts`
- Modify: `functions/_lib/db.ts` (`record_cache`), `functions/_lib/config.ts` (`SERVER_FLAGS.officialRecord`)
- Test: `tests/shared/official.test.ts`, `tests/functions/record.test.ts`

**Interfaces:**
- Produces: `OfficialRecord = { completed: string[]; testedOut: string[]; carriedOver: string[]; branches: { from: string; to: string; outcome: Outcome }[]; badges: BadgeSummary[]; asOf: string }`; `projectOfficial(statements: XapiStatement[], bundle: ContentBundle): OfficialRecord` (a later `completed` removes a lesson from `testedOut`; carried-over waivers go only in `carriedOver`); `GET /api/record` (session required; cached in `record_cache(actor_name PRIMARY KEY, body TEXT, at BIGINT)`, invalidated by every decided event for that actor); `GET /api/record/export` → the standard's xAPI-statement export format, `Content-Disposition: attachment; filename="learn-wp-reimagined-record.json"`, labelled as a copy, plus files from the State document; `POST /api/record/view-link` → `{ url }` from `LrsClient.mintViewLink`.

- [ ] **Step 1:** Failing tests: `tested-out then completed counts as completed only`; `carried-over never appears as completed or testedOut`; `record is cached until the next event`; `export carries stored and authority`; `no session → 401`. **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS.
- [ ] **Step 5: Commit** `feat(record): official record, export and LRS view link`

### Task 35: Files and resume as State documents

**Files:**
- Create: `functions/api/state.ts`, `src/record/stateSync.ts`
- Modify: `src/record/useFileEdits.ts` (notifies `stateSync` after local writes), `src/finale/playground.ts` and `src/pages/Finale.tsx` (fall back to the State document when the local copy is empty)
- Test: `tests/functions/state.test.ts`, `tests/record/state-sync.test.ts`

**Interfaces:**
- Consumes: `LrsClient.getState/putState` (Task 29), `getRegistration` (Task 30), the standard's State ids for files and resume (G3).
- Produces: `GET /api/state/:kind` and `PUT /api/state/:kind` with `kind` in `files | resume`, passing `If-Match`; `STATE_MAX_BYTES = 2 * 1024 * 1024` → 413 `too-large` above it. `startStateSync(manager: RecordManager): () => void` (debounce `STATE_DEBOUNCE_MS = 2000` after the last edit, and on lesson change; on 412 refetch, merge newest-per-file using `fileLessons` timestamps, retry once).

- [ ] **Step 1:** Failing tests: `concurrent writers do not lose a file` (Review Focus 5); `over 2 MB returns too-large and the studio shows "Your files are too big to sync. They're still saved in this browser."` (Review Focus 5); `sync waits 2 s after the last edit`; `finale uses the State document when local files are empty`. **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS.
- [ ] **Step 5: Commit** `feat(record): files and resume sync to State documents`

### Task 36: Studio reads the official record

**Files:**
- Modify: `src/components/RecordPanel.tsx` (official record from `/api/record`, "Download my record", "View in the LRS", refresh on focus and a "Refresh" button, mounts `SenseiPanel` from Task 38), `src/studio/Outline.tsx` ("Tested out" marker), `src/record/store.ts` (remove the `'wordpress-org'` kind)
- Test: `tests/components/record-panel-official.test.tsx`, `tests/studio/studio.test.tsx`

**Interfaces:**
- Consumes: `OfficialRecord`, `projectOfficial` (Task 34), `SenseiPanel` (Task 38), `FEATURES.officialRecord` (defined by Task 41).

- [ ] **Step 1:** Failing tests: `outline marks tested-out lessons with visible text, not colour alone`; `panel shows completed and tested-out counts from the server`; `View in the LRS opens the minted URL in the same tab`; `refresh on window focus`. **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS.
- [ ] **Step 5: Commit** `feat(studio): the record panel shows the official record`

### Task 37: Carry over existing local records

**Files:**
- Create: `functions/api/carry-over.ts`, `src/components/CarryOverOffer.tsx`
- Modify: `src/app.tsx` (mounts `CarryOverOffer` once inside `Frame`)
- Test: `tests/functions/carry-over.test.ts`, `tests/components/carry-over.test.tsx`

**Interfaces:**
- Produces: `POST /api/carry-over` body `{ completedLessons: string[]; files: Record<string,string>; current?: { pathId; lessonId; beatIndex } }` → issues `waived` reason `Administrative` with extension `https://course-xapi-mcp.sqwrlz.com/xapi/extensions/carried-over` for each known completed lesson not already satisfied, writes files and resume to State; never posts old statements; once per actor (409 afterwards). The offer appears only when a v1 local record with progress exists and `FEATURES.officialRecord` is on: "Bring your progress over" / "Not now".

- [ ] **Step 1:** Failing tests: `carried-over lessons are waived Administrative with the extension`; `old statements are never posted`; `second call is 409`; `offer hidden when the local record has no progress`. **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS.
- [ ] **Step 5: Commit** `feat(record): carry over progress from the old local record`

### Task 38: "What Sensei sees" panel

**Files:**
- Create: `functions/api/sensei.ts`, `src/components/SenseiPanel.tsx`
- Test: `tests/functions/sensei.test.ts`, `tests/components/sensei-panel.test.tsx`

**Interfaces:**
- Consumes: `ConnectorClient.progress` (Task 25).
- Produces: `GET /api/sensei` → `SenseiProgress` for the session's learner (503 `connector-unavailable` when down); `export function SenseiPanel(): JSX.Element` (heading "What Sensei sees"; enrolment, completed and tested-out lessons by title; a link to the backend view; a placeholder slot for the certificate download filled by Task 50). Mounted by Task 36.

- [ ] **Step 1:** Failing tests: `lists tested-out lessons separately`; `connector down shows "Sensei isn't answering right now."`. **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS.
- [ ] **Step 5: Commit** `feat(studio): What Sensei sees`

### Task 39: Delete, retention and drift

**Files:**
- Create: `functions/_lib/session/lifecycle.ts`, `functions/api/sweep.ts`
- Modify: `functions/api/session.ts` (DELETE runs `eraseLearner`), `sf.jsonc` (cron `{ "path": "/api/sweep", "schedule": "daily" }`)
- Test: `tests/functions/lifecycle.test.ts`

**Interfaces:**
- Produces: `eraseLearner(env: Env, s: Session, opts: { revokeBadges: boolean }): Promise<void>` (order: `LrsClient.eraseActor`, then `ConnectorClient.deleteLearner`, then OAuth tokens (no-op until Task 43), then the session row); `sweep(env, now): Promise<{ expired: number; retained: number; drift: DriftReport }>`: deletes learners idle for 180 days with `revokeBadges: false`; drift compares, for each learner active that day, LRS satisfied and waived lessons with `SenseiProgress`; `DriftReport = { checked: number; mismatched: { actor: string; lrsOnly: string[]; senseiOnly: string[] }[] }` stored for `GET /api/admin/spend`'s sibling `GET /api/admin/drift`.

- [ ] **Step 1:** Failing tests: `delete my data erases in the LRS with revokeBadges true`; `retention erases with revokeBadges false`; `a failing step is retried on the next sweep, not skipped`; `drift reports a lesson complete in the LRS but not Sensei`. **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS.
- [ ] **Step 5: Commit** `feat(api): delete my data, 180-day retention and the drift check`

### Task 40: Sensei latency probe

**Files:**
- Create: `scripts/latency-probe.ts`
- Test: `tests/scripts/latency-probe.test.ts`

**Interfaces:**
- Produces: `p95(ms: number[]): number`; `probe(base: string, runs = 20): Promise<{ p50: number; p95: number; max: number }>` (creates a session, completes a short lesson through `/api/events`, polls `/api/sensei` every 2 s until that lesson shows complete, then deletes the learner). Pass: p95 ≤ 90 000 ms.

- [ ] **Step 1:** Failing tests for `p95` and the polling timeout. **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS.
- [ ] **Step 5: Commit** `chore(scripts): Sensei latency probe`

### Task 41: Pages: where the record lives

**Files:**
- Modify: `src/pages/HowItWorks.tsx`, `src/pages/Proposal.tsx`, `src/shared/course-meta.ts` (`RETENTION_DAYS = 180`, `LRS_HOST = 'lrs.sqwrlz.com'`), `src/config.ts` (defines `FEATURES.officialRecord: false`, consumed by Tasks 36 and 37)
- Test: `tests/components/how-it-works.test.tsx`, `tests/components/proposal.test.tsx`

Approved phase 6 copy (§6.4): progress is stored on our servers under a random id, kept in a separate LRS at `lrs.sqwrlz.com`; deleted after 180 idle days; how to export; how to delete; free-text answers are kept. Numbers come from `course-meta.ts`. Flag `FEATURES.officialRecord`.

- [ ] **Step 1:** Failing tests for flag on/off copy and the numbers. **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS.
- [ ] **Step 5: Commit** `feat(pages): where your record lives, behind its flag`

### Task 42: Pair connector and LRS, flip, measure (controller step, needs owner)

- [ ] **Step 1:** On Space A: `["learning-ledger","connector","connect","--lrs=https://lrs.sqwrlz.com","--client=connector-a"]`; read the connector's secret hash from the status route; on the LRS: `["learning-ledger","client","create","--id=connector-a","--secret-sha256=<hash>","--scopes=statements/read"]` and the subscription for actor homePage `https://learn-wp-reimagined.space.fast` via the plugin's command; direction 2 off for this program.
- [ ] **Step 2:** Flags `officialRecord` on (server and client); publish.
- [ ] **Step 3:** `npx tsx scripts/latency-probe.ts https://learn-wp-reimagined.space.fast` → p95 ≤ 90 s. Daily drift zero for 3 days. agent-browser pass of the record panel, carry-over, delete and Sensei panel at both viewports, keyboard only. Speed within budget.

---

## Phase 7: agent path on the standard (after G5)

### Task 43: MCP authorization server

Consumes G0 probe 3 (how `/.well-known/*` reaches Functions).

**Files:**
- Create: `functions/_lib/oauth/store.ts`, `functions/_lib/oauth/pkce.ts`, `functions/api/oauth/register.ts`, `functions/api/oauth/authorize.ts`, `functions/api/oauth/consent.ts`, `functions/api/oauth/token.ts`, `functions/api/oauth/revoke.ts`, `functions/api/oauth/metadata.ts`
- Modify: `functions/_lib/db.ts` (`oauth_clients`, `oauth_codes`, `oauth_tokens`), `sf.jsonc` (rewrites `/.well-known/oauth-protected-resource` and `/.well-known/oauth-authorization-server` to `/api/oauth/metadata`, and `/consent` to `/index.html`), `src/pages/appRoutes.ts` (adds `/consent`), `functions/_lib/session/lifecycle.ts` (`eraseLearner` revokes tokens)
- Test: `tests/functions/oauth.test.ts`

**Interfaces:**
- Produces: `resolveToken(env: Env, req: Request, now: number): Promise<{ actor: Actor; wpUserId: number; registration: string } | null>`; `ACCESS_TTL_S = 3600`, `REFRESH_IDLE_MS = 30 * 24 * 60 * 60 * 1000`, `CODE_TTL_MS = 60_000`, scope `course`. Dynamic client registration (open, rate-limited `oauth:reg:<clientKey>` 20 per 10 min; redirect URIs must be `https:` or loopback `http://127.0.0.1` / `http://localhost`); `authorize` validates client, exact redirect URI, `code_challenge_method=S256` only, then 302 to `/consent?request=<id>`; `POST /api/oauth/consent` `{ request, decision: 'allow' | 'cancel' }` reads the studio session (creates the learner when there is none, Task 25) and returns `{ redirect }`; `token` handles `authorization_code` (single use) and `refresh_token` (rotating); `revoke` and `POST /api/oauth/revoke-all` (session) for "Disconnect agents"; metadata per RFC 9728 (resource `https://learn-wp-reimagined.space.fast/api/mcp`) and RFC 8414. Tokens and codes stored as SHA-256 only.

- [ ] **Step 1:** Failing tests: `plain PKCE is refused`; `a code works once and expires after 60 s`; `redirect URI must match exactly`; `refresh rotates and the old one stops working`; `idle refresh token expires after 30 days`; `consent without a session creates the learner and sets the cookie`; `revoke-all ends every token for the actor`; `metadata documents point at each other`. **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS.
- [ ] **Step 5: Commit** `feat(oauth): MCP authorization server for the course`

### Task 44: Consent page

**Files:**
- Create: `src/pages/Consent.tsx`
- Modify: `src/app.tsx` (`<Route path="/consent" component={Consent} />`)
- Test: `tests/components/consent.test.tsx`

**Interfaces:**
- Consumes: `POST /api/oauth/consent` (Task 43); the client name comes from `GET /api/oauth/consent?request=<id>` → `{ clientName, hasSession }`.

Copy: heading "Let <clientName> continue your course as you?"; body states it can read your progress and record steps, never change your record by hand, and that "Disconnect agents" in the record menu ends it; buttons "Allow" and "Cancel". No login form. Keyboard first: focus on the heading; both buttons reachable; 390px without horizontal scroll.

- [ ] **Step 1:** Failing tests: `Allow posts allow and follows the redirect`; `Cancel posts cancel`; `client name is escaped text`. **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS.
- [ ] **Step 5: Commit** `feat(studio): consent page for agent sign-in`

### Task 45: Swap the MCP server to the standard's reference server

**Files:**
- Modify: `vendor/course-xapi-mcp/` (vendor `server` at the G5 tag), `functions/_lib/mcp/handler.ts` (with `SERVER_FLAGS.agentOnStandard` on: the standard's server with host pieces; off: today's server), `functions/_lib/mcp/gate.ts` (limits keyed by token hash instead of record handle), `functions/api/mcp.ts` (401 + `WWW-Authenticate: Bearer resource_metadata="https://learn-wp-reimagined.space.fast/.well-known/oauth-protected-resource"` without a token), `scripts/verify-mcp.ts` (OAuth flow against a base URL), `functions/_lib/config.ts` (`SERVER_FLAGS.agentOnStandard`)
- Test: `tests/functions/mcp-standard.test.ts`, `tests/helpers/mcpClient.ts` (token support)

**Interfaces:**
- Consumes: `resolveToken` (Task 43); course source = the full package from `course_cache` (Task 19); custody = option 2 through `decideEvents` (Task 5) and `LrsClient` (Task 29), so agent calls take the same decide-and-record path as the studio; `getRegistration` (Task 30).
- Produces: `/api/mcp` advertising `com.sqwrlz/course-xapi-mcp`, custody `author-lrs`, no `link_record`, `get_badges` returning the claim-page URL `https://learn-wp-reimagined.space.fast/badges/claim`.

- [ ] **Step 1:** Failing tests: `no token → 401 with resource metadata`; `get_status reports custody author-lrs`; `an agent check_code is recorded through decideEvents`; `get_lesson never includes the bug explanation or fix checks before caught or reveal_bug after 3 failed attempts`; `link_record is not listed`; `get_badges returns the claim page URL, never a claim link`. **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS.
- [ ] **Step 5: Commit** `feat(mcp): course-xapi-mcp reference server with option 2, behind its flag`

### Task 46: Agent UX: Connect, hand-off and "Disconnect agents"

**Files:**
- Modify: `src/pages/Connect.tsx`, `src/agent/clients.ts`, `src/components/AgentHandoff.tsx`, `src/shared/course-meta.ts` (`agentPrompt(lessonTitle: string): string` replaces the handle version), `src/components/RecordPanel.tsx` ("Disconnect agents" button only; no other change), `src/config.ts` (`FEATURES.agentOnStandard`)
- Test: `tests/components/connect.test.tsx`, `tests/components/agent-flag-off.test.tsx`

**Interfaces:**
- Consumes: `POST /api/oauth/revoke-all` (Task 43).

Copy: "paste your handle" becomes "sign in when your agent asks"; "Continue in your agent" shows the MCP URL and the prompt naming the lesson; `ImportAgentProgress` is hidden with the flag on.

- [ ] **Step 1:** Failing tests for flag on/off copy, no handle anywhere with the flag on, and the disconnect call. **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS.
- [ ] **Step 5: Commit** `feat(agent): sign in when your agent asks`

### Task 47: Relay decision, ship, client checks (controller step, needs owner)

- [ ] **Step 1:** Count `mcp_records` rows touched in the last 30 days; Derin decides: none with real users → table dropped in Task 52; otherwise a "Bring back your agent's progress" flow (same rules as Task 37) live for 30 days, planned as a follow-up task.
- [ ] **Step 2:** Flags `agentOnStandard` on; publish; `npx tsx scripts/verify-mcp.ts https://learn-wp-reimagined.space.fast`.
- [ ] **Step 3:** Client checks: Claude Code (`claude mcp add --transport http learn-wp-reimagined https://learn-wp-reimagined.space.fast/api/mcp`, sign in, resume a lesson at the same beat with the same files, then remove), Claude.ai connector, and ChatGPT developer mode (Derin signs in once in an agent-browser window; the agent runs the connector test; then the connector is removed; owner answer 21). Agent progress appears in the studio after refresh and in Sensei within 90 s. Any client that fails is named on the Connect page.

---

## Phase 8: badges, certificates, pages, cleanup (after G6)

### Task 48: Badge issuer on the LRS (controller step, needs owner)

- [ ] **Step 1:** Confirm G0 probes 5 and 7 passed at `lrs.sqwrlz.com` (the did:web identity is permanent; do not issue otherwise).
- [ ] **Step 2:** On the LRS via WP-CLI: `["learning-ledger","badges","keygen"]` and set the issuer name "Learn WordPress, reimagined" with the plugin's command. Verify `https://lrs.sqwrlz.com/.well-known/did.json` resolves `did:web:lrs.sqwrlz.com`. The program's declarations from Task 15 are already imported (re-import via the content-changed ping if not).

### Task 49: Badges in the studio

**Files:**
- Create: `functions/api/badges.ts`, `functions/api/badges/claim-link.ts`, `src/pages/BadgeClaim.tsx`
- Modify: `src/pages/appRoutes.ts` and `sf.jsonc` (`/badges/*`), `src/app.tsx` (route `/badges/claim`), `src/components/RecordPanel.tsx` (badges list), `src/components/CompletedSummary.tsx` (claim link), `functions/_lib/config.ts` and `src/config.ts` (`badges` flag)
- Test: `tests/functions/badges.test.ts`, `tests/components/badge-claim.test.tsx`

**Interfaces:**
- Consumes: `LrsClient.listBadges`, `LrsClient.mintClaimLink` (Task 29).
- Produces: `GET /api/badges` → `BadgeSummary[]` (`{ id: string; pathId: PathId; name: string; status: 'pending' | 'claimed'; testedOut: number }`); `POST /api/badges/claim-link` `{ badge }` → `{ url }` (fresh link per call, session required); `/badges/claim?badge=<id>` page: explains what the badge is and that Sensei's certificate is a document while the badge is a verifiable credential, then "Claim on the LRS" navigates top-level to the minted URL. The claim link is never stored or shown as text.

- [ ] **Step 1:** Failing tests: `claim-link requires a session`; `each call mints a new link`; `claim page navigates to the minted URL`; `badges list shows the tested-out count in words`. **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS.
- [ ] **Step 5: Commit** `feat(badges): claim path badges from the studio`

### Task 50: Sensei certificate download

Consumes G0 probe 4 (headless certificate rendering).

**Files:**
- Create: `functions/api/sensei/certificate.ts`
- Modify: `functions/_lib/ledger/connector.ts` (`certificate(userId: number, courseKey: PathId): Promise<Response>`), `src/components/SenseiPanel.tsx` (download link per completed path, or, if probe 4 failed, "Sensei has issued your certificate." without a download)
- Test: `tests/functions/certificate.test.ts`, `tests/components/sensei-panel.test.tsx`

**Interfaces:**
- Produces: `GET /api/sensei/certificate?path=<PathId>` → streams the PDF (`Content-Type: application/pdf`, `Content-Disposition: attachment; filename="<path>-certificate.pdf"`), 404 when the course is not complete, session required.

- [ ] **Step 1:** Failing tests: `streams the connector's PDF`; `404 before course completion`; `401 without a session`. **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS.
- [ ] **Step 5: Commit** `feat(studio): download your Sensei certificate`

### Task 51: Pages: final rewrite

**Files:**
- Modify: `src/pages/Proposal.tsx`, `src/pages/HowItWorks.tsx`
- Test: `tests/components/proposal.test.tsx`, `tests/components/how-it-works.test.tsx`

Approved phase 8 copy (§10 rows): Proposal phases 1 to 3 shown as demonstrated with links to the code and the running pieces, new sections on the standard, Learning Ledger and why the LRS is separate, `Cite` sources updated to the new files; How this works "What's real" adds Sensei certificates, the real LRS at `lrs.sqwrlz.com` and badges, "What's concept" keeps the unofficial, not affiliated, not reviewed by the Training Team and Sensei-front-end-is-not-the-learner-experience lines; the revoked-badge-stops-verifying sentence. Rate limits and retention come from config constants (as `MCP` does today, updated to token-based limits).

- [ ] **Step 1:** Failing tests: every `Cite` points at a file that exists (glob check); no claim of "runs on Sensei" without its flag; the revoked-badge sentence renders. **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS.
- [ ] **Step 5: Commit** `feat(pages): Proposal and How this works describe the running architecture`

### Task 52: Cleanup

**Files:**
- Delete: `functions/_lib/mcp/course.ts`, `functions/_lib/mcp/seed.ts`, `functions/_lib/mcp/recordStore.ts`, `functions/_lib/mcp/agentApi.ts`, `functions/api/agent/handoff.ts`, `functions/api/agent/record.ts`, `functions/api/agent/delete.ts`, `functions/api/mcp-sweep.ts` (and its `sf.jsonc` cron), `src/agent/importRecord.ts`, `src/components/ImportAgentProgress.tsx`, `src/agent/client.ts` relay calls, `vendor/learning-mcp/`, `scripts/vendor-learning-mcp.ts`, and their tests (`tests/functions/agent-endpoints.test.ts`, `mcp-course.test.ts`, `mcp-store.test.ts`, `tests/agent/importRecord.test.ts`)
- Modify: `src/config.ts` and `functions/_lib/config.ts` (remove every phase flag, keeping the on-paths), `functions/_lib/db.ts` (`DROP TABLE IF EXISTS mcp_records` in a one-time migration step, unless Task 47 kept the relay), `functions/api/sweep.ts` (session and OAuth token expiry)
- Test: `npm test`

- [ ] **Step 1:** Remove the code; run `grep -rn "SERVER_FLAGS\.\|FEATURES\.\(serverEvents\|sessions\|wordpressContent\|senseiLearners\|lrsShadow\|officialRecord\|agentOnStandard\|badges\)" src functions` → no matches.
- [ ] **Step 2:** Run `npm test && npm run build`. Expected: PASS, every route bundle under 8 MiB.
- [ ] **Step 3: Commit** `chore: remove phase flags, the relay and the old vendored server`

### Task 53: Final verification (controller step, needs owner)

- [ ] **Step 1:** Publish to Space A. agent-browser (never Puppeteer or Playwright): the five-minute walkthrough (placement changes the path, predict, explain, catch the bug, edit by hand, Playground preview, finale) at 1440x900 and 390x844 with no horizontal scroll; keyboard-only pass of every new page and panel; `prefers-reduced-motion`; AA contrast on the banner, consent, claim and LRS pages; no W logo; sticker present.
- [ ] **Step 2:** One lesson finished in the studio and one in an agent show as the same fact in the studio, Sensei and the LRS; Sensei within 90 s p95 (`scripts/latency-probe.ts`); drift zero; speed within budget.
- [ ] **Step 3:** Report to Derin. Push to `production` only if Derin says so (`git push origin main:production`).
