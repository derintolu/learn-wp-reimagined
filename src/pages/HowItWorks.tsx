import type { ComponentChildren } from 'preact';
import { Sticker } from '../components/Sticker';
import { Swipe } from '../components/Swipe';
import { FEATURES, phaseOn, REPO_URL } from '../config';
import { BACKEND_VIEW_PATH, COST_PER_1000_LEARNERS_USD, LRS_HOST, MCP_URL, RETENTION_DAYS, SENSEI_VERSION } from '../shared/course-meta';
import { usePageTitle } from '../usePageTitle';
import { BackendDiagram } from './HowItWorksDiagram';
import '../styles/how.css';

export const SPEC_REPO_URL = 'https://github.com/derintolu/course-xapi-mcp';
export const LEDGER_REPO_URL = 'https://github.com/derintolu/learning-ledger';

/** From course-xapi-mcp docs/STATUS.md ("Verified", run 2026-10-27 at commit 3c30d4a). */
export const SPEC = { draft: '0.2', requirements: 149, tests: 725 };

// These mirror server constants; tests/components/how-it-works.test.tsx checks each against its source file.
const MODELS = {
  structured: '@cf/openai/gpt-oss-120b',
  chat: '@cf/meta/llama-4-scout-17b-16e-instruct',
};
const CAP = { month: 100, day: 10 };
const EVAL = { refusalsTried: 4, tutorRefused: 4, structuredRefused: 3, placementOk: 14, placementCases: 14 };
const MCP = { bodyMb: 1, global: '1,200', perHandle: 120, create: 60, windowMin: 10, relayDays: 30 };

/** One small label per component: where it stands on this site today. */
export const STATUS = {
  live: 'Live here',
  public: 'Public, not running here',
  progress: 'In progress',
  idle: 'Running, not wired in',
  next: 'Next',
} as const;
type StatusKind = keyof typeof STATUS;

const SOURCES = [
  { id: 'src-backend', file: 'docs/superpowers/specs/2026-10-27-sensei-backend-prototype-design.md', what: 'The design of the backend: the two spaces, the one write path and the record.' },
  { id: 'src-eval', file: 'docs/model-eval.md', what: 'Model evaluation, October 2026: the models for each task, how they were chosen, and the cost estimate.' },
  { id: 'src-config', file: 'functions/_lib/config.ts', what: 'The provider and model for each task, and the price of each model.' },
  { id: 'src-providers', file: 'functions/_lib/providers/', what: 'The provider interface, the Workers AI adapter and the Anthropic adapter.' },
  { id: 'src-accuracy', file: 'docs/content-accuracy.md', what: 'The accuracy check of the Block theme lessons against their live sources.' },
  { id: 'src-accuracy-learner', file: 'docs/content-accuracy-learner.md', what: 'The accuracy check of the Learner lessons.' },
  { id: 'src-accuracy-vibe', file: 'docs/content-accuracy-vibe-coder.md', what: 'The accuracy check of the Vibe coder lessons.' },
  { id: 'src-spec', file: 'docs/superpowers/specs/2026-10-19-learn-wp-reimagined-design.md', what: 'The design spec. Section 8 records how the planted bugs are made.' },
  { id: 'src-content', file: 'content/paths/', what: 'The lessons, each planted bug, and the checks that confirm a fix.' },
  { id: 'src-prompts', file: 'functions/_lib/prompts.ts', what: 'What the AI is told it may and may not do.' },
  { id: 'src-budget', file: 'functions/_lib/budget.ts', what: 'The monthly cap and the daily sub-cap.' },
  { id: 'src-gate', file: 'functions/_lib/mcp/gate.ts', what: 'The limits in front of the MCP server.' },
  { id: 'src-store', file: 'functions/_lib/mcp/practiceStore.ts', what: 'How long an agent record is kept.' },
  { id: 'src-record', file: 'docs/record-format.md', what: 'The learning record format and its xAPI statements.' },
] as const;

