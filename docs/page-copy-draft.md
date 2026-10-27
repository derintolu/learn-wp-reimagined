# Page copy draft: How this works and Proposal, by phase

Status: draft for Derin's approval. Not committed.
Sources: the Sensei backend prototype design (`docs/superpowers/specs/2026-10-27-sensei-backend-prototype-design.md`, sections 6.4, 10 and 13) and the current copy in `src/pages/HowItWorks.tsx` and `src/pages/Proposal.tsx`.

## How to use this file

- One block per phase. Each block names the flag that turns it on. A page only gains the copy in the phase that ships the behaviour (design section 13, last line). Copy marked "with flag on" renders only when the flag is true.
- Each edit is one of ADD (new sentences), REPLACE (the quoted current sentence is swapped) or REMOVE (the quoted sentence goes). Quotes are from the current page text. When an earlier phase has already replaced a sentence, the REPLACE quotes the earlier phase's new text and says so.
- Numbers in braces, such as `{RETENTION_DAYS}`, come from constants (`src/shared/course-meta.ts`), as `MCP` and `CAP` do today. The figures in this draft (180 days, 4.26.4, 90 seconds) are the design's values and must be checked against the constants when the page is built.
- Tone: plain, specific, warm, unofficial. Anything not yet measured is said to be a target. Nothing says "Learn does this".
- Phases 0 and 5 change no page copy, and the reasons are given in their blocks.

## Phase 0: spikes

Flag: none. No product change, no page change.

## Phase 1: server authority

Flag: `FEATURES.serverEvents` (`src/config.ts`) and `SERVER_FLAGS.serverEvents` (`functions/_lib/config.ts`).

What it ships: checks re-run on the server, and statements built on the server. The record is still in the learner's browser. Nothing a learner sees changes.

### How this works

No change to "A record you own". Everything it says is still true in this phase.

ADD one sentence to the end of the "Code checks that don't guess" bullet in What's real, with flag on:

> The same checks also run on the server, and only the server's result counts, so a browser can't claim a fix passed when it didn't.

Reason: it is true once `/api/events` re-runs `checks.ts`, and it is the honest answer to "can I cheat?". If Derin prefers no page change this early, drop it; nothing else depends on it.

### Proposal

No change.

## Phase 2: sessions without WordPress

Flag: `FEATURES.sessions` and `SERVER_FLAGS.sessions`.

What it ships: a random session on the server, set as a cookie at your first recorded step, and "Delete my data" in the record menu. The record itself is still local. There is still no WordPress account.

### How this works

"What's concept" keeps "There are no accounts" in this phase, because it is still true. Change only the second half.

REPLACE (with flag on):

> "Nobody signs in, and nothing syncs between your devices unless you move the record yourself. Signing in with a WordPress.org account is a possible next step, and it isn't built."

with:

> Nobody signs in. At your first recorded step the site gives your browser a random session so the server can tell your steps apart. It holds no name or email, and "Delete my data" in the record menu removes it. Nothing syncs between your devices unless you move the record yourself. Signing in with a WordPress.org account is a possible next step, and it isn't built.

### Proposal

REPLACE in Privacy (with flag on):

> "The record lives in the learner's browser, or in a folder they pick, and they can download or restore it at any time. The record isn't kept on a server unless they opt in to the relay below."

with:

> The record lives in the learner's browser, or in a folder they pick, and they can download or restore it at any time. The server keeps only a random session, with no name or email, and the learner can delete it from the record menu. The record isn't kept on a server unless they opt in to the relay below.

Reason: sessions are server-side state, so the old "not kept on a server" sentence needs this qualifier to stay accurate.

## Phase 3: content in Sensei

Flag: `FEATURES.wordpressContent` and `SERVER_FLAGS.wordpressContent`. Task 23 defines the constant `SENSEI_VERSION = '4.26.4'` in `src/shared/course-meta.ts`; the copy reads it from there.

What it ships: the 18 lessons live in Sensei on the prototype's own WordPress; the studio reads them from there. Sensei's own lesson pages are public, labelled "the backend view". Learners are not on Sensei yet (phase 4).

### How this works

ADD a bullet to What's real (with flag on):

