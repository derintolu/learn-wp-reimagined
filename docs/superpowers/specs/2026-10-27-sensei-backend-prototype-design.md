# Learn WordPress, Reimagined on Sensei, course-xapi-mcp and Learning Ledger: Design

Date: 2026-10-27
Status: draft for Derin's review (revision 2: owner answers of round 2 and the cross-design rulings applied)
Owner: Derin (derintolu)
Supersedes: nothing. The original design (`2026-10-19-learn-wp-reimagined-design.md`) still holds the product vision: the success test (§1), audiences (§2), look (§6), anti-goals (§5) and spending cap (§8). This document changes where content, identity and the record live, and how the agent path works.

Binding input: the owner's decisions of 2026-10-27, including the round 2 answers that supersede the earlier ones (`scratchpad/designs/decisions.md`), and the controller's cross-design rulings (`scratchpad/designs/reconciliation.md`). Anything not in the owner's decisions is marked **Builder's call**, with a one-line reason and what it costs if it is wrong. A builder's call that adopts a cross-design ruling is marked **Builder's call (reconciliation N)**. Every builder's call stays provisional until Derin approves this document (reconciliation 15).

Companion designs, written in parallel and referred to here by role:

- **the standard**: course-xapi-mcp, a cmi5-based open spec for courses that learners take in their own agent (`learning-mcp/docs/superpowers/specs/2026-10-27-course-xapi-mcp-design.md`). Its permanent IRIs live under `https://course-xapi-mcp.sqwrlz.com/`, and its MCP extension identifier is `com.sqwrlz/course-xapi-mcp`;
- **the plugin**: **Learning Ledger** (slug `learning-ledger`, repo `derintolu/learning-ledger`), the WordPress plugin with an LRS role, an LMS connector role and a built-in Sensei integration (`scratchpad/designs/2026-10-27-wordpress-lrs-plugin-design.md`).

§11 lists what this prototype needs from each, so the three documents can be reconciled. Where a companion design still differs from the rulings, the rulings win.

---

## 1. Intent

The prototype stops being a standalone demo and becomes **the proof that the standard, the plugin and Sensei work together**, arranged the way learn.wordpress.org could adopt them.

Learn runs on Sensei LMS with a block theme (the 2024 redesign; source: https://github.com/WordPress/Learn). A real adoption would not replace Sensei. It would add a learning layer beside it: placement, branching, a tutor, a course that runs in the learner's own agent, and an official xAPI record with badges in a separate LRS. The rebuilt prototype is that arrangement at small scale:

- Sensei holds the courses, lessons, learners, enrolment, completion and certificates, as it does on Learn.
- Our layer adds what Sensei can't do: adaptive placement and branching, beats, checkpoints, rubrics, checks, planted bugs, the tutor and the MCP course server.
- A separate LRS holds the official record and signs the badges.

The visitor still sees the same studio. What changes is that each claim on the Proposal page ("a tutor and placement layer beside Sensei", "progress written to Sensei") is now running, not just described.

**The original success test still applies, unchanged.** After five minutes a visitor believes: AI can enhance learning (it visibly changes their path), coding is still essential (predict, explain, catch the bug, edit by hand), and WordPress can still innovate. None of the new plumbing may get in the way of those five minutes.

**A second, technical test is added for the Training Team reader.** A lesson finished in the studio or in an agent shows up as the same fact in three places (the studio, Sensei's own progress for that learner, and the LRS). The LRS has it at once. Sensei has it within **90 seconds at p95**, with 30 seconds as an aim rather than a gate (**Builder's call (reconciliation 11)**). The three never disagree for longer than one catch-up cycle (§7.5).

## 2. Goals

1. **Same studio, same feel.** The outline, the conversation, the live WordPress Playground preview, placement, the tutor, the catch-the-bug moment and the 390px layout look and behave as they do today.
2. **Sensei is the content and learner backend.** All 18 lessons on the three paths live in Sensei on the `learn-wp-reimagined` space's built-in WordPress, and the studio reads them from there.
3. **The course-xapi-mcp parts live on Sensei lessons**: beats, checkpoints, rubrics, checks and planted bugs, attached through Learning Ledger's Sensei integration as `learning-ledger/*` blocks.
4. **Record option 2.** The official record is in the LRS space at `lrs.sqwrlz.com`, written only by the course server. The learner can view and export it, and can never alter it.
5. **Sensei reflects the record.** Completion flows LRS → connector → Sensei. Lessons skipped by placement or branching show as complete and are marked "tested out".
6. **The agent path runs on the standard.** "Continue in your agent" works in Claude, ChatGPT developer mode, Claude Code and other MCP clients, signed in through MCP authorization. Agent progress appears in the studio and in Sensei.
7. **Open Badges 3.0**, signed by the LRS as "Learn WordPress, reimagined", claimable from the studio, with Sensei's PDF certificate alongside.
8. **Honest pages.** The Proposal and How this works pages describe the new architecture accurately: what is real, what is concept, and where the record lives.

## 3. Non-goals, anti-goals

### 3.1 Non-goals (in addition to the original §4, minus the two this design reverses)

The original non-goals "user accounts or sign-in" and "integration with Sensei" are reversed by the owner's decisions. The rest still hold (no translations, no lesson authoring UI of our own, no whole courses). New non-goals:

- **Learners using Sensei's own front end, or logging in to WordPress.** Learners are headless WordPress users: they have a WordPress account that Sensei tracks, but they never sign in to WordPress. Sensei's pages are public and visible as "the backend view", without per-learner progress (§5.6). Learners use the studio.
- **Other LMS integrations** (LifterLMS, Tutor LMS, LearnPress and so on) in the prototype. They belong to the plugin's roadmap.
- **Sign-in with WordPress.org.** The prototype can't get a WordPress.org OAuth client, and the owner hasn't asked for one.
- **Full ADL LRS conformance or cmi5 CATAPULT certification** as a prototype gate. Those belong to the plugin and the standard. The prototype states whatever results they publish.
- **OB 2.0, LTI and CLR transcripts.**
- **Moving the AI.** Placement, judging, tutor and feedback stay on Spacefast Functions and Workers AI.

### 3.2 Anti-goals: failure even if it works

The original anti-goals still apply: generic chatbot, code without understanding, looking official, stuffy or dated, exposed or drained key, an agent experience worse than the site, a fragile live demo. New ones:

- **Two sources of truth.** Sensei and the LRS disagree about what a learner has done, or the studio shows a third answer. There must be exactly one write path for learning facts (§7.2).
- **The studio gets slower.** Opening a lesson, advancing a beat or editing a file waits on WordPress or the LRS. Network round trips to the other space must never block beats or typing.
- **The agent path breaks or gets worse.** Connecting gets fiddlier than one sign-in, an agent can no longer resume, or the agent sees spoilers (planted-bug answers) it didn't see before.
- **The learner can forge the record.** Any path where a browser or an agent can make the LRS say something the course server didn't decide. That includes "the client says the checks passed".
- **Accounts by stealth.** Creating WordPress users that hold personal data, track people across sites, or can't be deleted.
- **WordPress becomes a single point of failure.** If either WordPress install is slow or down, lessons must still open and progress must still be recorded later.
- **Secrets in logs.** Spacefast writes every WP-CLI run to the space's activity trail, so a secret passed as a WP-CLI argument is a leaked secret.
- **The prototype bends the standard or the plugin.** Prototype-specific hacks inside either one. Prototype-only fields go in a namespaced extension that the standard allows (§11.1, S1).
- **Overclaiming.** The pages say "runs on Sensei like Learn" for anything that is faked, simulated or not yet working.

## 4. Architecture: two Spacefast spaces

### 4.1 What runs where

```
 Learner's browser                     Learner's own agent (Claude, ChatGPT, Claude Code...)
        |  same origin                          |  MCP Streamable HTTP + MCP authorization (OAuth 2.1)
        v                                       v
+------------------------- Space A: learn-wp-reimagined (existing) -------------------------+
|  Static app (studio, pages, consent page, badge claim page)                                |
|  Functions /api/*  = course server: placement, judge, tutor, feedback, budget,             |
|                      events -> statements, sessions, /api/mcp (the standard's server),     |
|                      MCP authorization server                                              |
|  env.DB (space MySQL): spend, rate limits, sessions, OAuth clients and tokens,             |
|                        course cache, outbox                                                |
|  Built-in WordPress 7.1.x: Sensei LMS + Sensei LMS Certificates                            |
|                            + Learning Ledger in CONNECTOR role (+ Sensei integration)      |
+-------------------------------------------------------------------------------------------+
        | xAPI (statements, state, agent profile) + course import     ^ notification (webhook)
        v                                                             |  + periodic catch-up poll
+------------------------- Space B: the LRS, served at lrs.sqwrlz.com (new) ----------------+
|  Built-in WordPress 7.1.x: Learning Ledger in LRS role only                                |
|  xAPI endpoint, imported course tree, badge issuer (did:web:lrs.sqwrlz.com, issuer        |
|  profile "Learn WordPress, reimagined", achievements, status list),                        |
|  badge claim and public badge pages                                                        |
+-------------------------------------------------------------------------------------------+
```

**Space A, `learn-wp-reimagined`**, keeps its name and URL (`https://learn-wp-reimagined.space.fast`), so the existing xAPI actor `homePage` stays valid and today's lesson IRIs become the AU ids (§5.3). It runs:

- the static app;
- Spacefast Functions acting as **the course server** (a host for the standard's reference server plus our AI endpoints and the MCP authorization server). In cmi5 terms the course server is the party that mints registrations and issues `launched`, `waived` and `satisfied`, so it is the only writer of learner statements to the LRS (**Builder's call (reconciliation 3)**);
- the space's built-in WordPress, with Sensei LMS, Sensei LMS Certificates and Learning Ledger in connector role. This is the "Learn site" in miniature.

**Space B, the LRS**, is new. It is a claimed, public space whose WordPress runs Learning Ledger in LRS role only, served at **`lrs.sqwrlz.com`** (owner decision), with the domain pointed at the space. The owner decided on a separate install because a busy LRS slows its site, and the prototype mirrors that recommended setup. The badge issuer identity is `did:web:lrs.sqwrlz.com` for as long as badges exist, so sqwrlz.com must stay renewed. **Builder's call:** the space itself is named `learn-wp-reimagined-lrs`. Reason: it reads as part of the same demo in the Spacefast dashboard. Cost if wrong: a rename, which the public hostname hides.

### 4.2 Who talks to whom

| From → to | What | Transport |
| --- | --- | --- |
| Browser → Functions | everything: course, events, AI, sessions, record, badges, certificates, the consent page's decision | same origin, `/api/*` |
| Browser → Space A WordPress | Sensei's public course and lesson pages only ("the backend view", top-level links). No API calls, and never a WordPress login | links (**Builder's call**: one origin and one auth model for the browser; it avoids WordPress cookie and nonce handling in a SPA. Cost if wrong: an extra proxy hop for reads that could have gone direct, which caching hides.) |
| Browser → LRS | badge claim and public badge pages, and "View in the LRS" record pages (top-level navigation) | links |
| Agent → Functions | `/api/mcp`, plus the MCP authorization endpoints | MCP Streamable HTTP, OAuth 2.1 |
| Functions → Space A WordPress | read the program export, create and look up learner users, enrol, read Sensei progress for display and drift checks, fetch a learner's certificate PDF, delete a learner | Learning Ledger's connector routes, Ed25519-signed requests (§4.3) |
| Functions → LRS | write and void statements, read statements, State and Agent Profile documents, import the course package, mint badge claim links and record view links, erase an actor | xAPI and Learning Ledger's API over HTTPS, Basic auth with a course-server credential |
| LRS → connector | "new statements for actor X" | the plugin's notification (webhook), signed |
| Connector → LRS | catch-up poll (`since`) only. Direction 2 (Sensei on-site learning as xAPI) is **off** for this course | xAPI, read-only connector credential |
| Connector → Sensei | lesson and course completion, enrolment, users | Sensei PHP APIs in-process (§5.2) |