/** With the Sensei content flag on, the lessons are read from the committed snapshot, not from YAML. */
const sources = () =>
  (FEATURES.wordpressContent
    ? SOURCES.map((s) =>
        s.id === 'src-content' ? { ...s, file: 'content/snapshot/', what: 'The lessons as exported from Sensei, committed so changes can be reviewed.' } : s,
      )
    : [...SOURCES]
  ).filter((s) => !FEATURES.agentOnStandard || s.id !== 'src-store');

const blob = (file: string) => `${REPO_URL}/${file.endsWith('/') ? 'tree' : 'blob'}/main/${file.replace(/\/$/, '')}`;

/** An inline pointer to an entry in the sources list at the foot of the page. */
function Cite({ to, children }: { to: (typeof SOURCES)[number]['id']; children: ComponentChildren }) {
  return (
    <a class="prose__cite" href={`#${to}`}>
      {children}
    </a>
  );
}

function Status({ kind }: { kind: StatusKind }) {
  return <span class={`status status--${kind}`}>{STATUS[kind]}</span>;
}

function Band({ id, title, dark, children, below }: { id: string; title: ComponentChildren; dark?: boolean; children: ComponentChildren; below?: ComponentChildren }) {
  return (
    <section class={`band ${dark ? 'band--dark-2' : 'band--light'}`} aria-labelledby={id}>
      <div class="wrap">
        <div class="split">
          <h2 id={id} class="split__title">
            {title}
          </h2>
          <div class="split__body prose">{children}</div>
        </div>
        {below}
      </div>
    </section>
  );
}