> **Real Sensei LMS.** The lessons are stored in Sensei LMS {SENSEI_VERSION}, the same plugin Learn runs on, on a WordPress install that belongs to this prototype. Authors edit them in the block editor, and the studio shows the edit. You can read any lesson as Sensei shows it on [the backend view](/course/<block-theme course slug>/). That view is Sensei's own page, with no AI and no branching, and it is not the learner experience. Take the lesson in the studio.

REPLACE in "Real branching, written by hand" (with flag on):

> "authored as plain files in the repo"

with:

> authored in Sensei, with a reviewable copy committed to the repo

REPLACE in What's concept (with flag on):

> "Nothing here talks to learn.wordpress.org or Sensei, and progress here doesn't count there."

with:

> This is not learn.wordpress.org. The Sensei here is the prototype's own install, with the prototype's own lessons, so nothing you do counts toward anything on Learn. Your progress does not appear in Sensei yet.

Reason: the second sentence of the old line is still true, the first half is no longer. "Not on Sensei yet" stays accurate until phase 4.

Add to the Sources list (with flag on): `content/snapshot/`, "The lessons as exported from Sensei, committed so changes can be reviewed."
Remove from Sources (with flag on): `content/paths/` (YAML is deleted in this phase).

### Proposal

REPLACE the first sentence of "Phase 1: a tutor and placement beside Sensei" (with flag on):

> "Lessons stay in Sensei, written and reviewed as they are now."

with:

> Lessons live in Sensei, written and reviewed as they are now. In this concept they do: all 18 are stored in Sensei, and you can read each one on [the backend view](/course/<block-theme course slug>/).

Keep the rest of that section ("A tutor sits beside each lesson ...") and add at its end:

> The tutor and placement are running in this concept. What isn't shown is Sensei progress (phase 3 below) and the Training Team's review of these lessons.

In "Upkeep", REPLACE (with flag on):

> "Lessons, checkpoints and planted bugs are plain YAML files, checked at build time, so a broken reference fails the build rather than the learner."

with:

> Lessons, checkpoints and planted bugs are authored in Sensei and exported to a committed snapshot, which is checked at build time, so a broken reference fails the build rather than the learner. Because the content is edited in wp-admin, the accuracy notes have to be updated in the same snapshot commit as any edit.

In Sources `src-content`, REPLACE "The lessons, checkpoints, branches and planted bugs, as YAML." with "The lessons, checkpoints, branches and planted bugs, as exported from Sensei." and point it at `content/snapshot/`. Also update `src-build` ("The build-time validator for the content.") to say it validates the snapshot.

REMOVE nothing else. The sentence "If the AI is down, the lessons read exactly as they do today" is now literally supported by the backend view; leave it.

## Phase 4: learners in Sensei

Flag: `FEATURES.senseiLearners` and `SERVER_FLAGS.senseiLearners`.

What it ships: at your first recorded step, a WordPress user with no email and no password is created for you, enrolled in Sensei, and tied to your session. You never sign in to WordPress. The record is still local.

### How this works

REPLACE the whole bullet in What's concept (with flag on; if phase 2 has already changed it, quote the phase 2 text):

> "**There are no accounts.** Nobody signs in, and nothing syncs between your devices unless you move the record yourself. Signing in with a WordPress.org account is a possible next step, and it isn't built."

with:

> **You get an anonymous account.** At your first recorded step the site creates a WordPress user for you in this prototype's Sensei, so Sensei can enrol you. It has a random ID, no name, no email and no password, and you never sign in to it. "Delete my data" in the record menu deletes it. Nothing syncs between your devices unless you move the record yourself. Signing in with a WordPress.org account is not built.

ADD to the "Real Sensei LMS" bullet from phase 3:

> Sensei enrols you in a path when you start it. Sensei's own pages are the same for everyone and don't show your progress.

Do not add "your progress appears in Sensei" here. That is phase 6.

### Proposal

REPLACE the design decision (with flag on):

> "**A record the learner keeps, instead of accounts.** No sign-up, and no personal data held. <em>The cost:</em> progress doesn't follow a learner between devices unless they move the file. Clearing browser data loses it unless they saved it to a folder or downloaded it. Saving to a folder only works in Chromium browsers."

with:

> **An anonymous account, not a sign-up.** Learners start with no form. The first recorded step creates a Sensei user with a random ID and no email, and the learner can delete it. *The cost:* the site now holds a server-side user for every learner who starts, which needs rate limits and a clean-up rule, and progress still doesn't follow a learner between devices unless they move the file. An optional "keep my progress" by email link is a possible next step, and isn't built.

