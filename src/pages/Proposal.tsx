/**
 * Sources for "The gap", each checked live with WebFetch:
 *
 * - https://make.wordpress.org/training/2024/08/02/meet-the-new-learn-wordpress/ (checked 2026-10-22).
 *   "Meet the new Learn WordPress", Kathryn Presner, 2 Aug 2024. The relaunch: Learning Pathways guide
 *   learners "from beginner through intermediate to advanced levels"; User and Developer pathways first;
 *   the new theme integrates Sensei LMS blocks, and Sensei powers the courses and lessons.
 * - https://learn.wordpress.org/learning-pathway/user/ (checked 2026-10-22). The User pathway lists
 *   Beginner, Intermediate and Advanced WordPress User. Filters by topic and level; no placement step,
 *   recommendation or adaptive feature.
 * - https://make.wordpress.org/training/2026/04/10/new-ai-powered-tools-for-creating-wordpress-learning-materials/ (checked 2026-10-22).
 *   Destiny Kanno, 10 Apr 2026. AI prompts (any platform) and a Claude plugin for
 *   co-writing course content, facilitation guides and facilitator slides, with human review. Aimed at
 *   contributors and facilitators; no learner-facing feature.
 * - https://make.wordpress.org/training/2026/09/18/the-ai-powered-wordpress-course-is-now-live-on-learn-wordpress/ (checked 2026-10-22).
 *   Destiny Kanno, 18 Sep 2026. Teaches the AI built into WordPress 7.0; modules 1-3
 *   for anyone who manages or publishes on a site, module 4 introduces developer APIs; about 9 hours.
 * - https://learn.wordpress.org/course/ai-powered-wordpress/ (checked 2026-10-22). The course page; its
 *   HTML loads Sensei LMS assets (sensei-blocks-frontend-js and others), which confirms Sensei is live.
 *
 * Everything else on the page comes from files in this repo, listed in SOURCES. The cost figure is the one
 * constant in src/shared/course-meta.ts that How this works also uses.
 */
import type { ComponentChildren } from 'preact';
import { Swipe } from '../components/Swipe';
import { FEATURES, REPO_URL } from '../config';
import { BACKEND_VIEW_PATH, COST_PER_1000_LEARNERS_USD } from '../shared/course-meta';
import { usePageTitle } from '../usePageTitle';

// These mirror server constants; tests/components/proposal.test.tsx checks each against its source file.
const CAP = { month: 100, day: 10 };
const RELAY_DAYS = 30;

const LEARN = {
  relaunch: 'https://make.wordpress.org/training/2024/08/02/meet-the-new-learn-wordpress/',
  userPathway: 'https://learn.wordpress.org/learning-pathway/user/',
  aiTools: 'https://make.wordpress.org/training/2026/04/10/new-ai-powered-tools-for-creating-wordpress-learning-materials/',
  aiCoursePost: 'https://make.wordpress.org/training/2026/09/18/the-ai-powered-wordpress-course-is-now-live-on-learn-wordpress/',
  aiCourse: 'https://learn.wordpress.org/course/ai-powered-wordpress/',
};

const SOURCES = [
  { id: 'src-spec', file: 'docs/superpowers/specs/2026-10-19-learn-wp-reimagined-design.md', what: "The design spec: the success test (section 1), the learning record (3a) and the builder's calls (8)." },
  { id: 'src-eval', file: 'docs/model-eval.md', what: 'Model evaluation, October 2026: the models, how they were chosen, and the cost estimate.' },
  { id: 'src-budget', file: 'functions/_lib/budget.ts', what: 'The monthly cap and the daily sub-cap.' },
  { id: 'src-record', file: 'docs/record-format.md', what: 'The learning record format and its xAPI statements.' },
  { id: 'src-store-if', file: 'src/record/store.ts', what: 'The record store interface that a WordPress.org adapter would implement.' },
  { id: 'src-relay', file: 'functions/_lib/mcp/recordStore.ts', what: 'The agent relay, and how long it keeps a record.' },
  { id: 'src-content', file: 'content/paths/', what: 'The lessons, checkpoints, branches and planted bugs, as YAML.' },
  { id: 'src-schema', file: 'src/shared/schema.ts', what: 'The content schema: every checkpoint needs advance, review and skip branches and a fallback.' },
  { id: 'src-build', file: 'scripts/build-content.ts', what: 'The build-time validator for the content.' },
  { id: 'src-checks', file: 'src/shared/checks.ts', what: 'The deterministic code checks.' },
  { id: 'src-content-tests', file: 'tests/content/', what: 'Tests that run each code check against the planted bug, the fix and the starter file.' },
  { id: 'src-motion', file: 'tests/styles/reduced-motion.test.ts', what: 'The guard that every animation has a reduced-motion override.' },
  { id: 'src-accuracy', file: 'docs/content-accuracy.md', what: 'The accuracy check of the Block theme lessons (with -learner and -vibe-coder versions for the other paths).' },
  { id: 'src-vendor', file: 'vendor/learning-mcp/', what: 'The MCP course server (learning-mcp), vendored, with its licence notes.' },
] as const;