/** /how-it-works: the system behind the site (course-xapi-mcp, Learning Ledger, Sensei), what's real and what's concept. */
export function HowItWorks() {
  usePageTitle('How this works');
  const sensei = FEATURES.wordpressContent;
  const anon = FEATURES.senseiLearners;
  const official = phaseOn('officialRecord');
  const final = phaseOn('badges');

  const parts: { name: ComponentChildren; status: StatusKind; body: ComponentChildren }[] = [
    {
      name: 'The studio',
      status: 'live',
      body: (
        <>
          The lessons, placement chat, tutor, code checks and the WordPress Playground finale. Paths, lessons,
          checkpoints and branches are{' '}
          {sensei ? 'authored in Sensei, with a reviewable copy committed to the repo' : 'authored as plain files in the repo'}.
        </>
      ),
    },
    {
      name: 'The MCP connector',
      status: 'live',
      body: (
        <>
          <code>{MCP_URL}</code>. It runs the course-xapi-mcp reference server, with the same tools for beats,
          code checks, checkpoints and branches. Your record there is a practice record. Badges are off.{' '}
          <a href="/connect">Connect your AI</a>.
        </>
      ),
    },
    {
      name: FEATURES.agentOnStandard ? 'Agent sign-in' : 'Record handles',
      status: 'live',
      body: FEATURES.agentOnStandard ? (
        <>
          Your AI signs in as you through MCP authorization, on a page that reads your studio session. What it does goes
          into the same record as the studio, and "Disconnect agents" in the record menu cuts it off.
        </>
      ) : (
        <>
          In your AI, your progress is kept under a random handle that only you hold. It stores no personal data and is
          deleted after {MCP.relayDays} days without use (<Cite to="src-store">the record store</Cite>), or when you ask. In
          course-xapi-mcp terms that's a practice record, which nobody holds officially.
        </>
      ),
    },
    {
      name: 'The course-xapi-mcp reference server',
      status: 'live',
      body: (
        <>
          Built, tested and on GitHub. It now runs the connector here. Read the{' '}
          <a href="https://course-xapi-mcp.sqwrlz.com/spec/0.2/">spec draft 0.2</a>.
        </>
      ),
    },
    {
      name: 'Learning Ledger',
      status: official ? 'live' : 'progress',
      body: official ? (
        <>
          The LRS and the Sensei connector are installed and running here, on two installs{final ? ', and so is badge signing' : ''}. The public
          repo is where work continues.
        </>
      ) : (
        <>
          The LRS, the Sensei connector, the cmi5 player and badge signing are in the public repo, and work continues. It
          isn't installed on either space yet.
        </>
      ),
    },
    {
      name: <>The LRS at {LRS_HOST}</>,
      status: official ? 'live' : 'idle',
      body: official ? (
        FEATURES.agentOnStandard ? (
          <>The course server writes every learning record here, and nothing else does.</>
        ) : (
          <>The course server writes the studio's record here. Agents keep practice records elsewhere until they sign in.</>
        )
      ) : (
        <>
          A WordPress install on its own space, and it answers, but Learning Ledger isn't installed there yet, so it holds
          no records.
        </>
      ),
    },
    {
      name: 'Sensei as the course back end',
      status: sensei ? 'live' : 'next',
      body: sensei ? (
        <>
          The lessons are stored in Sensei LMS {SENSEI_VERSION}, the same plugin Learn runs on, on a WordPress install
          that belongs to this prototype. You can read any lesson as Sensei shows it on{' '}
          <a href={BACKEND_VIEW_PATH}>the backend view</a>
          . That view is Sensei's own page, with no AI and no branching. Take the lesson in the studio.
          {anon && " Sensei enrols you in a path when you start it. Sensei's own pages are the same for everyone and don't show your progress."}
          {anon && official && ' Your progress in Sensei is shown in the "What Sensei sees" panel in the studio.'}
        </>
      ) : (
        <>
          Sensei LMS, the plugin Learn runs on, takes over the lessons, learners, enrolment and completion. It isn't
          installed on this site's WordPress yet.
        </>
      ),
    },
    {
      name: 'Badges',
      status: final ? 'live' : 'next',
      body: (
        <>
          Open Badges 3.0, signed by the LRS as <code>did:web:{LRS_HOST}</code> and claimed from the studio.
        </>
      ),
    },
  ];

  const custody: { id: string; who: string; body: ComponentChildren; badges: string; here?: ComponentChildren }[] = [
    {
      id: 'lms-launched',
      who: 'Your LMS',
      body: "Your LMS launches the lesson like any cmi5 lesson, and you carry on in your AI. Statements go to the LMS's own LRS, under the identity the LMS gives you.",
      badges: 'Yes',
    },
    {
      id: 'author-lrs',
      who: "The author's LRS",
      body: 'The course author names an LRS. The course server signs you in and writes every statement there in real time, including your free-text answers.',
      badges: 'Yes',
      here: <>This site is moving to this option, with Learning Ledger at {LRS_HOST}.</>,
    },
    {
      id: 'server-kept',
      who: 'The course server',
      body: 'The course server keeps the record in its own store, signs you in against its own accounts, and publishes how long it keeps data and how to delete it.',
      badges: 'Yes',
    },
    {
      id: 'practice',
      who: 'Nobody',
      body: `No official record. Every result is labelled unofficial, the server hands the statements back to you, and it may relay them under a private handle for up to ${MCP.relayDays} days.`,
      badges: 'No',
      here: 'The agent path live here today works much like this.',
    },
  ];

  const steps: { title: string; status: StatusKind; body: ComponentChildren }[] = [
    {
      title: 'Connect',
      status: 'next',
      body: (
        <>
          You add <code>{MCP_URL}</code> to your AI and sign in once through MCP authorization. Your AI calls{' '}
          <code>get_status</code> and tells you where your record is kept and whether it's official.{' '}
          {FEATURES.agentOnStandard
            ? 'You sign in when your agent asks.'
            : "Today there's no sign-in, and you give your AI a record handle instead."}
        </>
      ),
    },
    {
      title: 'Learn a beat',
      status: 'live',
      body: (
        <>
          The agent calls <code>get_lesson</code> and <code>next_beat</code>, explains the beat in its own words and asks
          the beat's question. Your reply goes back to the server word for word, and the server records it.
        </>
      ),
    },
    {
      title: 'Fix the code',
      status: 'live',
      body: (
        <>
          You edit the lesson's code and the agent calls <code>check_code</code>. The authored checks decide pass or fail,
          and that result is final. Some lessons show code labelled <q>AI-written code. We planted one bug. Find it.</q> The
          bug was planted on purpose by the course author, so every learner meets the same mistake (
          <Cite to="src-spec">the design spec, section 8</Cite>), and the agent is told never to point at it.
        </>
      ),
    },
    {
      title: 'Answer the checkpoint',
      status: 'live',
      body: (
        <>
          The agent sends your answer with <code>submit_checkpoint</code>, judges it against the authored rubric, and calls{' '}
          <code>choose_branch</code> with one of the allowed branches and a one-sentence reason. The server refuses any
          other branch and records nothing for it.
        </>
      ),
    },
    {
      title: 'Write the record',
      status: 'next',
      body: (
        <>
          The course server builds each xAPI statement itself and sends it to the LRS straight away. It's the only writer,
          so nothing the browser or the agent sends becomes a statement.
        </>
      ),
    },
    {
      title: 'Sensei catches up',
      status: 'next',
      body: (
        <>
          The LRS tells the connector over a signed webhook, with a catch-up poll as backup, and the connector marks the
          lesson complete in Sensei. The target is within 90 seconds at p95. When you finish a path, the LRS has a badge
          for you to claim.
        </>
      ),
    },
  ];

  return (
    <div class="how-page">
      <section class="band band--light" aria-labelledby="how-page-title">
        <div class="wrap split">
          <h1 id="how-page-title" class="placeholder__title">
            How this <Swipe>works</Swipe>
          </h1>
          <div class="split__body lede">
            <p>
              This site is a course you can take here or inside your own AI. Under it sit two open projects:
              course-xapi-mcp, a spec for teaching courses over MCP on top of cmi5 and xAPI, and Learning Ledger, a
              WordPress plugin that keeps the learning record and feeds it to Sensei. This page shows how they fit
              together, and labels each part with what runs here today and what doesn't yet.
            </p>
          </div>
        </div>
      </section>

      <Band id="standard-title" title={<>One course, <Swipe>any AI</Swipe></>} dark>
        <p>
          <a href={SPEC_REPO_URL}>course-xapi-mcp</a> is an open spec for taking a course inside the AI you already use:
          Claude, ChatGPT, Cursor, Claude Code or any other MCP client. You add the course's MCP URL, and your AI
          becomes the tutor. The course server supplies everything that has to be authored, or decided the same way every
          time: the lessons, rubrics, branches, code checks, planted bugs and the teaching rules the agent follows.
        </p>
        <p>
          It builds on standards LMSs already run. A course is a valid cmi5 package, with its extra parts in a namespaced
          extension, so a cmi5 LMS can import and launch it without knowing anything about MCP. Every step is recorded as
          an xAPI statement, and badges are Open Badges 3.0. MCP carries only the conversation.
        </p>
        <p>
          The split of work is strict. The server decides what exists, what comes next, whether code passes and which
          branches are allowed, and it never calls a model. The agent decides how to explain, and which authored branch
          fits a free-text answer. No tool accepts a statement, a record or an actor id from the agent, so nobody in the
          chat, you or the AI, can change the official record.
        </p>
        <ul>
          <li>
            Draft {SPEC.draft}, not stable. The package format, tools and record format can still change before 1.0.
          </li>
          <li>{SPEC.requirements} numbered requirements, each mapped to a test in a black-box conformance suite.</li>
          <li>
            A TypeScript reference implementation: the course server for all four custody options, a cmi5 launch bridge, an
            LRS client, a badge issuer and the <code>cxm</code> package validator. {SPEC.tests} unit and integration tests
            pass, and it passes its own conformance suite in every profile.
          </li>
          <li>
            Not yet tried: a launch from a real LMS (only the bundled simulator), a real AI host teaching with a real model,
            and ADL's CATAPULT cmi5 test suite.
          </li>
          <li>Apache-2.0.</li>
        </ul>
        <p class="how-status-line">
          <Status kind="public" /> <a href={SPEC_REPO_URL}>course-xapi-mcp on GitHub</a>
        </p>
      </Band>

      <Band
        id="backend-title"
        title={<>The <Swipe>backend</Swipe></>}
        below={
          <>
            <BackendDiagram />
            <div class="how-parts">
              <h3 class="how-parts__title">Each part, and where it stands</h3>
              <ul class="how-parts__list">
                {parts.map((p, i) => (
                  <li key={i}>
                    <div class="how-parts__head">
                      <strong>{p.name}</strong>
                      <Status kind={p.status} />
                    </div>
                    <p>{p.body}</p>
                  </li>
                ))}
              </ul>
            </div>
          </>
        }
      >
        <p>
          The backend runs on two Spacefast spaces. The first holds this app, the course server (Spacefast Functions) and
          a WordPress install for Sensei LMS with Learning Ledger's connector. The second, at {LRS_HOST}, is a separate
          WordPress that runs Learning Ledger as the LRS. It's kept apart because a busy LRS slows the site it sits on.
        </p>
        <p>
          The course server is the only thing that writes learning records. Learners are headless: each has a WordPress
          user that Sensei tracks, and nobody signs in to WordPress. The full plan is in{' '}
          <Cite to="src-backend">the backend design</Cite>.
        </p>
      </Band>

      <Band
        id="custody-title"
        title={<>Who holds the <Swipe>record</Swipe></>}
        dark
        below={
          <ul class="custody">
            {custody.map((c, i) => (
              <li key={c.id} class="custody__card">
                <h3>
                  <span class="custody__num">{i + 1}</span> {c.who}
                </h3>
                <p>
                  <code>{c.id}</code>
                </p>
                <p>{c.body}</p>
                <p class="custody__badges">Badges: {c.badges}</p>
                {c.here && <p class="custody__here">{c.here}</p>}
              </li>
            ))}
          </ul>
        }
      >
        <p>
          A course declares one of four custody options, and the agent has to tell you which one applies before the first
          recorded step. In every option, the agent can't write or replace the official record.
        </p>
        <p>
          In the first three you can always view and export your record, and deleting it goes through whoever holds it,
          never through a tool in the chat. A course can also allow practice runs alongside, and a practice run never
          becomes official.
        </p>
      </Band>

      <Band id="ledger-title" title={<>Learning <Swipe>Ledger</Swipe></>}>
        <p>
          WordPress has no maintained open-source LRS. The only open plugin, wp-xapi-lrs, has been abandoned since about
          2017. <a href={LEDGER_REPO_URL}>Learning Ledger</a> is a WordPress plugin with two roles. As an LRS it stores
          xAPI statements, with voiding and queries, and the State, Agent Profile and Activity Profile documents. As an LMS
          connector it sits on the LMS site, applies results from the LRS as LMS progress and keeps the map between xAPI
          actors and WordPress users. The roles can share one install or run on two. It doesn't depend on
          course-xapi-mcp, and any xAPI tool can write to it.
        </p>

        <h3>Sensei first</h3>
        <p>
          Each LMS integration is a folder that loads only when that LMS is active, and Sensei's is first. It goes through
          Sensei's own progress functions, such as <code>Sensei_Utils::sensei_start_lesson()</code>, and never touches
          Sensei's progress storage directly, so course completion and certificates follow as they do now. Lessons skipped
          by placement or branching show as complete, marked <q>Tested out</q> in the course outline, learning mode and
          reports. The connector can also send on-site Sensei learning to the LRS as xAPI. That stays off for courses a
          course server drives, so each course has one writer.
        </p>

        <h3>A cmi5 player for Sensei</h3>
        <p>
          On a Sensei site the connector is also the cmi5 LMS. It imports any cmi5 package, as a ZIP or a{' '}
          <code>cmi5.xml</code>. Top-level blocks become Sensei courses, and each AU becomes a lesson with a launch block. A
          launch follows cmi5: one registration per learner and course, <code>LMS.LaunchData</code>, a fetch URL that
          works once, and a short-lived token limited to one learner and one registration. When an AU's moveOn criteria are
          met, its Sensei lesson is marked complete.
        </p>
        <p>
          AU files are served from a separate hostname, or sandboxed when there's only one, so third-party JavaScript
          never runs as your WordPress origin. ADL's CATAPULT cmi5 test suite is wired in as a release gate and hasn't
          been run yet.
        </p>

        <h3>More LMSs</h3>
        <p>
          LifterLMS, Tutor LMS and LearnPress come next, in that order, through the same interface. None of them is in the
          public repo yet.
        </p>

        <h3>Badge signing</h3>
        <p>
          The LRS issues Open Badges 3.0 credentials with an <code>eddsa-rdfc-2022</code> proof over an Ed25519 key and a{' '}
          <code>did:web</code> issuer, <code>did:web:{LRS_HOST}</code> for this site. Revoking a badge flips a bit in a
          signed Bitstring Status List. A badge is worked out only from statements the course server wrote, cites exactly
          one earning statement as evidence, and is signed when you claim it. No MCP tool can sign anything. The signing
          code passes the W3C test vectors, and the claim pages aren't public yet.
        </p>
        <p class="how-status-line">
          <Status kind="progress" /> <a href={LEDGER_REPO_URL}>Learning Ledger on GitHub</a>, GPL-2.0-or-later
        </p>
      </Band>

      <Band
        id="flow-title"
        title={<>One lesson, <Swipe>end to end</Swipe></>}
        dark
        below={
          <ol class="how-flow">
            {steps.map((s) => (
              <li key={s.title}>
                <div class="how-flow__head">
                  <h3>{s.title}</h3>
                  <Status kind={s.status} />
                </div>
                <p>{s.body}</p>
              </li>
            ))}
          </ol>
        }
      >
        <p>
          The path one lesson takes in your AI once the backend is wired up. Steps 2 to 4 run on this site today, on
          the course-xapi-mcp reference server.
        </p>
      </Band>

      <Band id="cost-title" title={<>What the AI <Swipe>costs</Swipe></>}>
        <p>
          On the site, placement and the checkpoint judge run on <code>{MODELS.structured}</code>, and the tutor and code
          feedback run on <code>{MODELS.chat}</code>, both on Cloudflare Workers AI. They were chosen by testing (
          <Cite to="src-eval">our model evaluation, October 2026</Cite>). The tests tried {EVAL.refusalsTried} times to get
          a full solution out of the AI. The tutor model refused all {EVAL.tutorRefused}; the placement and judge model
          refused {EVAL.structuredRefused} of {EVAL.refusalsTried}, one reason it doesn't run the tutor. In the latest run,
          placement got {EVAL.placementOk} of {EVAL.placementCases} test conversations right, measured on this site's own
          lessons. The rules it follows are in <Cite to="src-prompts">the prompts</Cite>, and the provider and model are{' '}
          <Cite to="src-config">server settings</Cite> behind <Cite to="src-providers">a small provider interface</Cite>.
        </p>
        <p>
          The AI costs about ${COST_PER_1000_LEARNERS_USD.toFixed(2)} per 1000 learners, assuming 1 placement chat, 6
          checkpoint judgements and 20 tutor turns each. Real tutor conversations run longer, so expect more. Spending has a
          hard cap of ${CAP.month} a month and ${CAP.day} a day (<Cite to="src-budget">the budget code</Cite>). At the cap,
          placement becomes a list of paths, checkpoints become multiple choice, and lessons, code checks and your record
          keep working.
        </p>
        <p>
          In your own AI, the model runs on your subscription, so it costs this site nothing. The MCP server takes requests
          of up to {MCP.bodyMb} MB, and allows {MCP.global} requests every {MCP.windowMin} minutes across everyone
          {FEATURES.agentOnStandard ? (
            <>
              {' '}and {MCP.perHandle} tool calls every {MCP.windowMin} minutes for each signed-in agent
            </>
          ) : (
            <>
              ,{' '}
              {MCP.perHandle} tool calls every {MCP.windowMin} minutes for each record handle, and {MCP.create} new records
              every {MCP.windowMin} minutes
            </>
          )}{' '}
          (<Cite to="src-gate">the MCP gate</Cite>).
        </p>
      </Band>

      {official && (
        <Band id="record-title" title={<>Where your <Swipe>record</Swipe> lives</>}>
          <p>
            <strong>A real record, kept in a real LRS.</strong> Your progress is a set of xAPI statements, the standard
            format for learning records, under a random ID with no name or email. The official copy is kept in a learning
            record store at {LRS_HOST}, a separate WordPress install running the Learning Ledger plugin. Only the course
            server writes to it. You can read it, download it, and see it on the store's own page from the record menu, but
            you can't edit it. Your browser keeps a working copy so the lesson stays quick, and your files can also be saved
            to a folder you pick (in Chromium browsers). The format is <Cite to="src-record">documented in the repo</Cite>.
          </p>
          <p>
            <strong>Progress that reaches Sensei.</strong> When you finish a lesson, or skip one by showing you already know
            it, the record store tells Sensei, which marks the lesson complete. A skipped lesson is marked complete in Sensei
            and shown as "tested out" in your record menu and in the "What Sensei sees" panel. Sensei's own reports only say
            "Complete". We aim for Sensei to catch up within 30 seconds and have set 90 seconds as the limit; both are
            targets we are measuring, not a promise.
          </p>
          <p>
            <strong>Where your record lives.</strong> It lives on our servers under a random ID, in two places: the record
            store at {LRS_HOST}, and the Sensei user that tracks your lessons. It holds your steps, the answers you typed to
            checkpoints in your own words, and the files you edited, because those are what resuming and a future badge need.
            It holds no email unless you add one, which isn't built yet. A learner with no activity for {RETENTION_DAYS} days
            is deleted, and "Delete my data" in the record menu deletes it at once: your steps and files in the record
            store, your Sensei user and its progress, and any connected agents. "Download my record" gives you a copy first.
            There is no third-party analytics.
            {final && " Deleting your data revokes any badges you claimed, and a revoked badge stops verifying. We don't revoke badges when a learner just goes idle."}
          </p>
          {final && (
            <>
              <p>
                <strong>Badges you can verify.</strong> Finishing a path earns a badge, issued as an{' '}
                <a href="https://www.imsglobal.org/spec/ob/v3p0/">Open Badges 3.0</a> credential and signed by the record
                store as "Learn WordPress, reimagined". You claim it from the studio, add an email or a wallet on the store's
                claim page, and download or share it. Lessons you tested out count toward the badge, and the badge says how
                many. Lessons carried over from an older local record never count. The badge does not carry your random ID.
              </p>
              <p>
                <strong>A Sensei certificate.</strong> When a path's course is complete, Sensei LMS Certificates issues its
                usual PDF, and the studio offers it as a download from the "What Sensei sees" panel. The certificate is a
                document. The badge is a credential anyone can verify.
              </p>
            </>
          )}
        </Band>
      )}

      <Band id="concept-title" title={<>What's <Swipe>concept</Swipe></>} dark>
        <p>
          <Sticker>unofficial concept</Sticker>
        </p>
        <ul>
          <li>
            <strong>It's unofficial.</strong> One person made this. It's not affiliated with WordPress.org or the WordPress
            Foundation, and they don't run it.
          </li>
          <li>
            <strong>The lessons aren't reviewed.</strong> They're adapted from Learn WordPress, not reviewed by the Training
            Team. Each was checked against its live sources (<Cite to="src-accuracy">Block theme</Cite>,{' '}
            <Cite to="src-accuracy-learner">Learner</Cite>, <Cite to="src-accuracy-vibe">Vibe coder</Cite>), but nobody from
            the team has signed them off.
          </li>
          {anon ? (
            <li>
              <strong>You get an anonymous account.</strong> At your first recorded step the site creates a WordPress user
              for you in this prototype's Sensei, so Sensei can enrol you. It has a random ID, no name, no email and no
              password, and you never sign in to it. "Delete my data" in the record menu deletes it. Nothing syncs between
              your devices unless you move the record yourself. Signing in with a WordPress.org account is not built.
              {official && ' Records from before this change can be brought over once; those lessons show as complete but never count toward a badge.'}
            </li>
          ) : (
            <li>
              <strong>There are no accounts yet.</strong> Nobody signs in today. In the browser, your progress is one JSON
              file of xAPI statements under an anonymous ID (<Cite to="src-record">the record format</Cite>), and it stays on
              your device.
            </li>
          )}
          <li>
            <strong>It isn't connected to Learn.</strong>{' '}
            {sensei
              ? `This is not learn.wordpress.org. The Sensei here is the prototype's own install, with the prototype's own lessons, so nothing you do counts toward anything on Learn. ${official ? "This Sensei is the prototype's own, so your progress here doesn't count on Learn." : 'Your progress does not appear in Sensei yet.'}${final ? " Sensei's own pages are the backend view, not the learner experience." : ''}`
              : "Nothing here talks to learn.wordpress.org or Sensei, and progress here doesn't count there."}
          </li>
          {final && (
            <li>
              <strong>The badges are unofficial too.</strong> The badges are issued by this prototype, not by WordPress.org,
              and are not an official WordPress credential. They show up as signed by "Learn WordPress, reimagined" and
              nothing else.
            </li>
          )}
          <li>
            <strong>It's small.</strong> Three short paths, from <Cite to="src-content">the lesson files</Cite>, not whole
            courses.
          </li>
        </ul>
      </Band>

      <Band id="credit-title" title={<>Credit</>}>
        <p>
          The lessons stand on the work of the Learn WordPress Training Team and its contributors. Every lesson here is
          adapted from <a href="https://learn.wordpress.org/">Learn WordPress</a> or the Developer Handbooks, and links back
          to its source.
        </p>
        <p>
          Lesson content is{' '}
          <a href="https://creativecommons.org/licenses/by-sa/4.0/" rel="license">CC BY-SA 4.0</a>, the licence the
          Training Team chose for Learn content. Code is{' '}
          <a href="https://www.gnu.org/licenses/old-licenses/gpl-2.0.html" rel="license">GPL-2.0-or-later</a>, like
          WordPress.
        </p>
        <p>
          Concept and build by Derin Tolu. {final
            ? 'It runs on Cloudflare Workers AI, Spacefast, WordPress Playground, Sensei LMS and the open Learning Ledger plugin and course-xapi-mcp standard.'
            : 'It runs on Cloudflare Workers AI, Spacefast and WordPress Playground.'}{' '}
          The{' '}
          <a href={REPO_URL}>source is on GitHub</a>.
        </p>
      </Band>

      <Band id="sources-title" title={<>Sources</>}>
        <p>Every number and rule above comes from a file in the repo.</p>
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
      </Band>
    </div>
  );
}