REPLACE in Privacy (with flag on; builds on phase 2):

> "The server keeps only a random session, with no name or email, and the learner can delete it from the record menu."

with:

> The server keeps a random session and an anonymous Sensei user with no name or email, and the learner can delete both from the record menu.

REPLACE the "Phase 2: keep the record with a WordPress.org login" heading with "Phase 2: keep the record, with or without a login", and its first sentence is unchanged. ADD at the end of that section:

> In this concept the learner already has an anonymous account that Sensei tracks. What's still open is only the harder step, linking it to a WordPress.org login.

## Phase 5: the record in the LRS, in shadow

Flag: `SERVER_FLAGS.lrsShadow` (server only; no `FEATURES` constant).

What it ships: every statement is also posted to the LRS at `lrs.sqwrlz.com`, for comparison. The learner's record is still the local one, and nothing the learner sees changes.

### How this works and Proposal

Page copy: none for the behaviour. The record is not yet official in this phase, and the pages must not say it is (anti-goal "overclaiming").

One privacy point that cannot wait: in shadow mode the learner's free-text answers are sent to and stored in the LRS. Decision for Derin: either (a) accept a one-sentence addition to Privacy in both pages, below, or (b) run phase 5 only with sessions created for the test, with no public traffic. This draft assumes (a).

ADD (How this works, in the "A record you own" bullet, and Proposal Privacy, with `SERVER_FLAGS.lrsShadow` mirrored by a `FEATURES.lrsShadow` constant in `src/config.ts` that exists only for the page):

> While we test a separate record store, a copy of your steps, including the answers you type to checkpoints, is also kept on a second server, under your random ID. Your local record is still the one the site uses. "Delete my data" removes the copy.

If (b), no copy is needed and this block stays empty. In either case, the plan's Task 33 should check that "Delete my data" does erase the shadow copy before the flag goes on.

## Phase 6: flip the record

Flag: `FEATURES.officialRecord` and `SERVER_FLAGS.officialRecord`. Task 41 adds `RETENTION_DAYS = 180` and `LRS_HOST = 'lrs.sqwrlz.com'` to `src/shared/course-meta.ts`.

What it ships: the official record is in the LRS, written only by the course server. The browser keeps a working copy for speed. Completion reaches Sensei through the LRS; skipped lessons show as "tested out". Export, "View in the LRS", delete and a 180-day idle clean-up exist. Existing local records can be carried over once. Badges and certificates are not in this phase.

### How this works

REPLACE the whole "A record you own" bullet in What's real (with flag on):

> "**A record you own.** Your progress is one JSON file of real xAPI statements, under an anonymous ID with no name or email. It lives in your browser, or in a folder you pick (in Chromium browsers), and you can download or restore it at any time. The format is <Cite to="src-record">documented in the repo</Cite>."

with:

> **A real record, kept in a real LRS.** Your progress is a set of xAPI statements, the standard format for learning records, under a random ID with no name or email. The official copy is kept in a learning record store at {LRS_HOST}, a separate WordPress install running the Learning Ledger plugin. Only the course server writes to it. You can read it, download it, and see it on the store's own page from the record menu, but you can't edit it. Your browser keeps a working copy so the lesson stays quick, and your files can also be saved to a folder you pick (in Chromium browsers). The format is <Cite to="src-record">documented in the repo</Cite>.

ADD a bullet to What's real (with flag on):

> **Progress that reaches Sensei.** When you finish a lesson, or skip one by showing you already know it, the record store tells Sensei, which marks the lesson complete. A skipped lesson is marked complete in Sensei and shown as "tested out" in your record menu and in the "What Sensei sees" panel. Sensei's own reports only say "Complete". We aim for Sensei to catch up within 30 seconds and have set 90 seconds as the limit; both are targets we are measuring, not a promise.

Reason: p95 90 s is a gate to be measured by Task 40, so the page says target. If Task 40 reports a measured number, replace the sentence with the number.

ADD a subsection in the "Your own agent" band or as a new band "Where your record lives" (with flag on). Replaces the relay paragraph only in phase 7; in this phase add it beside it:

> **Where your record lives.** It lives on our servers under a random ID, in two places: the record store at {LRS_HOST}, and the Sensei user that tracks your lessons. It holds your steps, the answers you typed to checkpoints in your own words, and the files you edited, because those are what resuming and a future badge need. It holds no email unless you add one, which isn't built yet. A learner with no activity for {RETENTION_DAYS} days is deleted, and "Delete my data" in the record menu deletes it at once: your steps and files in the record store, your Sensei user and its progress, and any connected agents. "Download my record" gives you a copy first. There is no third-party analytics.

REPLACE the "Real Sensei LMS" sentence from phase 4 (with flag on):

> "Sensei's own pages are the same for everyone and don't show your progress."

with:

> Sensei's own pages are the same for everyone and don't show your progress. Your progress in Sensei is shown in the "What Sensei sees" panel in the studio.

REPLACE in What's concept (with flag on):

> "Your progress does not appear in Sensei yet."

with:

> This Sensei is the prototype's own, so your progress here doesn't count on Learn.

REPLACE the clause in What's concept `It's unofficial` stays. In the "anonymous account" bullet, ADD: "Records from before this change can be brought over once; those lessons show as complete but never count toward a badge."

### Proposal

REPLACE Phase 2 and Phase 3 sections (with flag on). Current Phase 2 text beginning "The learning record goes through a small record store interface ..." and Phase 3 "Once a learner is signed in, completed lessons ..." become:

> **Phase 2: the record in a store, not in the browser.** In this concept the learner's record is written by the course server to a separate learning record store, and read back into the studio. The store is a separate WordPress install running the open Learning Ledger plugin, which is how a busy record store would be run next to a busy Learn site. The browser keeps a working copy only. Not built: linking the anonymous record to a WordPress.org account. One open question remains there: a record under an anonymous ID can't be rewritten, so linking it to a profile needs an agreed approach, such as a signed "linked" statement.
>
> **Phase 3: Sensei progress.** In this concept, finishing a lesson in the studio, or in an agent, marks it complete for that learner in Sensei, through the record store, with skipped lessons marked complete and recorded as "tested out". Sensei has no REST route for this, so the plugin calls Sensei's PHP from inside WordPress. A real Learn adoption would need the Sensei maintainers' view on that, on lesson progress having only "in progress" and "complete", and on whether "tested out" belongs in Sensei itself.

REPLACE the Privacy bullet list (with flag on). Replace both of:

> "The record lives in the learner's browser, or in a folder they pick, ..."
> "For web agents, which can't read local files, the learner can opt in to a relay. ..."

with (phase 7 removes the relay sentence anyway; if the relay is still live, keep it unchanged):

> The official record is stored on our servers under a random ID, with no name or email. It includes the answers a learner types to checkpoints, in their own words, because the record, and later a badge, link to that evidence.
> It is kept in a separate store at {LRS_HOST}, owned by the same person, with no third-party analytics.
> A learner who is idle for {RETENTION_DAYS} days is deleted.
> A learner can download their record at any time and delete it at any time from the record menu. Deleting removes the statements, files, Sensei user and progress, and connected agents.
> What a learner types to the AI is sent to the model provider to get a reply.

REMOVE nothing outside those lines.

ADD a design decision (with flag on):

> **A separate record store.** The official record is kept apart from Sensei and from the learner. Only the course server writes it, so a browser, or an agent, can't make it say something the server didn't decide. *The cost:* a second WordPress install to run, an outbox so that a slow store doesn't slow the lesson, and Sensei lagging the store by a short while. A daily check compares the two and reports any difference.

Sources: add `lrs.sqwrlz.com` is not a repo file; add `docs/record-format.md` (stays), `functions/_lib/lrs/` (what: "The client for the record store.") and the Learning Ledger repo link `https://github.com/derintolu/learning-ledger` (what: "The plugin that is the record store and the Sensei connector.").

## Phase 7: agent path on the standard

Flag: `FEATURES.agentOnStandard` and `SERVER_FLAGS.agentOnStandard`.

What it ships: the MCP server is replaced by the reference server of the open course-xapi-mcp standard. Agents sign in through MCP authorization with a consent page that reads your studio session. The handle goes away. "Disconnect agents" is added to the record menu. Agent progress goes through the same server path, so the studio, the record store and Sensei agree.

### How this works

REPLACE the "A real MCP server" bullet (with flag on):

> "**A real MCP server.** The whole course is a remote MCP server. Add it to Claude, ChatGPT, Claude Code, Cursor or any MCP client and your agent becomes the tutor, with the same lessons, checks and branches. <a href="/connect">Connect your agent</a>."

