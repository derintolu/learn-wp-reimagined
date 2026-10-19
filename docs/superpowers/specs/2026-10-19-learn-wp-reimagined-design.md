# Learn WordPress, Reimagined: Design

Date: 2026-10-19
Status: approved by Derin, 2026-10-19
Owner: Derin (derintolu)

## 1. Intent

A fully working, publicly hosted concept that shows the WordPress community what learn.wordpress.org could become when AI faces the **learner**, not just the course author.

The pitch, verified against the live site and Make/Training posts in October 2026:

- learn.wordpress.org runs on Sensei LMS. Its Learning Pathways, relaunched in 2024, are fixed, role-based sequences of courses.
- The Training Team's 2026 AI work is aimed at **authors**. The April 2026 reusable prompts and Claude plugin help contributors draft lessons, facilitation guides and slides. The AI-Powered WordPress course (launched 18 Sept 2026, 9 h, 23 lessons) teaches site owners to use WordPress 7's built-in AI features.
- Nothing on the site adapts to the learner. There is no placement step, no branching and no tutor.

This demo fills that gap.

### What someone should walk away believing (the success test)

After five minutes with the demo, a visitor from the WordPress community should come away with three ideas:

1. **AI can enhance learning.** The AI visibly *changes their path* and explains why. It is not just a chat box beside a lesson.
2. **Coding is still essential.** The AI never hands over working code and moves on. The learner has to predict, explain, spot a bug or edit by hand before they advance.
3. **WordPress can still innovate.** The demo is built on the community's existing Learn content and looks unmistakably like WordPress, but modern and inviting.

## 2. Audience

Two audiences, one site. Derin will release it on Twitter/X; there is no target event or named recipient.

- **The wider WordPress community** (contributors, educators, curious users and developers) uses the demo itself. Copy speaks to learners first.
- **The Training Team and WordPress/Automattic leadership** read a **Proposal** page that reads like a well-made Make/Training post.

Derin's underlying goal is to show they could help rebuild Learn. That impression has to come from the quality of the work, not from a pitch. In practice, the site should:

- respect and credit the Training Team's existing content and process
- make product judgment visible through a "Design decisions" section
- quietly note that it runs on open models, Spacefast and WordPress Playground
- carry a clear but understated byline: "Concept and build by Derin Tolu", with GitHub and contact links

The quality bar for accessibility, performance and content accuracy is high, because these readers will check exactly those things.

## 3. Goals

- **Three learning paths**, all in the first demo, with 5 or 6 lessons each and at least two branching checkpoints per path:
  1. **Learner path.** New WordPress users. Adapted from *Beginner WordPress User*, ending with one or two lessons adapted from *AI-Powered WordPress*.
  2. **Block theme path (the showcase).** "Build your first block theme", taught **conversationally**: the tutor leads, asks and reacts, rather than presenting a page of text. Draws on *Beginner WordPress Developer* and the related Learn and Developer Handbook material on block themes and theme.json.
  3. **Vibe coder to coder.** For people who already build with AI but don't fully understand what it produces. The AI may write code, but the learner has to predict what it does, explain it, find a deliberately planted bug and change it by hand before moving on. Fundamentals are introduced only as they're needed: hooks (actions and filters), the template hierarchy, theme.json, enqueueing, and escaping and sanitizing.
- **Placement chat.** A short live conversation with the AI, 2 to 4 learner turns, that recommends a path and a starting lesson and says *why* ("You've built pages but never touched code, so we'll skip X and start at Y"). The learner can accept or choose a different path.
- **Branching checkpoints.** These sit inside lessons. A free-text or short-answer response is judged by the AI, which picks one of the **authored** branches (advance, review, or skip ahead). The branch result is shown visibly and explained.
- **Lesson tutor.** Docked beside every lesson. It is grounded in the current lesson's text and answers questions in WordPress's own terms. When it's unsure, it says so and links to the original Learn lesson or the Developer Handbook.
- **Bring your own agent (the headline feature, agreed with Derin).** The course is published as a **remote MCP server**, so learners can take it inside the agent they already pay for.
  - **Where it works:** Claude (custom connectors on Free, Pro and Max), ChatGPT (developer mode on Plus and above), Claude Code, Cursor and any other MCP client.
  - **How it splits the work:** the learner's agent becomes the tutor and their subscription pays for the thinking. The server supplies only authored content, rubrics, branch options and deterministic code checks, so branching and "catch the bug" stay reliable whichever model is behind it.
  - **The pitch line:** "Learn WordPress, in the agent you already use." This mirrors WordPress's own MCP Adapter and Abilities API, which expose WordPress to agents.
  - **The handoff from the site:** every lesson has a "Continue in your agent" action, and a **Connect your agent** page gives copy-paste setup for each client.