/** With the Sensei content flag on, the lessons are read from the committed snapshot, not from YAML. */
const sources = () =>
  FEATURES.wordpressContent
    ? SOURCES.map((s) => {
        if (s.id === 'src-content') return { ...s, file: 'content/snapshot/', what: 'The lessons, checkpoints, branches and planted bugs, as exported from Sensei.' };
        if (s.id === 'src-build') return { ...s, what: 'The build-time validator for the content snapshot.' };
        return s;
      })
    : SOURCES;

const blob = (file: string) => `${REPO_URL}/${file.endsWith('/') ? 'tree' : 'blob'}/main/${file.replace(/\/$/, '')}`;

/** An inline pointer to an entry in the sources list at the foot of the page. */
function Cite({ to, children }: { to: (typeof SOURCES)[number]['id']; children: ComponentChildren }) {
  return (
    <a class="prose__cite" href={`#${to}`}>
      {children}
    </a>
  );
}

function Band({ id, title, dark, children }: { id: string; title: ComponentChildren; dark?: boolean; children: ComponentChildren }) {
  return (
    <section class={`band ${dark ? 'band--dark-2' : 'band--light'}`} aria-labelledby={id}>
      <div class="wrap split">
        <h2 id={id} class="split__title">
          {title}
        </h2>
        <div class="split__body prose">{children}</div>
      </div>
    </section>
  );
}