with:

> **A real MCP server, on an open standard.** The whole course is a remote MCP server built on [course-xapi-mcp](https://course-xapi-mcp.sqwrlz.com/), an open standard for courses you take in your own agent. Add it to Claude, ChatGPT, Claude Code or another MCP client, and your agent becomes the tutor, with the same lessons, checks and branches. The first time, your agent opens a page on this site where you allow it to continue your course as you. There is nothing to paste. What your agent does lands in the same record as the studio. [Connect your agent](/connect).

Do not list a client as working until Task 47's checks have run in it. The Connect page states which clients passed.

REPLACE the "Your own agent" band (the paragraph and the list):

> "When you take the course into an agent, the server keeps your progress under a random record handle that only you hold. It stores no personal data, expires after {MCP.relayDays} days without use (the record store), and you can delete it at any time from Connect your agent."

with:

> When you take the course into an agent, the agent signs in as you through a consent page. Its progress goes into the same record as the studio, and "Disconnect agents" in the record menu cuts it off. Access tokens last an hour and refresh tokens expire after 30 days without use. Deleting your data deletes them too.

REPLACE the limits list item (token-based limits replace handle-based):

> "{MCP.perHandle} tool calls every {MCP.windowMin} minutes for each record handle"
> "{MCP.create} new records every {MCP.windowMin} minutes, across everyone"

with:

> {MCP.perToken} tool calls every {MCP.windowMin} minutes for each signed-in agent
> {MCP.create} new sign-ins every {MCP.windowMin} minutes, across everyone

The numbers `perToken` and the new-sign-in limit are set by Task 45 and are not in the design; do not publish figures until they are in `src/shared/course-meta.ts`.

REMOVE the Source `src-store` ("How long an agent record is kept.", `functions/_lib/mcp/recordStore.ts`) when the relay is removed, and add `vendor/course-xapi-mcp/` (what: "The standard's reference server, vendored.").

If the relay had real users at the switch (Task 47), keep for 30 days: "Agent progress saved under an old handle can be brought back until {date}. After that the old store is deleted." Otherwise write nothing.

### Proposal

REPLACE the design decision (with flag on):

> "**The record handle is the only key to an agent record.** There are no logins for the relay, so there's nothing personal to leak. <em>The cost:</em> anyone who has a learner's handle can read that record. The relay is rate-limited, but the handle has to be kept private, like a password."

with:

> **Agents sign in, instead of holding a handle.** An agent connects with MCP authorization, the same standard sign-in other MCP servers use, and the learner approves it on a page that already knows who they are. *The cost:* an authorization server to run, and not every MCP client supports the flow; the Connect page says which ones passed. We don't fall back to a secret handle.

REPLACE in "An MCP server, so learners can bring their own agent" decision: "(<Cite to="src-vendor">the course server</Cite>)" keeps its link, now to the standard's reference server.

REPLACE the Privacy relay bullet (if not already removed): see phase 6.

## Phase 8: badges, certificates, pages, cleanup

Flag: `FEATURES.badges` (defined by Task 49) and, where used, `SERVER_FLAGS.badges`. The final page rewrite (Task 51) lands in this phase and removes all phase flags from the pages, keeping the on-paths.

What it ships: path badges signed by the LRS as Open Badges 3.0, claimable from the studio; the Sensei certificate download if the headless-render spike passed; the final rewrite of the two pages; flag removal; relay removal.

### How this works

ADD bullets to What's real (with flag on):

> **Badges you can verify.** Finishing a path earns a badge, issued as an [Open Badges 3.0](https://www.imsglobal.org/spec/ob/v3p0/) credential and signed by the record store as "Learn WordPress, reimagined". You claim it from the studio, add an email or a wallet on the store's claim page, and download or share it. Lessons you tested out count toward the badge, and the badge says how many. Lessons carried over from an older local record never count. The badge does not carry your random ID.

> **A Sensei certificate.** When a path's course is complete, Sensei LMS Certificates issues its usual PDF, and the studio offers it as a download from the "What Sensei sees" panel. The certificate is a document. The badge is a credential anyone can verify. [Use only if Task 50's spike passed. If it failed, write: "Sensei issues its certificate when a path is complete. The studio shows that it exists, but can't yet download it."]

ADD a sentence to "Where your record lives" (from phase 6), with flag on:

> Deleting your data also revokes any badges you claimed, and a revoked badge stops verifying. We don't revoke badges when a learner just goes idle.

ADD to What's concept, "It's unofficial":

> The badges are issued by this prototype, not by WordPress.org, and are not an official WordPress credential. They show up as signed by "Learn WordPress, reimagined" and nothing else.

Keep the existing "The lessons aren't reviewed", "It's small" and "unofficial" bullets, and reword the "Sensei" line so it ends: "Sensei's own pages are the backend view, not the learner experience."

If the decision on `lrs.sqwrlz.com` as a DNS name falls back (design 13.1), add to the badges bullet: "The badge's issuer is a web address on a temporary host, so some wallets won't resolve it." Decide before any badge is issued.

REPLACE the Credit paragraph "It runs on Cloudflare Workers AI, Spacefast and WordPress Playground." with:

> It runs on Cloudflare Workers AI, Spacefast, WordPress Playground, Sensei LMS and the open Learning Ledger plugin and course-xapi-mcp standard.

### Proposal

REWRITE "A phased path onto Learn" heading text to show the three original phases as demonstrated, with a link to the running piece for each. Add a lead-in sentence:

> None of this needs Learn to be rebuilt. Each phase is useful by itself, and the next one can wait. Phases 1 to 3 below are no longer only proposed: each is running in this concept, with a link to where you can see it.

For each of the three phase headings, ADD a closing line:

> Phase 1 (tutor and placement): "See it: start the placement chat, then read the same lesson on [the backend view](/course/<block-theme course slug>/) to see what Learn shows today."
> Phase 2 (the record): "See it: open the record menu, then the record on the record store's own page."
> Phase 3 (Sensei progress): "See it: finish a lesson, then open 'What Sensei sees'."

ADD three new bands or sub-sections (a new band "The standard, the plugin and the record store" after "A phased path onto Learn"):

> **A standard, so the course isn't tied to this site.** The course is described in [course-xapi-mcp](https://course-xapi-mcp.sqwrlz.com/), an open specification built on cmi5 for courses a learner takes in their own agent. A course server written to it can serve any course package, and any compliant agent can take any such course. We believe this is the right layer for Learn to adopt rather than a site-specific API. The standard is by the same author as this concept and has not been reviewed outside it.

> **A plugin, so Sensei doesn't change.** Learning Ledger is a WordPress plugin with two roles that can run on the same or different installs: a record store (an xAPI endpoint with badge issuing), and a connector that applies the store's records to an LMS. It has a built-in Sensei integration, and puts the checkpoints and planted bugs in lessons as blocks. In this concept it runs in both roles, on two installs. Other LMS integrations are on its roadmap and aren't built. Nothing in Sensei is patched.

> **Why the record store is separate.** A record store takes many small writes. The recommended setup is to run it apart from the site learners read, so a busy store can't slow lessons. The concept runs it that way, on its own address, and the same address is the identity that signs the badges, so that address has to stay registered.

Update "Cite" sources (Task 51): add `vendor/course-xapi-mcp/`, the Learning Ledger repo link, `functions/_lib/lrs/`; remove `src-relay`, `src-store-if` and `src-vendor` pointing at `vendor/learning-mcp/`. Confirm each cited path exists (Task 51's glob test).

REPLACE the Cost section's final paragraph sentence (no change to numbers):

> "Learners who bring their own agent aren't affected: the agent does the thinking on their own subscription, and no model runs on this site's account."

Keep it. Add after it: "The record store, Sensei and the sign-in add no model cost; they are plain hosting."

ADD to Accessibility (do not claim an audit): "The new panels, the consent page, the claim page and the backend-view banner were checked by keyboard and at phone width. They have not had an outside audit." Include only after Task 53's checks have run.

Revoked-badge sentence is required by Task 51's test: "Deleting your data revokes any badges you claimed, and a revoked badge stops verifying." Use the exact wording on both pages.

## Phrasing rules for the page builder

- "Concept", "unofficial" and "not reviewed by the Training Team" stay on both pages in every phase.
- Never write "runs on Sensei like Learn" for anything that isn't running behind its flag.
- Describe Sensei's own pages only as "the backend view".
- Never state a measured number the code does not hold. Latency is a target until Task 40 reports.
- No emojis.
