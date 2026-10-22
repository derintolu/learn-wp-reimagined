import type { ComponentChildren } from 'preact';
import { Sticker } from '../components/Sticker';
import { Swipe } from '../components/Swipe';
import { REPO_URL } from '../config';
import { COST_PER_1000_LEARNERS_USD } from '../shared/course-meta';
import { usePageTitle } from '../usePageTitle';

// These mirror server constants; tests/components/how-it-works.test.tsx checks each against its source file.
const MODELS = {
  structured: '@cf/openai/gpt-oss-120b',
  chat: '@cf/meta/llama-4-scout-17b-16e-instruct',
};
const CAP = { month: 100, day: 10 };
const MCP = { bodyMb: 1, global: '1,200', perHandle: 120, create: 60, windowMin: 10, relayDays: 30 };

const SOURCES = [
  { id: 'src-eval', file: 'docs/model-eval.md', what: 'Model evaluation, October 2026: the models for each task, how they were chosen, and the cost estimate.' },
  { id: 'src-config', file: 'functions/_lib/config.ts', what: 'The provider and model for each task, and the price of each model.' },
  { id: 'src-providers', file: 'functions/_lib/providers/', what: 'The provider interface, the Workers AI adapter and the Anthropic adapter.' },
  { id: 'src-prompts', file: 'functions/_lib/prompts.ts', what: 'What the AI is told it may and may not do.' },
  { id: 'src-budget', file: 'functions/_lib/budget.ts', what: 'The monthly cap and the daily sub-cap.' },
  { id: 'src-gate', file: 'functions/_lib/mcp/gate.ts', what: 'The limits in front of the MCP server.' },
  { id: 'src-store', file: 'functions/_lib/mcp/recordStore.ts', what: 'How long an agent record is kept.' },
  { id: 'src-record', file: 'docs/record-format.md', what: 'The learning record format and its xAPI statements.' },
] as const;

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