- **The "catch the AI" moment.** Each path has at least one moment where the AI's output contains a planted mistake and the learner is asked to find it. This is the clearest way to show that coding still matters.
- **Real content, credited.** Lessons are adapted from live learn.wordpress.org courses. Each one names its source lesson and links back to it.
- **Proposal page.** Aimed at the Training Team and leadership. It covers:
  - the gap, with sources
  - what the demo proves
  - a phased path onto the real Learn site, starting with a tutor and placement layer alongside Sensei rather than a rewrite
  - how authored branching fits the team's content workflow and its April 2026 authoring tools
  - cost per learner on open models, privacy, accessibility and maintenance load
  - a short "Design decisions" section on the tradeoffs
- **"How this works" page.** It says plainly what is real (live open-model AI, real Learn content, real branching) and what is concept (no accounts, unofficial, not affiliated). It credits Learn WordPress and the Training Team, and links to the GitHub repo.

## 3a. Learning record (agreed with Derin): local-first, like WordPress Playground

The learner owns their record and never loses their place, with no account needed.

- **One portable record.** A single versioned JSON document holds placement result, current path and lesson, checkpoint outcomes, branch history, code-check results and the learner's edited theme files.
  - Its format is documented in the repo so other tools (including a future Learn) could read it.
  - **The event history uses real, standards-compliant xAPI statements (agreed with Derin).**
    - Each statement has an actor, verb, object, result and context, using ADL verbs where they exist (`experienced`, `answered`, `passed`, `failed`, `completed`) and a documented custom verb IRI for `branched`.
    - The actor is an anonymous account, so there's no personal data.
    - The builder confirms the current xAPI spec version (1.0.3 or IEEE xAPI 2.0) and validates statements against it.
    - Statements can later be sent unchanged to a real learning record store, or to a WordPress.org or Sensei integration.
- **Saved in the browser by default.** The record lives in the browser's own private storage (OPFS, falling back to IndexedDB), the same approach as Playground's "save in this browser". It survives reloads and closing the tab.
- **Saved to a folder on your computer (optional).** Like Playground's "save to a local directory", the learner can pick a folder, and the record and their theme files are written there as they go (File System Access API).
  - This works in Chromium browsers. Elsewhere, there's a **Download / Restore** button for the record as a file.
  - When the folder is reopened, the learner picks up where they left off.
- **Agents share the same record.**
  - **Claude Code and other agents with local file access** read and write the record file in that folder directly. The MCP tools accept the record and return the updated one.
  - **Web agents (Claude.ai, ChatGPT)** have no local files. The learner can opt in to a temporary **anonymous relay**: a random learner code holds a copy of the record on the server so the agent session and the browser can sync. It stores no personal data, expires after 30 days of inactivity (*my call*), and can be deleted at any time.
- **Ready for WordPress.org login later.** All reads and writes go through a small "record store" interface: browser, local folder and relay now, and a **WordPress.org account** adapter later (OAuth through WordPress.org). That adapter would sync the same record to the learner's profile and, eventually, Sensei progress. It is not built in this demo, but the Proposal page describes it as the next phase.

## 4. Non-goals

- User accounts or sign-in **in this demo**. Signing in with a WordPress.org account is a planned later step (see 'Learning record').
- Integration with Sensei or the real learn.wordpress.org.
- Certificates, translations and multi-language support.
- An authoring or admin interface for creating lessons.
- Covering whole courses. Five or six excellent lessons per path beat thirty mediocre ones.