The course server never writes Sensei progress directly, and the connector never writes this course's learner statements. Sensei is changed only by the connector, from what the LRS holds, and the connector never re-emits a Sensei change it applied from the LRS. That gives one write path: **course server → LRS → connector → Sensei** (**Builder's call (reconciliation 3)**).

### 4.3 Secrets and auth between the pieces

The rule (**Builder's call (reconciliation 10)**): **secrets never cross WP-CLI; only public keys and hashes do.** Reason: Spacefast records every WP-CLI run in the activity trail, and WP-CLI is the only way we configure WordPress on Spacefast (no `eval`, output not returned). No `wp config set` of a secret, ever. Cost if wrong: a slightly more involved pairing step than "paste a secret".

- **Functions → connector.** Functions hold an Ed25519 private key as a Spacefast secret (`CONNECTOR_SIGNING_KEY`). The connector stores only the matching **public** key, set through the plugin's WP-CLI command. Requests carry a signature over method, path, body hash and a timestamp, with a 5-minute window and nonce replay protection (**Builder's call (reconciliation 9)**; the exact scheme is the plugin's to specify).
- **Functions → LRS.** xAPI requires Basic auth. The course server's key and secret are generated locally, stored as Spacefast secrets (`LRS_KEY`, `LRS_SECRET`), and **only the SHA-256 of the secret** is registered with the LRS via WP-CLI. The credential is scoped: write and void statements for actors under `https://learn-wp-reimagined.space.fast`, read them, read and write State and Agent Profile documents, `courses/write`, `badges/claim-links`, `records/view-links` and `actors/erase`. The course server is the only party that can void.
- **Connector → LRS.** The connector generates its own LRS secret on the Space A install and exposes only its hash through its status route. Provisioning reads the hash and registers it on the LRS. The credential is read-only (`statements/read` for the catch-up poll), with no `statements/write`, because direction 2 is off for this course.
- **LRS → connector notifications.** The LRS signs them with its own key, and the connector verifies against the LRS's published public key, pinned by URL at setup.
- **Agent → Functions.** MCP authorization (§8.2): OAuth 2.1 access tokens issued by the course server, opaque, short-lived, stored hashed in env.DB as today's handles are.
- **Browser → Functions.** A session cookie (§6.3).

Spacefast secrets in Space A grow from the current set (Workers AI token, cron secret, admin key) to also include `SESSION_KEY`, `CONNECTOR_SIGNING_KEY`, `LRS_KEY` and `LRS_SECRET`. That is well under the 64-key limit.

### 4.4 Deployment

- **The app and Functions** publish as today (`npm run build`, then `sf publish dist`).
- **WordPress in both spaces** is configured with WP-CLI only, through `POST /v1/spaces/{id}/wp-cli`:
  - Sensei LMS and Sensei LMS Certificates from wordpress.org: `["plugin","install","sensei-lms","--activate"]` and `["plugin","install","sensei-certificates","--activate"]` (Space A only);
  - Learning Ledger from a zip published as a file of the space, fetched through a share link (`["plugin","install","<zip URL>","--activate","--force"]`), as the spike proved;
  - role and settings through the plugin's WP-CLI commands (`wp learning-ledger ...`).
- **Version pinning.** Sensei is pinned to an exact version (`--version=4.26.4` today) and Sensei LMS Certificates likewise (`--version=2.6.0`). The plugin zip carries its version in the file name.
- **A `scripts/provision.ts`** (**Builder's call**: idempotent, re-runnable, reviewed in git; cost if wrong: none beyond writing it) runs the WP-CLI sequence for each space. Because WP-CLI returns only success or failure, each step is followed by a read through the plugin's REST status route, which reports versions, role, pairing state, credential hashes to register, Sensei and Certificates presence, and sodium availability.
- **Course import into the LRS.** The course server imports the package into the LRS (`courses/write`) on each publish and on each content-changed ping, so the LRS always holds the current course tree and badge declarations (**Builder's call (reconciliation 4)**).
- **Republish safety.** Plugins survive republishing (spike). Course content in Sensei is data, so a republish doesn't touch it.

### 4.5 Routing inside Space A: must be proven first

Published files serve in front of WordPress, and `sf.jsonc` today has a catch-all `fallback` to `index.html` with status 200. That fallback may shadow `/wp-json/*` and any WordPress front-end URL. The spike reached `/wp-json` on a space with a plain `index.html`, but not on a space with Functions and a SPA fallback.

**Builder's call:** replace the catch-all fallback with explicit rewrites for the app's routes (`/`, `/paths/*`, `/lessons/*`, `/connect`, `/consent`, `/badges/*`, `/proposal`, `/how-it-works`, `/finale`), so `/wp-json/*`, `/wp-admin/*`, `/wp-login.php` and Sensei's own `/course/*` and `/lesson/*` pages fall through to WordPress. Reason: the app has a short, known route list. Cost if wrong: a new app route that someone forgets to add returns WordPress's 404 instead of the app; a test over `routes.tsx` guards against that.

MCP authorization needs its metadata under `/.well-known/` (`oauth-protected-resource` for `/api/mcp`, and `oauth-authorization-server`). Whether Functions can serve those paths in front of WordPress is unproven and joins the spike list.

Whether Functions can call their own space's WordPress by its public hostname is also unproven. The fallback is the Abilities route (`<space>.view.fast/wp-json/wp-abilities/v1/...` with a machine-credential token). The plugin would then register its connector operations as WordPress Abilities, which also mirrors WordPress 7's Abilities API. See spike list §13.

## 5. Sensei as the backend

### 5.1 What moves into Sensei, and what stays with us

| Concern | Owner | Notes |
| --- | --- | --- |
| Courses, lessons, titles, order, lesson body | **Sensei** | One Sensei course per path, grouped by a Learning Ledger program (§5.3). Lesson body = beats as blocks in `post_content`. |
| Course-level data: course IRI, placement, teaching rules, badge declarations, custody option | **Learning Ledger program** (on Space A) | The program is the cmi5 course (§5.3). |
| Lesson length, sources, licence | **Sensei** (lesson meta) | `_lesson_length` exists; sources and licence go in the plugin's fields. |
| WordPress user accounts | **WordPress / Sensei** | One headless user per learner (§6). |
| Enrolment | **Sensei** | Manual enrolment provider, called by the connector when a learner starts a path. |
| Lesson and course completion | **Sensei**, as a *projection* of the LRS | Written only by the connector, when the AU's moveOn is met (§5.5). |
| Certificates | **Sensei** (Sensei LMS Certificates, installed) | PDF on course completion, delivered through the studio (§7.5). |
| Beats, checkpoints, rubrics, checks, planted bugs, starter/preview/final files | **Our layer**, stored *on* Sensei lessons and courses through the plugin's Sensei integration | Edited in the block editor. |
| Placement, branching, the tutor, AI feedback, budget | **Our layer** (Functions) | Unchanged logic. |
| The MCP course server and MCP authorization | **Our layer** (Functions, the standard's reference server) | |
| Official record, badges | **LRS space** (`lrs.sqwrlz.com`) | Option 2. |
| Workspace files the learner edits | **Browser first, LRS State document second** | §7.3 |

### 5.2 What Sensei 4.x gives us, and what must be added

Checked against Sensei LMS 4.26.4 (released 2026-09-29, tested up to WordPress 7.1.3, requires WordPress 6.9 and PHP 7.4; https://wordpress.org/plugins/sensei-lms/), source at https://github.com/Automattic/sensei/tree/version/4.26.4.

**Available over REST:**

- **Courses and lessons are REST-enabled post types.** `course` has `rest_base: courses`, and `lesson` has `rest_base: lessons` with its own controller (`includes/class-sensei-posttypes.php`). So `GET /wp-json/wp/v2/courses` and `/wp/v2/lessons` exist.
- **Lesson meta exposed in REST:** `_lesson_course`, `_lesson_length`, `_lesson_complexity`, `_lesson_preview` and `_quiz_has_questions`. Writes need `edit_post` (`includes/rest-api/class-sensei-rest-api-lessons-controller.php`).
- **Course structure:** `GET /wp-json/sensei-internal/v1/course-structure/{course_id}` returns modules and lessons in order. It is public for published courses: `can_user_get_structure` returns true when the course is published and the visitor is logged out (`includes/rest-api/class-sensei-rest-api-course-structure-controller.php`). The namespace is **internal**, so it is not a stable contract.
- **Batch enrol and withdraw:** `sensei-internal/v1/course-students/batch` (POST/DELETE, needs course edit capability). **Batch progress reset:** `sensei-internal/v1/course-progress/batch` (DELETE). Both are internal admin endpoints (`includes/rest-api/`).

**Not available over REST:** marking a lesson complete for a user, reading a learner's progress, creating learners for headless use, and anything about tested-out lessons. These are PHP-only, so **the connector adds its own REST routes** and calls Sensei in-process. The PHP surface is:

- `Sensei_Utils::sensei_start_lesson( $lesson_id, $user_id, $complete )` starts the course if needed, creates lesson progress, completes it and fires `sensei_user_lesson_end`. `Sensei_Utils::user_start_course`, `update_course_status` and `user_complete_course` handle courses (`includes/class-sensei-utils.php`).
- `Sensei()->lesson_progress_repository` (`create`, `get`, `save`, `delete`, `find`). It is backed either by comments or by the optional High-Performance Progress Storage tables (`includes/internal/student-progress/`). **Lesson progress has only two statuses, `in-progress` and `complete`**. Quiz statuses (`passed`, `failed`, `graded`) belong to Sensei's own quizzes, which we don't use.
- `Sensei_Course_Manual_Enrolment_Provider::enrol_learner` and `withdraw_learner`, `Sensei_Course_Enrolment::is_enrolled`, and the `sensei_is_enrolled` filter (`includes/enrolment/`).
- Hooks: `sensei_user_course_start`, `sensei_user_lesson_start`, `sensei_user_lesson_end`, `sensei_user_course_end`, `sensei_lesson_status_updated` and `sensei_course_status_updated`. The connector listens to these for direction (2), Sensei → LRS, which is off for this course; the echo guard still applies.
- **Certificates** are a separate free plugin, Sensei LMS Certificates 2.6.0, tested to 7.1.3. It issues on course completion (https://wordpress.org/plugins/sensei-certificates/). It is installed in the prototype (owner decision).
- **Content** is ordinary block content in `post_content`, plus Sensei's own lesson blocks (lesson actions, complete lesson, next lesson, course outline; `includes/blocks/`).

Unverified: Sensei and Sensei LMS Certificates installing and running on Spacefast's PHP 8.5.12 (the decisions list Sensei as unverified); whether Certificates can render a learner's PDF in a request that isn't that learner's logged-in session (§7.5); and whether Sensei filters lesson content in REST responses for users who aren't enrolled. The last doesn't matter to us, because the course server reads through the plugin's authenticated export.

### 5.3 Content model on Sensei

**One Sensei course per path, grouped into one cmi5 course by a Learning Ledger program.** **Builder's call (reconciliation 1).** Three Sensei courses, six lessons each, no modules, as Learn's own Learning Pathways are sequences of courses. The plugin's **program** post type holds the course-level data (course IRI, the placement AU and guide, teaching rules, badge declarations, custody option `author-lrs`) and groups the three path courses into **one** cmi5 course: program = `<course>`, each Sensei course = `<block>`, each lesson = `<au>`. The standard's one-package rule stands, and placement across paths stays inside one registration. "Course satisfied" maps to the program; "block satisfied" maps to Sensei course completion, which is what Sensei's certificates key on. Cost if wrong: re-parenting 18 lessons, which the importer can redo.

**Activity IRIs.** **Builder's call (reconciliation 7).** The standard's scheme, with the prototype's slugs inside it. The course IRI base is `https://learn-wp-reimagined.space.fast/activities/`:

- the course (program) is `…/activities/course`;
- each block is `…/activities/paths/<path-id>` (today's path IRI);
- each AU id is `…/activities/lessons/<lesson-id>` (today's lesson IRI), and its activity id is `{au@id}/au`, as the standard requires;
- beats, checkpoints and files sit under the AU id as the standard defines.

Reason: the lesson slugs, branch targets and accuracy docs carry over unchanged. Cost if wrong: a scheme change before the first official record, which is a statement-builder setting.

Per lesson:

- **Beats are blocks.** Each beat is a `learning-ledger/beat` block (from the plugin's Sensei integration) with `id`, `goal` and `question` attributes. Its inner blocks are the beat's content (paragraph, heading, list, code, preformatted, quote, image).
  **Builder's call.** Reason: the lesson reads as a normal lesson on Sensei's own page, which is the AI-down degradation the original design asked for and what a Learn author would expect. Cost if wrong: converting beat content to another storage form, which is scripted.
- **Checkpoint, planted bug, checks, rubric and fallback options** live in one `learning-ledger/checkpoint` block (with its checks inside it and a `learning-ledger/rubric` block) and one `learning-ledger/planted-bug` block, edited in the block sidebar. On the front end and in public REST `content.rendered`, they render only the question, never the rubric, the bug explanation or the fix checks. The block names are fixed before content migration (**Builder's call (reconciliation 12)**; the owner's plugin name sets the slug).
- **Starter files** go in lesson-level fields of the integration. **Preview kind, preview files and final files** go in Sensei course (block) level fields, in the prototype's namespaced extension.
- **Stable ids.** Each lesson and course carries the existing id (`bt-what-is-a-block-theme`, `block-theme`) in a meta field, and the program carries `learn-wp-reimagined`. Activity IRIs, branch targets, record entries and accuracy docs keep working, and the importer is idempotent by that id.
- **Prerequisites off, and no Sensei quizzes.** Branching sends learners back and forward, so no Sensei lesson prerequisite may block it.

### 5.4 How the studio reads courses

Today the studio imports `src/generated/content.json` at build time, which is why it is instant. The anti-goal "the studio gets slower" rules out fetching from WordPress on every lesson open.

**Builder's call: runtime reads, cached in three layers, with a baked fallback.** Reason: author edits in Sensei appear without a republish, and the studio stays as fast as now. Cost if wrong: the cache adds code, and a stale cache can show old content for up to one revalidation.

1. **The plugin's export.** The standard's package (the ZIP of `cmi5.xml`, `cxm/course.json` and `cxm/lessons/*.json`), produced by the connector from the program and its three Sensei courses, with a version and ETag. It is the only interchange format (**Builder's call (reconciliation 2)**). It comes in two flavours: *full* (signed request only: rubrics, fix checks, bug explanations) for the course server, and *public* (secrets stripped).
2. **The course server's cache** in env.DB (`course_cache`: course id, ETag, body, fetched at). It revalidates when older than 5 minutes, and immediately on a signed "content changed" ping that the connector sends on `save_post` for the program, a course or a lesson. On each new version the course server also imports the package into the LRS (§4.4). If WordPress is unreachable, it serves the last good copy.
3. **The browser.** `GET /api/course/{path}` returns the studio's projection: the same shape the studio uses today (`ContentBundle`), produced from the package by one adapter, with `Cache-Control: max-age=60, stale-while-revalidate=86400` and an ETag.
4. **Baked fallback.** The build pulls the current package from WordPress into `content/snapshot/` (committed, §9.2) and bakes it into the bundle. The studio renders from the baked copy at once and swaps in a newer version if `/api/course` returns one. A version mismatch in the middle of a lesson never swaps content under the learner: the swap happens at the next lesson open.

The studio's internal `ContentBundle` type stays, so the outline, feed, workspace and finale code doesn't change. Only the loader changes: `src/content.ts` becomes a `CourseSource` with a `bundled` and a `wordpress` implementation.

**Content format across the boundary. Builder's call:** beat content travels as CommonMark, which the plugin produces from the allowlisted blocks. Reason: the studio already renders Markdown safely, agents read Markdown best, and it avoids sanitising arbitrary HTML in the browser. Cost if wrong: authors who use other blocks lose them in the studio and agent views. The plugin's validator warns about that at save time.

### 5.5 Skipped lessons in Sensei: "tested out"

Placement skips and checkpoint `skip` outcomes jump past lessons. The course server issues a cmi5 `waived` statement with reason "Tested Out" for each lesson it jumps over. A cmi5 waived AU counts as satisfied.

The connector marks a Sensei lesson complete only when the AU's **moveOn is met**, computed from the course tree imported from the package, not on a bare cmi5 `completed` (**Builder's call (reconciliation 7)**). A waived AU meets moveOn.

In Sensei, lesson progress can only be `in-progress` or `complete`, and metadata on the status comment doesn't exist under High-Performance Progress Storage. So:

- the connector marks the lesson **complete** (`sensei_start_lesson( …, true )`), and Sensei's course completion and certificates then work unchanged;
- the "tested out" fact is stored in the plugin's own table, keyed by (user, lesson), with the waiving statement id;
- "tested out" is shown in the studio's outline, in the "What Sensei sees" panel (§5.6) and in the plugin's admin view. Sensei's own reports say "Complete". That matches cmi5's meaning of waived (satisfied by other means).

**Builder's call**, confirming the owner's proposal within what Sensei allows. Cost if wrong: an admin reading only Sensei's reports can't tell tested-out from done. Patching Sensei's reports is not worth it.

A `review` branch sends the learner back; it marks nothing. A lesson completed after being tested out keeps its completion and loses the tested-out marker.

### 5.6 Sensei's front end: "the backend view"

Sensei's course and lesson pages on Space A stay published and are **visible to visitors, labelled "the backend view"** (owner decision). They are what Learn has, and they are the AI-down reading view. They are linked from the How this works page and the Proposal page, not from the studio's main flow. Every Sensei course and lesson page carries a banner: "This is the backend view: Sensei's own page for this lesson. Take the lesson in the studio", with a link.

**Learners are headless. Builder's call.** A learner has a WordPress user that Sensei enrols and tracks, but never signs in to WordPress: there is no password, no login link and no WordPress cookie. So the backend view is the same public page for everyone and shows no per-learner progress. Reason: one auth model (the studio session), no WordPress login screen inside a five-minute demo, and no learner sessions on the Learn-like site. Cost if wrong: a later "sign in to Sensei" step for learners, which would need a login bridge the plugin doesn't have.

**Builder's call:** add a small **"What Sensei sees"** panel to the studio's record menu. It shows, from the connector, the learner's Sensei enrolment, completed and tested-out lessons, and a download of their Sensei certificate PDF once a path's course is complete (§7.5). Reason: it is the visible proof of the integration, for learners who never see Sensei's per-learner pages. Cost if wrong: one panel to remove.

## 6. Identity and accounts

### 6.1 The problem

Today there are no accounts: a random UUID is the xAPI actor, the record lives in the browser, and web agents sync through a handle. Sensei needs a WordPress user to enrol and to hold progress, and record option 2 needs a stable actor that the course server, not the learner, assigns.

### 6.2 Options

| | How | 5-minute test | Privacy | Cross-device |
| --- | --- | --- | --- | --- |
| **A. Anonymous WordPress users, created on demand** | The first recorded action (accepting a placement or opening lesson 1) creates a WordPress user with no email, a random login and the `subscriber` role, plus a studio session cookie | Unaffected | No PII. A server-side record now exists for a pseudonymous person | No, unless the learner moves it (B) |
| **B. A + "Keep my progress"** | As A, plus an optional upgrade that attaches an email magic link to the same learner | Unaffected | The email, if given, is stored only in WordPress (never in xAPI or badges) | Yes, after the upgrade |
| **C. Sign in first** | Email or social sign-in before placement | Fails: sign-up before value | PII for everyone | Yes |
| **D. No WordPress users**: Sensei progress kept on one shared "demo" user | | Unaffected | | Breaks the proof: Sensei can't show a learner's progress |

**Decided (owner answer 1): A, with B's email magic link added later.** A keeps the 5-minute test and the "no sign-up" promise, and gives Sensei a real user per learner. B answers "I want this on my laptop too" without making accounts mandatory. Passkeys are not in the prototype.

### 6.3 How it works (under A and B)

- **Session.** On the first recorded action, Functions ask the connector to create a learner. The connector creates the headless WordPress user and generates the actor `{ account: { homePage: "https://learn-wp-reimagined.space.fast", name: <uuid> } }`, stored as user meta. Functions then set an `HttpOnly; Secure; SameSite=Lax` session cookie. Its value is random, and only its hash is stored in env.DB (`sessions`: hash, wp_user_id, actor name, created, touched).
  **Builder's call:** WordPress (the connector) assigns the actor, because in the owner's model the LMS/LRS side assigns identity, and the standard allows the LMS/LRS to assign the actor in option 2 (reconciliation 13). Cost if wrong: moving actor minting into Functions, which is a few lines.
- **Rate limits.** User creation is rate-limited per IP and globally, using the existing `ratelimit.ts`, and the connector's create-learner route is capability-gated to the course server's signed requests (**Builder's call (reconciliation 9)**), because anonymous user creation is an obvious spam vector. Before the session exists, the studio works exactly as today, with nothing recorded.
- **The xAPI actor** is the same shape as today's anonymous actor, under the same `homePage`. No `mbox`, no name. Badges never carry it (open-badges research §6).
- **Registration.** The course server mints one cmi5 registration per learner for the program (all three paths), keeps it in the LRS's State API, and reuses it on return, from the studio or an agent.
- **Agent sessions** map to the same actor through MCP authorization (§8.2). The consent page reads the studio session. An agent that connects cold (a learner who adds the connector without visiting the site first) opens the consent page in a browser with no session; approving creates the anonymous learner there and sets the studio cookie, so the browser and the agent share one learner from the start.
- **Upgrade (B), later.** "Keep my progress" adds an email, stored on the WordPress user and used only to send studio sign-in links. The magic link signs the learner in to the studio session, never to WordPress. Signing in on another device attaches that device's session to the same learner. If that device already had an anonymous learner with progress, the learner chooses which to keep. Records are never merged silently.
- **Deletion: GDPR erase.** "Delete my data" in the record menu (owner answer 4):
  - asks the LRS to erase the actor (`actors/erase`), which **deletes the learner's official statements** and State and Agent Profile documents;
  - **revokes the learner's badges** through the status list;
  - deletes the WordPress user (Sensei progress and certificates go with it, through Sensei's `delete_for_user`);
  - revokes OAuth tokens and clears the cookie and browser copy.
  The pages say plainly that a revoked badge stops verifying.
- **Retention (owner answer 2).** Anonymous learners with no activity for **180 days** are deleted by a daily cron: WordPress user, LRS statements and documents, tokens. **Builder's call:** retention does not revoke badges the learner has already claimed. Reason: a learner who finished a path and shared the badge months ago shouldn't have it stop verifying because they stopped visiting; revocation is for an erase the learner asked for. Cost if wrong: one flag in the cron. The record panel tells learners about the 180-day rule and offers the export.

### 6.4 Privacy implications to state on the pages

- A server-side record now exists. It holds checkpoint answers in the learner's own words (`answered` statements carry `result.response`) and their edited files (State document).
- **Decided (owner answer 3): free-text answers are kept in the official record.** They are the evidence a badge links to, and the tutor and agent need them to resume.
- No email unless the learner gives one. No third-party analytics. The LRS is a separate space under the same owner, at `lrs.sqwrlz.com`.
- The pages say plainly: progress is now stored on our servers under a random id; it is deleted after 180 idle days; here is how to export it; here is how to delete it, and that deleting it revokes any badges.

## 7. The record

### 7.1 From learner-held to option 2

| | Today | After |
| --- | --- | --- |
| Official record | none; the browser's `learn-wp-reimagined/record` v1 is the only record | the LRS space, written only by the course server |
| Browser | holds the record (OPFS/IndexedDB, optional folder) | holds a **working copy**: resume point, files and a read-only mirror of recent statements for instant UI |
| Web agents | anonymous relay (`mcp_records` in env.DB, by handle) | read and write through the course server into the LRS, signed in through MCP authorization |
| `link_record` | lets an agent replace its record | removed (the standard's rule) |

### 7.2 One write path

Every learning fact goes **course server → LRS**, and nothing else writes the learner's statements (**Builder's call (reconciliation 3)**):

1. The studio sends **events**, not statements, to `POST /api/events`: beat viewed, checkpoint answer, code submitted, bug caught, placement accepted, file saved.
2. The course server **decides**. It judges free text with the AI as today. It re-runs deterministic checks on the submitted files server-side (the shared `checks.ts`, run in Functions too). It chooses among authored branches only.
3. It builds the statements with **the standard's statement builder**: cmi5 defined statements on the AU activity id (`{au@id}/au`, with durations and session ids), plus allowed statements (`experienced`, `answered`, `branched`, `caught`, `placed`) with the standard's profile category. It posts them to the LRS.
4. It answers the studio with the outcome. The studio updates at once.
5. The LRS notifies the connector, which applies completions, waivers and enrolment to Sensei. Both the LRS's delivery and the connector's inbox processing run at `shutdown` after responding, with cron as catch-up, against the 90 s p95 target (**Builder's call (reconciliation 11)**).

Consequences:

- **The browser's checks become advisory.** They still run instantly as the learner types (feedback, the green tick), but only the server's re-run counts. The two are the same code, so they agree.
- **The AI-down fallback** (pick an option when the judge is unavailable) still advances the learner, because the original design promises learners can always advance. The statement records that the learner chose, not the judge (an extension on `branched`). **Builder's call.** Reason: honest about who decided, without blocking learners. Cost if wrong: those statements need a different badge rule, which the standard's `countWaived` and `awardOn` rules can express.
- **`experienced` statements are batched** by the studio (on lesson change, or every 30 seconds) so beats never wait on the network.
- **The outbox.** If the LRS is slow or down, the course server writes statements to an env.DB `lrs_outbox` and answers the studio anyway. A cron every 5 minutes drains it, using the statements' own ids so retries are idempotent (xAPI returns 204 for an identical PUT). The outbox is a queue, not a record: rows are deleted once stored.
- **Drift check.** A daily cron compares, per learner active that day, the LRS's satisfied and waived lessons with Sensei's completion as read through the connector. It reports any difference to the admin stats endpoint. The connector's catch-up poll should keep drift at zero; the check proves it.

### 7.3 What the learner sees and keeps

- **The record panel** shows the official record: completed and tested-out lessons, branch history and badges, read from the LRS through `GET /api/record`. It is cached per session and invalidated on each event. A "View in the LRS" link opens the LRS's own record page through a link the LRS mints for that actor (`records/view-links`, **Builder's call (reconciliation 10)**).
- **Export.** "Download my record" returns the learner's statements as the LRS stores them (with `stored` and `authority`), plus their files, in the standard's xAPI-statement export format. It is labelled as a copy.
- **Files.** The workspace files stay local-first: typing writes to the browser instantly, and "save to a folder" still works. They sync to an xAPI **State document** per registration on a debounce (2 seconds after the last edit) and on lesson change. Agents and other devices get them from there. The finale and Playground use the local copy, falling back to the State document. The State document limit is **2 MB**, the standard's contract value and the same as today's per-record cap (**Builder's call (reconciliation 12)**).
- **Resume point** is a State document too. A cmi5 State doc is the standard place for it.

### 7.4 Existing local records

Whether the current prototype goes public before this rebuild lands is not decided, so the import is kept small. **Builder's call.** Reason: it costs little if there are no users and keeps people's place if there are. Cost if wrong: a few lines of code that may never run.

A browser that holds a `learn-wp-reimagined/record` v1 when the new version loads gets one offer: "Bring your progress over".

- The **files and resume point** move over as they are, since they are working material.
- **Completed lessons** are carried over as waived with reason `Administrative` and the extension `https://course-xapi-mcp.sqwrlz.com/xapi/extensions/carried-over` (**Builder's call (reconciliation 6)**), distinct from "Tested Out". They are complete in Sensei, and they **never** count for badges.
- The old statements are not posted. They were learner-held and could have been edited, and the standard forbids the learner replacing the official record.

The agent relay's `mcp_records` rows are handled only if the site has been public with real agent users at the switch: then a "Bring back your agent's progress" flow applies the same rules and stays live for 30 days before it is removed with the table. Otherwise the table is dropped at the switch.

### 7.5 Badges and certificates

- **Issuer: the LRS** at `lrs.sqwrlz.com` (Open Badges 3.0, `eddsa-rdfc-2022`, `did:web:lrs.sqwrlz.com`, Bitstring Status List), with the issuer name **"Learn WordPress, reimagined"** (owner decision). Badge declarations come from `course.json` in the package the course server imports (§4.4); the LRS recomputes satisfaction from the imported tree before it signs.
- **What earns one (owner answer 6).** A badge per path, declared `awardOn: "block-satisfied"` with `countWaived: true`: earned when the path's block (its Sensei course) is satisfied, with tested-out lessons counting, as cmi5 waived counts as satisfied. The badge's narrative states how many lessons were tested out. Carried-over lessons (§7.4) never count. **Builder's call:** no per-lesson badges, because they would be noise in a six-lesson path, and no course badge for all three paths. Cost if wrong: one declaration in the program.
- **Where the learner gets it. Builder's call (reconciliation 5).** The studio's record panel and the path's completed summary link to the studio's claim page (`/badges/claim`). That page reads the studio session, has the course server mint a claim link for that actor and badge (`badges/claim-links`: single-use, 15-minute TTL, minting invalidates the previous one), and sends the learner to the LRS's claim page. There the learner adds an email (hashed, with a fresh salt, in the badge only) or connects a wallet. They get a JSON and baked PNG download, a public badge page for sharing, and an "add to wallet" option. After issuance the LRS writes the `earned` statement. The agent's `get_badges` returns badge metadata and a link to the studio's claim page, **never a bearer claim link**; the claim page mints a fresh link once the learner is identified by their session.
- **Sensei certificate (owner answer 8).** Sensei LMS Certificates is installed, and Sensei issues its PDF certificate when a path's course is complete, alongside the badge. **Builder's call:** because learners are headless (§5.6), the PDF is generated server-side on Space A and delivered through the studio: the "What Sensei sees" panel offers a download that the course server proxies from a signed connector route (`GET` a learner's certificate for a course). Reason: no WordPress login for learners, and one place to get everything. Cost if wrong: a connector route and a spike on headless rendering (§13); if Certificates can't render without the learner's session, the panel shows the certificate's existence and an admin-generated copy instead. The pages explain the difference: Sensei's certificate is a document, and the badge is a verifiable credential.

## 8. The agent path

### 8.1 The server

`/api/mcp` stays at the same URL, so the Connect page keeps working (existing connector setups must sign in once, §8.2). It now runs **the standard's reference server**, vendored the way learning-mcp is today, advertising `com.sqwrlz/course-xapi-mcp`, with three host-supplied pieces:

- **Course source:** the full-flavour package from the course cache (§5.4), not the YAML build.
- **Record option 2:** the server writes through the same statement path as the studio (§7.2), so studio and agent are two front ends of one course server. The agent can read progress (`get_progress`, from LRS State and statements) and cannot write or replace the record. No `link_record`.
- **Identity:** an OAuth access token resolves to the actor and the program registration (§8.2).

Statelessness (MCP 2026-07-28) is preserved: everything lives in the LRS, env.DB and the token, and nothing in the isolate. No AI runs on this path, so it keeps working when the AI caps are hit.

### 8.2 "Continue in your agent": MCP authorization

**Builder's call (reconciliation 14), confirmed by owner answer 5.** The prototype conforms to the standard: Functions implement MCP authorization (OAuth 2.1 with PKCE, protected-resource and authorization-server metadata, and client registration as the MCP specification requires), and the bearer handle passed in tool arguments goes away. It is our own authorization server for this course; it touches no existing SSO or WPO365 configuration.

- The learner adds `/api/mcp` to their agent, as the Connect page shows per client. The agent's first call gets a 401 with the protected-resource metadata, and the client opens our **consent page** (`/consent`) in the browser.
- The consent page reads the studio session, so there is **no extra login**: it shows "Let <client> continue your course as you?" with Allow and Cancel. With no session, Allow creates the anonymous learner (§6.3).
- Tokens are opaque and random, stored hashed in env.DB (`oauth_clients`, `oauth_codes`, `oauth_tokens`), bound to the actor and scoped to course tools only. Access tokens last an hour; refresh tokens expire after 30 days without use. "Disconnect agents" in the record panel revokes them.
- From a lesson, "Continue in your agent" shows the MCP URL and a short prompt naming the lesson. The agent resumes at the same beat, with the same files, from the State document, because resuming works by identity.

Cost if wrong: an OAuth server to maintain where an argument handle worked. The anti-goal "connecting gets fiddlier" is met if connecting is one sign-in that the consent page completes without typing; phase 7 checks that in each client.

### 8.3 Agent progress everywhere

The agent's checkpoint, check and branch calls go through the same decide-and-record path, so:

- **in the studio**, the next page load or the record panel's refresh shows the new state (**Builder's call:** no live push; a refresh on focus and a "Refresh" in the panel are enough for a demo, at the cost of a stale view until focus);
- **in Sensei**, within 90 seconds at p95 (aim: 30 seconds), through the LRS notification;
- **in the LRS**, at once.

Branch reliability is unchanged: the agent judges against the authored rubric, and the server accepts only authored branches. The planted bug's explanation and fix checks are never returned until the bug is caught, or until the standard's recorded `reveal_bug` after 3 failed fix attempts. That is the public-flavour rule in §5.4, applied on the server.

## 9. Content migration

### 9.1 YAML → Sensei

A one-time, re-runnable `scripts/migrate-to-sensei.ts`:

1. reads `content/paths/**.yaml` with today's loader and schema;
2. converts the three paths into **one** package in the standard's course format: one course (the program) with one block per path (with the prototype's namespaced extension for `preview`, `landing`, `previewFiles` and `finalFiles`), and validates it with **the standard's validator**;
3. publishes the package as a file of Space A and calls the plugin's importer through WP-CLI (`wp learning-ledger import <package URL>`). The importer (in the plugin's scope, reconciliation 2) creates or updates the program, the three Sensei courses and 18 lessons by stable id, turning Markdown beats into `learning-ledger/*` blocks;
4. pulls the export back and checks that it is **semantically identical** to the YAML: same ids, beats, checks, branches and files, with whitespace-normalised text.

Step 4 is the gate. The studio does not switch to WordPress until the round trip is exact for all 18 lessons.

### 9.2 After migration: WordPress is the source of truth

**Decided (owner answer 17): content is edited in wp-admin, and a content snapshot committed to git is the reviewable record.**

- The YAML files are deleted in the commit that flips the source (git history keeps them).
- **`content/snapshot/`** holds the exported package, written by `npm run content:pull` and committed. It is never edited by hand; a test fails if it differs from a fresh pull, when run with network access. It gives reviewers a git diff of every content change made in wp-admin, and gives tests a deterministic input.
- `scripts/build-content.ts` becomes the snapshot loader. Its **house rules** move to a prototype check over the snapshot: at least two checkpoints per live path, advance, review and skip branches on every checkpoint, preview kinds, file names unique across paths, and `finalFiles` passing every lesson's checks. The standard's validator covers its own rules.
- **The content test harness** (`tests/content/*-checks.test.ts`, `solutions.ts`) runs unchanged against the snapshot: every checkpoint, check and planted bug behaves. The fixtures in `tests/fixtures/content` become small packages.
- **The accuracy docs** (`docs/content-accuracy*.md`) stay in the repo, keyed by lesson id. Each lesson's `sources` move to the plugin's source fields and are checked by the house rules (at least one source per lesson). The accuracy gate (spec §8) applies to edits made in wp-admin: a content change isn't done until its accuracy doc entry is updated in the same snapshot commit.
- **Licence.** Lesson content stays CC BY-SA 4.0. Each lesson's licence and "adapted from" credit are fields on the lesson, and `content/LICENSE` stays with the snapshot.

## 10. What happens to the existing pieces

| Piece | Fate |
| --- | --- |
| `content/paths/*.yaml`, `scripts/build-content.ts` | Migration source once, then deleted. The loader becomes the snapshot loader. |
| `src/generated/content.json` | Replaced by the baked snapshot projection (§5.4). |
| `src/shared/schema.ts`, `types.ts`, `engine.ts`, `checks.ts` | Kept. `ContentBundle` stays as the studio's internal shape. `checks.ts` now also runs in Functions as the authority. |
| `src/shared/record.ts`, `xapi.ts`, `src/record/*` | The record becomes a working copy. Statement building moves to the standard's builder on the server, with the IRI scheme of §5.3. Browser and folder stores remain for files and resume. The `wordpress-org` store kind is removed (it was a placeholder). |
| `vendor/learning-mcp` | Replaced by the standard's reference implementation, vendored with `VENDORED.json` (Apache-2.0, compatible with this repo's GPL-2.0-or-later under GPLv3). `scripts/vendor-learning-mcp.ts` is renamed accordingly. |
| `functions/_lib/mcp/course.ts` (`toCourse`) | Deleted. The course comes from the export. |
| `functions/_lib/mcp/recordStore.ts`, `mcp_records`, `/api/agent/handoff`, `record`, `delete` | Replaced by MCP authorization and the LRS. `mcp_records` is kept read-only for 30 days only if the relay had real users at the switch (§7.4), then removed. |
| `/api/mcp-sweep` cron | Repurposed: expire sessions and OAuth tokens, drain the outbox (its own 5-minute cron), drift check, 180-day anonymous-learner retention. |
| `/api/placement`, `checkpoint`, `code-feedback`, `tutor`, budget, rate limits | Kept. Placement and checkpoint now also emit events into the record path. The tutor's grounding text comes from the course cache. |
| `/connect` | Kept. Same URL and setup per client. The copy changes from "paste your handle" to "sign in when your agent asks". |
| **Proposal page** | Rewritten in its phase sections. Phases 1 to 3 ("a tutor and placement beside Sensei", "a record", "Sensei progress") are now demonstrated, not proposed, and each claim links to the code or the running piece, including the backend view. New sections cover the standard, Learning Ledger, and why the LRS is separate. The "no accounts" design decision is replaced by the anonymous-user model and its privacy terms. The `Cite` source list is updated to the new files. |
| **How this works page** | "What's real" now covers real Sensei (version shown) with a link to the backend view, Sensei certificates, the real LRS at `lrs.sqwrlz.com`, and badges. "What's concept" keeps: unofficial, not affiliated, lessons not reviewed by the Training Team, Sensei front end not the learner experience. "There are no accounts" becomes "You get an anonymous account". The relay section becomes where the record lives, how to export it and how to delete it. The rate-limit and retention numbers come from config, as the `MCP` constant does today. |
| Finale, Playground preview, workspace | Unchanged, reading files from the local copy. |

## 11. Interfaces this prototype needs

### 11.1 From the standard (course-xapi-mcp)

- **S1. Course format** that can carry everything the YAML has: paths/blocks, lessons/AUs with minutes and sources, beats (id, goal, Markdown content, question), checkpoints (id, kind free-text/code, question, rubric, file, checks contains/notContains/regex/json, branches advance/review/skip with target and message, fallback options), planted bugs (file, code, explanation, fix checks), placement (intro, max questions, hints per path), teaching rules, starter files. Plus an **author-namespaced extension** for host-specific fields (`preview`, `landing`, `previewFiles`, `finalFiles`) that validators ignore.
- **S2. A TypeScript statement builder**, usable from a host without the MCP server: event in, cmi5-conformant statements out, with the `{au@id}/au` activity ids. That covers sessions and durations, `waived` with a reason (Tested Out, and `Administrative` with the carried-over extension), `branched`, `placed`, `caught`, `revealed`, `earned`, and a marker for learner-chosen fallback outcomes.
- **S3. Record option 2 in the reference server**: a pluggable LRS client (endpoint, Basic credential), a host-provided `resolveActor` / `resolveRegistration` that accepts an LMS/LRS-assigned actor, State documents for resume and files (2 MB), no `link_record`, progress reads, and the xAPI-statement export format.
- **S4. A pluggable course source** (load the package from a URL or cache) and **MCP authorization hooks** so the host runs its own authorization server and maps a token to an actor. Stateless Streamable HTTP.
- **S5. Validator and test vectors**, runnable in Node for the snapshot.
- **S6. Multi-path courses as one package**: one course with one block per path, placement across blocks in one registration, and per-block satisfaction (reconciliation 1).
- **S7. Badge declarations** in the course (`awardOn` including `block-satisfied` and `any-path`, `countWaived`, carried-over never counting) and a `get_badges` tool that returns badge metadata and the course's claim-page URL, never a bearer claim link (reconciliation 5).
- **S8. Content split**: which fields are agent-visible before an event (public) and which only after (bug explanation, fix checks), including `reveal_bug`.

### 11.2 From the plugin (Learning Ledger: LRS role, connector role, Sensei integration)

- **P1. Sensei integration blocks and fields**: the `learning-ledger/beat`, `/checkpoint` (checks inside), `/rubric` and `/planted-bug` blocks, lesson starter files, course preview/final files, sources, licence, stable id. The **program** post type with course-level data. Front-end and public REST rendering hides spoilers.
- **P2. Export**: per program, the standard's package (ZIP) in two flavours (full via signed request, public), with ETag and version. Block → Markdown for an allowlist, with save-time warnings for anything else. A "content changed" ping to a configured URL.
- **P3. Import**: idempotent by stable id, from a package URL, into a program and its Sensei courses and lessons, through WP-CLI and REST.
- **P4. Connector routes for a headless course server**: create an anonymous learner (returns user id and actor; rate-limited and capability-gated), enrol in a course, read a learner's Sensei progress including tested-out, fetch a learner's Sensei certificate PDF for a course, delete a learner, status. All by Ed25519-signed request, with only the public key stored.
- **P5. Connector apply rules**: LRS → Sensei (AU moveOn met, computed from the imported tree → lesson complete; waived → complete plus tested-out marker; course completion left to Sensei), loop prevention and the echo guard, notification handling at `shutdown` plus a `since` catch-up poll, and direction 2 as a per-course setting that is off here.
- **P6. LRS role**: Statements (with voiding), State (2 MB), Agent Profile and About; course import (`courses/write`); credentials registered by secret hash with scopes, including `actors/erase` (deletes statements and documents) and `records/view-links`; signed notifications; statement export per actor.
- **P7. Badges in the LRS**: issuer `did:web:lrs.sqwrlz.com` with a configurable issuer name, achievements from the imported declarations, satisfaction recomputed before signing, a claim-link API (`badges/claim-links`: single-use, 15-minute TTL, newest wins), claim page, public badge page, status list, revoke on erase.
- **P8. Configuration only through WP-CLI and public values** (§4.3), the connector generating its own LRS secret and exposing only its hash, and a REST status route that reports versions, role, pairing, hashes to register, Sensei and Certificates presence, and sodium.

Note: Learning Ledger v1 also includes a cmi5 player for Sensei (the cmi5 LMS side). The prototype does not depend on it, because it uses custody option 2. It enables a later demo of custody option 1 with an imported third-party cmi5 course.

## 12. Constraints carried over

- **AI spend:** $100 a month hard cap and $10 a day sub-cap across all providers, unchanged. Open models on Cloudflare Workers AI. The new plumbing adds no inference. The MCP path still runs no inference on our account.
- **Hosting:** Spacefast only. Two spaces, both claimed and public; the LRS space is served at `lrs.sqwrlz.com`.
- **Browser checks:** the agent-browser CLI only, never Puppeteer or Playwright, and never Chrome driven by hand. Every subagent prompt that involves a browser must say so.
- **Accessibility:** WCAG 2.2 AA, full keyboard use, `prefers-reduced-motion`, no horizontal scroll at 390px. That includes the new panels and pages ("What Sensei sees", badges, the consent page, the claim page, "Keep my progress", delete), the backend-view banner, and the LRS claim and badge pages, which follow the same look.
- **Look:** spec §6. EB Garamond and Inter, charcoal bands, `#3858E9` and `#9FB1FF`, the "unofficial concept" sticker, no WordPress "W". The LRS space's pages use the same tokens.
- **Studio speed budget. Builder's call:** measure today's numbers with agent-browser before any change (lesson open, beat advance, first checkpoint result, at 1440x900 and 390x844). After each phase: lesson open and beat advance no slower than baseline plus 10%, and checkpoint result no slower than baseline plus 300 ms. Reason: the anti-goal needs a number. Cost if wrong: tuning work.
- **Git:** commit to `main` and push to `origin/main` immediately after each commit. Never push to `production` unless Derin says so, and never create a local `production` branch. Docs are shown to Derin before they are committed. No `.DS_Store`.
- **Never touch WPO365 or any existing OAuth/SSO settings.** None exist on these spaces. The MCP authorization server this design adds is our own code in Functions, approved by the owner (answer 5); it configures no SSO plugin. The magic link belongs to the studio session, not an SSO plugin.
- **Licences:** prototype code GPL-2.0-or-later. Vendored standard code Apache-2.0. Content CC BY-SA 4.0. Learning Ledger GPL-2.0-or-later, installed rather than linked.

## 13. Phasing (Builder's call)

Each phase ships to the live prototype behind a flag in `src/config.ts` / `functions/_lib/config.ts`. Each can be rolled back by turning the flag off, and leaves the site working. Reason: the site may be public during the rebuild. Cost if wrong: flag code to remove at the end (phase 8).

**Before the standard and the plugin are finished:**

- **Phase 0: spikes, no product change.** On a throwaway space, then on Space A:
  1. the SPA fallback versus `/wp-json`, `/wp-admin` and Sensei's pages with Functions present (§4.5);
  2. Functions fetching their own space's WordPress;
  3. Functions serving `/.well-known/oauth-protected-resource` and `/.well-known/oauth-authorization-server` in front of WordPress;
  4. Sensei 4.26.4 and Sensei LMS Certificates 2.6.0 install and activate on PHP 8.5, and Certificates renders a learner's PDF in a request that isn't the learner's own login;
  5. a second claimed public space reachable at `lrs.sqwrlz.com`, with Basic auth passing through;
  6. `ext-sodium` present;
  7. `/.well-known/did.json` on `lrs.sqwrlz.com` reaching WordPress;
  8. WordPress user creation through a plugin REST route.

  Any "no" changes this design before code is written.
- **Phase 1: server authority.** Checks run in Functions, `/api/events` exists, and statements are built server-side but still returned to the browser's local record. This changes nothing visible and removes the "client says it passed" hole early. Also the `CourseSource` interface (bundled only), the studio speed baseline and draft page copy.
- **Phase 2: sessions without WordPress.** Session cookie and actor in env.DB, and the delete flow. It still writes the local record.

**Once the plugin's Sensei integration, program, export and import exist:**

- **Phase 3: content in Sensei.** Provision Space A's WordPress, migrate, prove the round trip, add `content/snapshot/`, and flip `CourseSource` to `wordpress`. Delete the YAML. Sensei's pages go visible with the backend-view banner.
- **Phase 4: learners in Sensei.** The connector creates headless users and enrols. Sessions bind to WordPress users.

**Once the plugin's LRS role and the standard's builder and server exist, and course-xapi-mcp is public (owner answer 13: before the prototype writes its first official record):**

- **Phase 5: the record in the LRS, in shadow.** Provision Space B at `lrs.sqwrlz.com`, and import the course into it. The course server posts every statement to the LRS **and** still returns it to the local record. A comparison report runs for a week, or until zero diffs.
- **Phase 6: flip the record.** The record panel reads the LRS, the connector applies to Sensei, the drift check runs, and existing local records are carried over (§7.4).
- **Phase 7: agent path on the standard.** Swap the vendored server and add MCP authorization and the consent page. Handle relay records per §7.4. Compatibility checks in Claude Code and Claude.ai, and in ChatGPT developer mode: Derin signs in once in an agent-browser window, the agent runs the connector test, then removes the connector (owner answer 21).
- **Phase 8: badges, certificates, pages, cleanup.** Badges and the claim flow, the Sensei certificate download, the Proposal and How this works rewrites, flag removal, relay removal after its window.

The pages are updated in the same phase as the behaviour they describe, never ahead of it (anti-goal "overclaiming").

### 13.1 Risks and unverified assumptions

| Risk | If it fails |
| --- | --- |
| SPA fallback shadows WordPress (§4.5) | Explicit rewrites; worst case, WordPress is reached only through Abilities and Sensei's backend view isn't public |
| Functions can't reach their own WordPress | Abilities with a machine token |
| Functions can't serve `/.well-known/oauth-*` | Path-suffixed metadata URLs if clients accept them; otherwise the authorization server moves to a path WordPress doesn't claim, tested per client |
| An MCP client doesn't support our authorization flow | State it on the Connect page for that client; no fallback to bearer handles in tool arguments |
| Sensei or Certificates on PHP 8.5 | Pin the newest version that works; report upstream |
| Certificates can't render headless | The panel shows that the certificate exists, and the pages say so |
| No sodium | `sodium_compat` (the plugin's concern) |
| `lrs.sqwrlz.com` can't point at a Spacefast space, or `.well-known` doesn't reach WordPress | Issuer by HTTPS URL on the space's own hostname. Still valid OB 3.0, but the Learner Credential Wallet won't resolve it; say so on the pages. Decide before any badge is issued, because the issuer identity is permanent |
| Cross-space latency makes `/api/events` slow | The outbox path always (answer first, post after), still inside the 90 s p95 target for Sensei |
| Spam user creation | Rate limits and a capability-gated route; users are created only on the first recorded action; retention cron |

## 14. Decisions recorded (formerly open questions)

1. **Accounts:** anonymous WordPress users created on the first recorded action, with no email; an optional "Keep my progress" by email magic link later (owner answer 1). Learners are headless and never sign in to WordPress (builder's call, §5.6).
2. **Retention:** anonymous learners are deleted after 180 idle days (owner answer 2). Retention keeps claimed badges valid (builder's call, §6.3).
3. **Launch timing:** not decided. The import of local and relay records is kept proportionate (§7.4).
4. **Sensei's front end:** visible, labelled "the backend view", without per-learner progress (owner answer 16, §5.6).
5. **Certificates:** Sensei LMS Certificates is installed; the PDF sits alongside the badge and is delivered through the studio (owner answer 8, §7.5).
6. **Tested-out lessons and badges:** they count toward path badges, and the narrative states how many (owner answer 6). Carried-over lessons never count (reconciliation 6).
7. **LRS hostname:** `lrs.sqwrlz.com`, issuer `did:web:lrs.sqwrlz.com`, issuer name "Learn WordPress, reimagined" (owner answers 9 and 10).
8. **Answers in the record:** free-text answers are kept (owner answer 3).
9. **Source of truth:** content is edited in wp-admin, with `content/snapshot/` in git as the reviewable record (owner answer 17).
10. **Erase:** GDPR erase deletes the learner's official statements and revokes their badges (owner answer 4).
11. **Agent sign-in:** our own MCP authorization server in Functions replaces the bearer agent grant (owner answer 5, reconciliation 14).
12. **Plugin name:** Learning Ledger, slug `learning-ledger`, blocks `learning-ledger/*` (owner answer 11).

## Changes in this revision

- Title, header and companion list: the plugin is Learning Ledger; the standard's IRIs and extension identifier move to sqwrlz.com; the reconciliation rulings are a binding input and all builder's calls are provisional.
- §1: Sensei latency target is 90 s p95, with 30 s as an aim.
- §3.1: learners are headless and never sign in to WordPress; the LMS roadmap list follows owner answer 18.
- §4: LRS at `lrs.sqwrlz.com`; one writer, with direction 2 off and an echo guard; the course server imports the package into the LRS; new credential scopes; the connector generates its own secret; MCP authorization replaces agent grants; Sensei LMS Certificates provisioned; new app routes and a `.well-known` spike.
- §5: one Sensei course per path grouped by a program into one cmi5 course; the standard's IRI scheme with today's slugs; `learning-ledger/*` block names; Sensei completion when moveOn is met; Sensei pages visible as "the backend view"; certificate in the "What Sensei sees" panel.
- §6: accounts and retention decided; one registration per learner for the program; cold agents create the learner on the consent page; GDPR erase deletes statements and revokes badges; passkeys dropped.
- §7: shutdown delivery against the 90 s target; LRS-minted record view links; 2 MB State limit; a proportionate carry-over using `Administrative` plus the carried-over extension; badge rules, issuer name, claim page and claim-link contract; Sensei certificates delivered through the studio.
- §8: MCP authorization with a consent page that reads the studio session; `reveal_bug` noted.
- §9: one package for the program; importer in the plugin's scope; wp-admin editing decided.
- §10 to §12: existing pieces, interfaces S1 to S8 and P1 to P8, and constraints updated to match.
- §13: new spikes (`.well-known` OAuth metadata, headless certificates, `lrs.sqwrlz.com`); the standard goes public before the first official record; ChatGPT test per owner answer 21; risks updated.
- §14: open questions replaced by recorded decisions.
- §11.2: note that Learning Ledger v1 includes a cmi5 player for Sensei; the prototype does not depend on it (round 3).