/** /how-it-works: what's real, what's concept, and where every number comes from (spec §3). */
export function HowItWorks() {
  usePageTitle('How this works');
  return (
    <div class="how-page">
      <section class="band band--light" aria-labelledby="how-page-title">
        <div class="wrap split">
          <h1 id="how-page-title" class="placeholder__title">
            How this <Swipe>works</Swipe>
          </h1>
          <div class="split__body lede">
            <p>
              This site is a working concept: a picture of what Learn WordPress could feel like if the AI faced the learner.
              Some of it is real and some of it is pretend. Here's which is which, and where every number on this page comes
              from.
            </p>
          </div>
        </div>
      </section>

      <Band id="real-title" title={<>What's <Swipe>real</Swipe></>}>
        <ul>
          <li>
            <strong>Live AI on open models.</strong> The placement chat, the checkpoint judge, the lesson tutor and the
            feedback on your code all call open models on Cloudflare Workers AI, live.
          </li>
          <li>
            <strong>Real Learn WordPress content.</strong> Every lesson is adapted from a{' '}
            <a href="https://learn.wordpress.org/">Learn WordPress</a> course or the WordPress Developer Handbooks, and
            names and links its sources.
          </li>
          <li>
            <strong>Real branching, written by hand.</strong> Paths, lessons, checkpoints and where each answer leads are
            authored as plain files in the repo. The AI reads your answer and picks one of the authored outcomes (move on,
            review, or skip ahead). The server rejects anything else.
          </li>
          <li>
            <strong>Code checks that don't guess.</strong> When you edit code, authored checks decide pass or fail: text
            that must or mustn't be there, patterns, and values in JSON. The AI only explains the result. With the AI off,
            the checks still run.
          </li>
          <li>
            <strong>A record you own.</strong> Your progress is one JSON file of real xAPI statements, under an anonymous
            ID with no name or email. It lives in your browser, or in a folder you pick (in Chromium browsers), and you can
            download or restore it at any time. The format is <Cite to="src-record">documented in the repo</Cite>.
          </li>
          <li>
            <strong>A real MCP server.</strong> The whole course is a remote MCP server. Add it to Claude, ChatGPT, Claude
            Code, Cursor or any MCP client and your agent becomes the tutor, with the same lessons, checks and branches.{' '}
            <a href="/connect">Connect your agent</a>.
          </li>
          <li>
            <strong>Real WordPress at the end.</strong> Each path's finale opens what you built in a full WordPress site
            running in your browser, with WordPress Playground.
          </li>
        </ul>
      </Band>

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
            Team. Each one was checked against its live sources while it was written, but nobody from the team has signed
            them off.
          </li>
          <li>
            <strong>There are no accounts.</strong> Nobody signs in, and nothing syncs between your devices unless you move
            the record yourself. Signing in with a WordPress.org account is a possible next step, and it isn't built.
          </li>
          <li>
            <strong>It isn't connected to Learn.</strong> Nothing here talks to learn.wordpress.org or Sensei, and progress
            here doesn't count there.
          </li>
          <li>
            <strong>It's small.</strong> Three short paths, not whole courses.
          </li>
        </ul>
      </Band>

      <Band id="ai-title" title={<>What the AI <Swipe>does</Swipe></>}>
        <h3>Which models</h3>
        <div class="prose__table">
          <table>
            <caption>Model for each task</caption>
            <thead>
              <tr>
                <th scope="col">Task</th>
                <th scope="col">Model</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">Placement chat</th>
                <td><code>{MODELS.structured}</code></td>
              </tr>
              <tr>
                <th scope="row">Checkpoint judge</th>
                <td><code>{MODELS.structured}</code></td>
              </tr>
              <tr>
                <th scope="row">Lesson tutor</th>
                <td><code>{MODELS.chat}</code></td>
              </tr>
              <tr>
                <th scope="row">Code feedback</th>
                <td><code>{MODELS.chat}</code></td>
              </tr>
            </tbody>
          </table>
        </div>
        <p>
          These were chosen by testing, <Cite to="src-eval">from our model evaluation, October 2026</Cite>: five candidate
          models on Workers AI, 26 test cases (placement chats, checkpoint answers, tutor questions and code feedback), and a
          rule that placement and judging must return valid JSON at least 95% of the time. The tutor model was the only one
          that refused every attempt to get the answer out of it.
        </p>

        <h3>What it may do</h3>
        <ul>
          <li>Ask a few questions, then recommend a path and a first lesson from the authored list, and say why. The server checks the lessons are real.</li>
          <li>Judge a checkpoint answer against the authored rubric, and choose one of that checkpoint's authored outcomes.</li>
          <li>Put each part of a lesson in its own words, and answer questions about the lesson you're on.</li>
          <li>Give a hint about your code after the authored checks have run.</li>
        </ul>

        <h3>What it may not do</h3>
        <ul>
          <li>Invent a path, a lesson or a branch.</li>
          <li>Hand over a complete solution.</li>
          <li>Name the planted bug, point at its line, or write the fix.</li>
          <li>Add settings, functions or hooks that aren't in the lesson material.</li>
          <li>Take orders from what you type. Your text is treated as data, never as instructions.</li>
        </ul>
        <p>
          Those rules are in <Cite to="src-prompts">the prompts</Cite>, and the server checks the AI's choices against the
          authored content.
        </p>

        <h3>When it's away</h3>
        <p>
          If the AI is slow, down or out of budget, placement becomes a short list of paths to pick from, checkpoints become
          multiple choice, and the tutor tells you it's away. Lessons, code checks and your record keep working.
        </p>

        <h3>No single model</h3>
        <p>
          The server talks to models through a <Cite to="src-providers">small provider interface</Cite>. Workers AI is the
          live provider. An Anthropic adapter is written and tested, and stays off unless an API key is added. The provider
          and model for each task are <Cite to="src-config">server settings</Cite>, so changing either is a config change,
          not a rewrite. It's the same idea as the Connectors in WordPress 7: the learning layer (the lessons, branches,
          checks and your record) doesn't depend on any one model.
        </p>
      </Band>

      <Band id="bugs-title" title={<>The planted <Swipe>bugs</Swipe></>} dark>
        <p>
          Every path has at least one moment labelled <q>AI-written code. We planted one bug. Find it.</q> That's what
          happened. The code was generated by an AI model ahead of time, and the bug was planted by the course author, so
          every learner sees the same reliable mistake.
        </p>
        <p>
          A live model might write different code each time, or no bug at all, which makes for a poor lesson. The tutor is
          told never to give the bug away, and authored checks confirm your fix.
        </p>
      </Band>

      <Band id="cost-title" title={<>What it <Swipe>costs</Swipe></>}>
        <p>
          The AI costs about ${COST_PER_1000_LEARNERS_USD.toFixed(2)} per 1000 learners,{' '}
          <Cite to="src-eval">from our model evaluation, October 2026</Cite>. That assumes 1 placement chat, 6 checkpoint
          judgements and 20 tutor turns per learner, priced from measured token counts. Real tutor conversations are longer
          than the test cases, so expect it to cost more.
        </p>
        <p>
          Spending has a hard cap of ${CAP.month} a month across all providers, and a ${CAP.day} a day sub-cap so one busy
          day can't use up the month (<Cite to="src-budget">the budget code</Cite>). Each request reserves its worst-case
          cost before it runs, and is refused if that would cross a cap. The daily cap resets at 00:00 UTC, the monthly one
          on the 1st (UTC).
        </p>
        <p>
          At the cap, the AI features switch to their no-AI versions and the site offers to continue in your own agent. The
          MCP path keeps working, because your agent does the thinking on your own subscription and no model runs on this
          site's account.
        </p>
      </Band>

      <Band id="agent-title" title={<>Your own <Swipe>agent</Swipe></>} dark>
        <p>
          The MCP server sits behind a few limits (<Cite to="src-gate">the MCP gate</Cite>):
        </p>
        <ul>
          <li>requests of up to {MCP.bodyMb} MB</li>
          <li>{MCP.global} requests every {MCP.windowMin} minutes, across everyone</li>
          <li>{MCP.perHandle} tool calls every {MCP.windowMin} minutes for each record handle</li>
          <li>{MCP.create} new records every {MCP.windowMin} minutes, across everyone</li>
        </ul>
        <p>
          When you take the course into an agent, the server keeps your progress under a random record handle that only you
          hold. It stores no personal data, expires after {MCP.relayDays} days without use (
          <Cite to="src-store">the record store</Cite>), and you can delete it at any time from{' '}
          <a href="/connect">Connect your agent</a>.
        </p>
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
          Concept and build by Derin Tolu. It runs on Cloudflare Workers AI, Spacefast and WordPress Playground. The{' '}
          <a href={REPO_URL}>source is on GitHub</a>.
        </p>
      </Band>

      <Band id="sources-title" title={<>Sources</>}>
        <p>Every number and rule above comes from a file in the repo.</p>
        <ol class="prose__sources">
          {SOURCES.map((s) => (
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