/** /proposal: for the Training Team and leadership, written like a Make/Training post (spec §2, §3). */
export function Proposal() {
  usePageTitle('The proposal');
  return (
    <div class="proposal-page">
      <section class="band band--light" aria-labelledby="proposal-page-title">
        <div class="wrap split">
          <h1 id="proposal-page-title" class="placeholder__title">
            The <Swipe>proposal</Swipe>
          </h1>
          <div class="split__body lede">
            <p>
              This is a suggestion for how Learn WordPress could use AI on the learner's side, written for the Training Team
              and anyone weighing it up. The site around it is the working example. It's an unofficial concept, not
              affiliated with WordPress.org or the WordPress Foundation, and the lessons in it are adapted from Learn
              WordPress, not reviewed by the Training Team.
            </p>
          </div>
        </div>
      </section>

      <Band id="gap-title" title="The gap">
        <p>Here's where Learn WordPress stands, as of October 2026:</p>
        <ul class="gap-claims">
          <li>
            <strong>Learn runs on Sensei LMS.</strong> The 2024 redesign built a block theme around Sensei's blocks, and
            Sensei still powers the courses and lessons (
            <a href={LEARN.relaunch}>Meet the new Learn WordPress</a>, August 2024; the live{' '}
            <a href={LEARN.aiCourse}>course pages</a> still load it).
          </li>
          <li>
            <strong>Learning Pathways are set by role and level.</strong> The 2024 relaunch introduced pathways that guide
            learners from beginner through intermediate to advanced (<a href={LEARN.relaunch}>the relaunch post</a>). The{' '}
            <a href={LEARN.userPathway}>User pathway</a>, for example, is Beginner, Intermediate and Advanced WordPress User.
            Learners pick a level themselves; nothing places them.
          </li>
          <li>
            <strong>The team's April 2026 AI work helps authors.</strong> The{' '}
            <a href={LEARN.aiTools}>reusable prompts and Claude plugin</a> help contributors co-write lessons, facilitation
            guides and facilitator slides, with a person reviewing everything they produce.
          </li>
          <li>
            <strong>The AI-Powered WordPress course teaches site owners.</strong> It{' '}
            <a href={LEARN.aiCoursePost}>launched on 18 September 2026</a>: about 9 hours on the AI built into WordPress
            7.0, for anyone who manages or publishes on a site, with a fourth module on the developer APIs (
            <a href={LEARN.aiCourse}>course page</a>).
          </li>
          <li>
            <strong>Nothing adapts to the learner yet.</strong> The <a href={LEARN.userPathway}>pathway pages</a> filter
            courses by topic and level. There is no placement step, no branching inside a lesson, and no tutor.
          </li>
        </ul>
        <p>
          So AI is reaching the people who write Learn and the people who run WordPress sites. It hasn't reached the
          learner's seat. That's the gap this concept tries to fill.
        </p>
      </Band>

      <Band id="proves-title" title="What the demo proves" dark>
        <p>
          The test set for this concept (<Cite to="src-spec">the design spec, section 1</Cite>) is that someone from the
          community, after five minutes, comes away with three ideas.
        </p>
        <ol>
          <li>
            <strong>AI can improve learning.</strong> A short placement chat recommends a path and a first lesson, and says
            why. Checkpoints inside a lesson read a free-text answer and send the learner on, back for review, or ahead, and
            each result explains itself. The AI changes the route through the course, not just the text beside it.
          </li>
          <li>
            <strong>Coding still matters.</strong> The AI is told never to hand over working code and move on. Learners predict what
            code does, explain it, find a bug planted in AI-written code, and make the fix by hand. Checks that don't depend
            on the AI decide whether the fix is right.
          </li>
          <li>
            <strong>WordPress can still try new things.</strong> It's built on Learn's own lessons, open models, WordPress
            Playground and an MCP server, so a learner can take the course into the agent they already use (
            <a href="/connect">Connect your agent</a>).
          </li>
        </ol>
        <p>
          <a href="/how-it-works">How this works</a> says plainly which parts are live and which are concept.
        </p>
      </Band>

      <Band id="phases-title" title="A phased path onto Learn">
        <p>None of this needs Learn to be rebuilt. Each phase is useful by itself, and the next one can wait.</p>
        <h3>Phase 1: a tutor and placement beside Sensei</h3>
        <p>
          {FEATURES.wordpressContent ? (
            <>
              Lessons live in Sensei, written and reviewed as they are now. In this concept they do: all 18 are stored in
              Sensei, and you can read each one on <a href={BACKEND_VIEW_PATH}>the backend view</a>.
            </>
          ) : (
            'Lessons stay in Sensei, written and reviewed as they are now.'
          )}{' '}
          A tutor sits beside each lesson, grounded in that
          lesson's own text, and links back to the lesson or the Developer Handbook when it isn't sure. A placement chat
          recommends a pathway course and a starting lesson. The only new content is a short note per course saying who it
          suits. Progress stays in the learner's browser, so no accounts are needed. If the AI is down, the lessons read
          exactly as they do today.
          {FEATURES.wordpressContent &&
            " The tutor and placement are running in this concept. What isn't shown is Sensei progress (phase 3 below) and the Training Team's review of these lessons."}
        </p>
        <h3>Phase 2: keep the record with a WordPress.org login</h3>
        <p>
          The learning record goes through a small <Cite to="src-store-if">record store interface</Cite>. Today it has a
          browser store, a local folder and the agent relay. A WordPress.org account adapter, signing in with WordPress.org,
          would sync the same record to the learner's profile across devices (
          <Cite to="src-spec">spec, section 3a</Cite>). It isn't built. One open question: the record's xAPI statements use
          an anonymous actor and can't be rewritten, so linking them to an account needs an agreed approach, such as a
          signed "linked" statement.
        </p>
        <h3>Phase 3: Sensei progress</h3>
        <p>
          Once a learner is signed in, completed lessons and passed checkpoints could be written to their Sensei progress,
          so the two views agree. This depends on what Sensei can accept, and would need its maintainers' input.
        </p>
      </Band>

      <Band id="workflow-title" title="How authored branching fits the content workflow" dark>
        <p>
          Branching here is content, not something the AI makes up. A checkpoint is a few fields in the lesson's file (
          <Cite to="src-content">the lesson files</Cite>): the question, a rubric in plain words, and three authored
          outcomes, each with its target lesson and message:
        </p>
        <ul>
          <li>advance: the answer meets the rubric</li>
          <li>review: the learner should revisit the material</li>
          <li>skip: the answer clearly shows mastery beyond the lesson</li>
        </ul>
        <p>
          There is also a multiple-choice version for when the AI is away. The AI reads the answer against the rubric and
          picks one of the authored outcomes. It can't invent a new one, and the server rejects anything else.
        </p>
        <p>
          That keeps branching reviewable in the way lessons already are. A reviewer reads the rubric and the targets, not a
          prompt. The <Cite to="src-schema">content schema</Cite> and a{' '}
          <Cite to="src-build">build-time validator</Cite> reject a checkpoint with a missing outcome, no fallback, or a
          target lesson that doesn't exist.
        </p>
        <p>
          It also sits next to the team's April 2026 tools. Those prompts already co-write lessons. A further prompt could
          draft a checkpoint alongside a lesson (a question, a rubric and the three outcomes), and it would go through the
          same human review those tools already expect. That's a suggestion, not something built here.
        </p>
      </Band>

      <Band id="cost-title" title="Cost, privacy, accessibility and upkeep">
        <h3>Cost per learner</h3>
        <p>
          On open models on Cloudflare Workers AI, the AI costs about ${COST_PER_1000_LEARNERS_USD.toFixed(2)} per 1000
          learners, <Cite to="src-eval">from the model evaluation, October 2026</Cite>. That assumes 1 placement chat, 6
          checkpoint judgements and 20 tutor turns per learner, priced from measured token counts. The test cases were short
          and single-turn, and real lessons are longer, so real costs will be higher. At that mix, a $100 monthly budget
          covers roughly 20,000 learners.
        </p>
        <p>
          This demo has a hard cap of ${CAP.month} a month across all providers and ${CAP.day} a day (
          <Cite to="src-budget">the budget code</Cite>). At the cap, the AI features switch to their no-AI versions until the
          next day or month (UTC). Learners who bring their own agent aren't affected: the agent does the thinking on their
          own subscription, and no model runs on this site's account.
        </p>
        <h3>Privacy</h3>
        <ul>
          <li>
            The record's xAPI statements use an anonymous actor, a random ID with no name or email (
            <Cite to="src-record">the record format</Cite>).
          </li>
          <li>
            The record lives in the learner's browser, or in a folder they pick, and they can download or restore it at any
            time. The record isn't kept on a server unless they opt in to the relay below.
          </li>
          <li>
            For web agents, which can't read local files, the learner can opt in to a relay. It keeps a copy under a random
            handle, stores no personal data, expires after {RELAY_DAYS} days without use, and can be deleted at any time (
            <Cite to="src-relay">the relay</Cite>).
          </li>
          <li>What a learner types to the AI is sent to the model provider to get a reply.</li>
        </ul>
        <h3>Accessibility</h3>
        <p>
          The target is WCAG 2.2 AA. A test checks that every animation in the stylesheets has a reduced-motion override (
          <Cite to="src-motion">the guard</Cite>). Tests check each page's heading order, and the pages were checked in the
          browser for no sideways scrolling at phone width. Full keyboard use is a requirement. Nothing here has had an outside accessibility audit, and that
          would come before Learn adopted any of it.
        </p>
        <h3>Upkeep</h3>
        <ul>
          <li>
            {FEATURES.wordpressContent
              ? 'Lessons, checkpoints and planted bugs are authored in Sensei and exported to a committed snapshot, which is checked at build time, so a broken reference fails the build rather than the learner. Because the content is edited in wp-admin, the accuracy notes have to be updated in the same snapshot commit as any edit.'
              : 'Lessons, checkpoints and planted bugs are plain YAML files, checked at build time, so a broken reference fails the build rather than the learner.'}
          </li>
          <li>
            Code checks are deterministic: text that must or mustn't be there, patterns, and values in JSON (
            <Cite to="src-checks">the checks</Cite>). Each one is tested against its planted bug, the intended fix and the
            starter file (<Cite to="src-content-tests">the content tests</Cite>).
          </li>
          <li>
            Each lesson was checked against its live Learn and Handbook sources (<Cite to="src-accuracy">the accuracy
            notes</Cite>). Those checks need repeating as WordPress changes, like any Learn lesson.
          </li>
          <li>
            The model evaluation should be re-run when the content or the models change. Switching models is a config
            change.
          </li>
        </ul>
      </Band>

      <Band id="decisions-title" title="Design decisions" dark>
        <p>Each of these was a choice between reasonable options. Here is what each one costs.</p>
        <ul class="decisions">
          <li>
            <strong>Authored branching, not AI-invented paths.</strong> The AI judges and chooses among outcomes a person
            wrote, so every route can be reviewed before a learner sees it.{' '}
            <em>The cost:</em> someone has to write a rubric and three outcomes for every checkpoint, and the course only
            adapts in the ways its authors foresaw.
          </li>
          <li>
            <strong>Open models, with a hard spending cap.</strong> This fits WordPress's open source values, keeps the cost
            small, and means one busy day can't drain the month. The provider and model are settings, like the Connectors in
            WordPress 7, so no single vendor is built in. <em>The cost:</em> at the cap the AI features switch off until it
            resets, and open models need more care. In testing, the model best at judging gave away a solution when asked,
            so the tutor runs on a different model (<Cite to="src-eval">the evaluation</Cite>).
          </li>
          <li>
            <strong>A record the learner keeps, instead of accounts.</strong> No sign-up, and no personal data held.{' '}
            <em>The cost:</em> progress doesn't follow a learner between devices unless they move the file. Clearing browser
            data loses it unless they saved it to a folder or downloaded it. Saving to a folder only works in Chromium
            browsers.
          </li>
          <li>
            <strong>Planted bugs are written ahead of time, not generated live.</strong> The snippet is AI-written, and a
            course author plants one bug, so every learner gets the same reliable mistake and the checks for the fix can be
            tested. <em>The cost:</em> the answer is the same for everyone, so it can be shared, and each bug is more
            content to write and keep current.
          </li>
          <li>
            <strong>An MCP server, so learners can bring their own agent.</strong> Learners can take the course into
            Claude, ChatGPT, Cursor or any MCP client, and their subscription pays for the thinking (
            <Cite to="src-vendor">the course server</Cite>). The server sends only authored content, rubrics, outcomes and
            check results. <em>The cost:</em> how well the agent teaches depends on a model we don't control. The server
            can hold the line on content, order and checks, but not on tone. Lesson order is strict, which can feel rigid in
            a long chat.
          </li>
          <li>
            <strong>Checks read the code; they don't run it.</strong> String, pattern and JSON checks give the same answer
            every time, need no server to run PHP, and still work when the AI is down. <em>The cost:</em> a correct answer
            written in an unexpected way can fail until an author widens the check, and a pass shows the code has the right
            shape, not that it runs. The live Playground preview shows the result, but it doesn't grade it.
          </li>
          <li>
            <strong>The record handle is the only key to an agent record.</strong> There are no logins for the relay, so
            there's nothing personal to leak. <em>The cost:</em> anyone who has a learner's handle can read that record. The
            relay is rate-limited, but the handle has to be kept private, like a password.
          </li>
        </ul>
      </Band>

      <Band id="sources-title" title="Sources">
        <p>
          The sources for the gap are linked where they're used, and were checked on 22 October 2026. Everything else comes
          from a file in the repo. Concept and build by Derin Tolu; the lessons stand on the work of the Learn WordPress
          Training Team and its contributors.
        </p>
        <ol class="prose__sources">
          {sources().map((s) => (
            <li id={s.id} key={s.id} tabIndex={-1}>
              <a href={blob(s.file)}>
                <code>{s.file}</code>
              </a>
              . {s.what}
            </li>
          ))}
        </ol>
        <p>
          The <a href={REPO_URL}>source is on GitHub</a>.
        </p>
      </Band>
    </div>
  );
}