## 5. Anti-goals (what would make it a failure even if it technically works)

- **A generic chatbot.** The AI feels like it was bolted on, or gives wrong or outdated WordPress answers.
- **Code without understanding.** The AI gives working code and lets the learner move on without engaging with it.
- **Looking official.** The demo could be mistaken for, or seen as impersonating, WordPress.org or the Training Team.
- **Stuffy or dated.** It looks like a 2012 LMS.
- **Exposed or drained API key.** The key shows up in client code, or the public demo can be abused into a large bill.
- **An agent experience that feels worse than the site.** If connecting an agent is fiddly, or the agent goes off script, the headline feature undermines itself.
- **Fragile live demo.** If the AI is slow or down, the site breaks instead of degrading gracefully.

## 6. Look and feel (agreed)

Modern and inviting, not stuffy, but essentially WordPress.

- **WordPress.org base** (from the current Showcase and News pages): **EB Garamond** for big headlines, **Inter** for everything else, dark charcoal bands (#1E1E1E / #23282D), white content areas, thin divider lines, and the News page's split layout with a big serif title on the left and content on the right.
- **Colour:** WordPress blue **#3858E9** for links and buttons, and the lighter **#9FB1FF** on dark backgrounds.
- **Spacefast's energy layered on top** (spacefast.com was the reference): chat bubbles as the hero element, a hand-drawn **blue highlighter swipe** behind one or two key words per headline, small sketch-style icons for the three paths, and casual, warm copy ("Not sure where to start? Tell me what you're building.").
- **No official WordPress "W" logo.** The wordmark is "Learn WordPress, reimagined" with a visible hand-drawn-style **"unofficial concept"** sticker.
- **Homepage outline:**
  - A dark band with the headline "Learn WordPress, *your way*." (Garamond, with a blue swipe) and a **live** placement chat on the right.
  - A white band with the three path cards.
  - A band headed "Continue in the agent you already use": the MCP connector, with client logos shown as plain text names (not official marks) and a link to Connect your agent.
  - A band about how it works: real Learn lessons, live open-model AI, coding still matters.
  - A footer with credits, the repo link and the unofficial disclaimer.
- **Lesson page:** a clean reading column, with the tutor docked beside it in the same bubble style. Checkpoints are larger inline cards, and the branch result gets a satisfying, visible moment.
- **Responsive** down to phone width, where the tutor becomes a bottom sheet. WCAG AA contrast, full keyboard use and `prefers-reduced-motion` respected.

## 7. Constraints and decided "how"

- **AI:** **open models on Cloudflare Workers AI**, which fits WordPress's open source values. Billing is on Derin's Cloudflare account, hello@derintolu.com.
  - The backend runs on Spacefast Functions and calls the Workers AI REST API at `https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/ai/run/{model}`.
  - It authenticates with an API token scoped to Workers AI Read and Edit only. The token and account ID live **only** as Spacefast runtime secrets and never reach the browser.
  - Account: "Hello@derintolu.com's Account", ID `d7190c301009005101a1c084c9e48528`. Claude can work in it through Wrangler, which is already authenticated through the `CLOUDFLARE_API_TOKEN` env var, or through the Workers MCP once it reconnects.
  - The app gets its **own** Workers AI-only token, created through the API if the current token is allowed to create tokens, otherwise by Derin in the dashboard. The broad local token is never used as the app's secret.
- **Provider-agnostic, the way WordPress 7 builds AI.** WordPress 7 connects AI providers through its Connectors page rather than hard-wiring one vendor, and this demo mirrors that.
  - The backend has a small provider interface (chat with streaming, plus structured judging). It ships with:
    - **Cloudflare Workers AI** (open models), the default and the only provider that's live at launch
    - **Anthropic Claude**, an adapter that's off until an `ANTHROPIC_API_KEY` secret is added
  - **Kept open for WordPress's own AI.** The interface is designed so a later adapter can route through WordPress's AI layer: the WordPress 7 AI client and Connectors, or WordPress.com's built-in AI. That's the obvious path if Learn adopts this, but it isn't built now.
  - The provider and model are chosen per task (placement, judging, tutor) through server config/env, with no code change. Adding a provider means one new adapter file.
  - The "How this works" and Proposal pages say which provider is live, and make the point that the learning layer doesn't depend on any one model, just like WordPress.
- **Hosting:** Spacefast. Its *Functions* runtime (a `functions/` file router or a root `handler.ts` worker, standard `Request`/`Response`, outbound `fetch()` allowed) suits the backend. Secrets go in `.env.server`, which `sf publish` syncs as write-only secrets. An anonymous first publish syncs no env vars, so the Space must be claimed or published from an account before the key works.
- **Spacefast handoff:** Derin will provide a single-use handoff link. Fetch it **once**, with a plain GET, and follow the task inside. If it is expired, used or not found, **stop and ask Derin for a new one**. Do not retry or guess.
- **Repository:** `github.com/derintolu/learn-wp-reimagined`. Commit to `main` and push to `origin/main` immediately after each commit. Never push to `production` unless Derin explicitly says so.
- **Project folder:** `/Users/cedarstone/Projects/learn-wp-reimagined`.
- **Browser verification:** use the `agent-browser` CLI only. Never use Puppeteer or Playwright, and never drive Chrome by hand. This applies to subagents too.
- **Research before relying on memory:** lesson content, WordPress 7 behaviour, theme.json schema details and current API specifics must be checked against live sources while building.

## 8. Builder's calls (decided by Claude during design, open to override)

- **Authored branching, AI judgment.** Paths, lessons and branch targets are authored content (JSON/Markdown in the repo). The AI judges the learner's answer and chooses **among authored options** using structured output. It never invents a path. This keeps the demo reliable and the content reviewable.
- **Placement returns structured data:** `{ path, startLesson, skip[], reason }`, validated on the server against the authored content.
- **Graceful degradation:** if the AI errors or times out, placement falls back to "choose your path" buttons, checkpoints fall back to a simple multiple-choice version, and the tutor shows a friendly offline message. Lessons stay fully readable without the AI.
- **Cost and abuse protection:** a per-IP/session rate limit, an input length cap, `max_tokens` caps, prompts limited to the topic, and model choice by evaluation.
  - Candidate Workers AI models, as of Oct 2026: `gpt-oss-120b`, `glm-4.7-flash`, `llama-4-scout-17b-16e-instruct`, `kimi-k2.6`, `qwen3.8-27b`.
  - The builder runs a small evaluation set (placement transcripts, checkpoint answers, tutor questions, WordPress accuracy) and picks the best quality per cost. Different models for tutoring and judging are fine.
  - Judging must use structured or JSON output, validated on the server.
  - The builder checks current Workers AI docs for streaming, JSON mode and an OpenAI-compatible endpoint.
- **Spending cap (agreed with Derin): $100 a month, hard, across all providers.**
  - The server estimates cost per request from token usage and per-model prices kept in config, and records it in persistent storage (Spacefast Database or another durable store).
  - At the cap, built-in AI features switch to their no-AI fallbacks until the 1st of the next month (UTC). The site shows a friendly notice whose main action is "Continue in your own agent". The MCP path costs Derin almost nothing, because it runs no inference on Derin's account, so it keeps working at the cap.
  - *My call:* a $10 daily sub-cap, so a viral day can't use up the whole month. It resets at 00:00 UTC.
  - Spend is visible to Derin through a simple protected stats endpoint or the logs.
- **MCP server design:**
  - **Hosting:** the MCP server runs on the same Spacefast Functions backend over the Streamable HTTP transport, with no auth, because the content is public. Progress is linked through the learner code.
  - **Tools** (names are illustrative):
    - `list_paths`
    - `start_placement`, which returns placement questions plus a rubric and the allowed outcomes
    - `get_lesson` / `next_beat`, which return the authored beat and its teaching instructions
    - `submit_checkpoint`, where the server runs any deterministic checks. For free-text answers, the agent judges against the authored rubric and must call `choose_branch` with one of the authored options, which the server validates.
    - `check_code`, deterministic checks on the learner's edited snippet
    - `get_progress` / `link_progress`, which use the learner code
  - **Teaching behaviour travels with the content.** Tool descriptions and beat payloads include the pedagogy rules: don't hand over answers, make the learner predict and explain, never reveal the planted bug. That way any agent teaches the same way.
  - **Compatibility testing:** at minimum Claude Code and Claude.ai custom connectors. Add ChatGPT developer mode if a Plus account is available.
  - **Safety:** learner text is treated as data, not instructions, in everything the server returns. Inputs are size-capped and rate-limited per IP and learner code. The server never returns anything that isn't authored content or check results.
- **Streaming** tutor responses, so it feels alive.
- **Build order:** there is no deadline. The Block theme showcase path is built end to end first, then the Learner path, then Vibe coder to coder.
- **No outside content reviewer.** The self-verification gate above applies, and the site states that the lessons are "adapted from Learn WordPress, not reviewed by the Training Team".
- **Block theme path finale:** the learner's theme files (style.css, theme.json, templates) are assembled during the path and offered as a download, plus an **"Open in WordPress Playground"** link that boots the theme through a Playground blueprint. This is a cheap, strong "WordPress can still innovate" moment, built only if the blueprint route works cleanly.
- **Frontend stack:** left to the builder, but it must be lightweight, publish cleanly on Spacefast, and keep lesson content as plain files.
- **Hand edits happen in a lightweight in-browser code editor** (for example CodeMirror). Each edit goes through two checks:
  - **Authored deterministic checks first.** These are string, regex or JSON-structure tests on the PHP, JSON or CSS, and they decide pass or fail.
  - **The AI second.** It gives feedback in plain words.
  - **AI down:** the deterministic checks still run, so learners can still advance.
  - **Block theme files:** the learner edits starter templates provided by the course, so every learner's theme starts from a known good base.
- **The conversational lessons are authored "beats".** Each lesson is a sequence of authored teaching beats, and each beat has a goal, the key content and a question. The AI delivers each beat in its own words and reacts to the learner's replies, but can't move outside the beat. If the AI is down, the beats show as a normal readable lesson.
- **Planted bugs are authored and fixed, then labelled honestly.** The snippet is generated by an AI model ahead of time and the bug is planted by the course author, so every learner sees the same reliable mistake. The UI labels it "AI-written code. We planted one bug. Find it." The "How this works" page explains this.
- **The 5-minute test shapes lesson one.** The first lesson of every path contains a branching checkpoint and, where it fits, the catch-the-AI moment. Placement plus lesson one is designed to take about 5 minutes.
- **Name and URL:** no custom domain. The Spacefast space slug is `learn-wp-reimagined`, using the abbreviation "WP", which the WordPress Foundation trademark policy allows. "WordPress" appears only in descriptive copy with the unofficial disclaimer, never in a domain.
- **Content accuracy gate:** every adapted lesson and tutor grounding text is checked against the live Learn lesson and the current Developer Handbook. The source URL is recorded in each lesson file.

## 9. Content sourcing and credit

- Source courses (all live on learn.wordpress.org as of October 2026): *Beginner WordPress User* (24 lessons), *Beginner WordPress Developer* (59 lessons), *AI-Powered WordPress* (23 lessons), plus block theme and theme.json material from Learn and the Developer Handbook.
- License: the Training Team agreed in 2021 to use CC BY-SA 4.0 for Learn content (WordPress/Learn GitHub issue #120). The current lesson pages show no license text. Treat the content as CC BY-SA 4.0: attribute and link back on every lesson, mark lessons as adapted, and release the adapted lesson content under CC BY-SA 4.0 in the repo. Code is GPL-2.0-or-later, matching WordPress.
- The builder picks the specific lessons within each source, guided by the 5 or 6 lesson budget and the branching needs above.

## 10. Left to the builder

- Exact lesson selection and adaptation within each path.
- Frontend framework and build tooling.
- Specific Workers AI models (within the evaluation above), prompt wording, rate-limit values and token caps.
- Illustration and icon production (sketch style, WordPress blue).
- Exact copy, apart from the agreed tone and the required disclaimers and credits.
