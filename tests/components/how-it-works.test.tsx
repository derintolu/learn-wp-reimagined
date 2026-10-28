// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { cleanup, render, screen } from '@testing-library/preact';
import { HowItWorks, LEDGER_REPO_URL, SPEC, SPEC_REPO_URL, STATUS } from '../../src/pages/HowItWorks';
import { DIAGRAM_LABEL } from '../../src/pages/HowItWorksDiagram';
import { FEATURES, REPO_URL } from '../../src/config';
import { BACKEND_VIEW_PATH, COST_PER_1000_LEARNERS_USD, LRS_HOST, MCP_URL, RETENTION_DAYS, SENSEI_VERSION } from '../../src/shared/course-meta';
import { REVIEW_DISCLAIMER } from '../../src/studio/Feed';
import { ROUTES } from '../../functions/_lib/config';
import { DAY_CAP_MICROS, MONTH_CAP_MICROS } from '../../functions/_lib/budget';
import { MCP_LIMITS } from '../../functions/_lib/mcp/gate';
import { MCP_TTL_MS } from '../../functions/_lib/mcp/recordStore';
import { phasesUpTo, restoreFlags, setFlags } from '../helpers/flags';
import { SHADOW_COPY } from '../../src/pages/copy';

afterEach(() => {
  cleanup();
  restoreFlags();
});

const text = () => (document.querySelector('.how-page')?.textContent ?? '').replace(/\s+/g, ' ');

describe('/how-it-works', () => {
  it('renders h1 "How this works"', () => {
    render(<HowItWorks />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('How this works');
  });

  it('states the not-affiliated and not-reviewed disclaimers', () => {
    render(<HowItWorks />);
    expect(text()).toContain('not affiliated with WordPress.org or the WordPress Foundation');
    expect(text().toLowerCase()).toContain(REVIEW_DISCLAIMER.toLowerCase());
  });

  it('links to the repo and to learn.wordpress.org', () => {
    const { container } = render(<HowItWorks />);
    const hrefs = Array.from(container.querySelectorAll('a')).map((a) => a.getAttribute('href'));
    expect(hrefs).toContain(REPO_URL);
    expect(hrefs).toContain('https://learn.wordpress.org/');
    expect(hrefs).toContain('/connect');
    expect(screen.getByRole('link', { name: 'CC BY-SA 4.0' }).getAttribute('href')).toBe('https://creativecommons.org/licenses/by-sa/4.0/');
    expect(screen.getByRole('link', { name: 'GPL-2.0-or-later' }).getAttribute('href')).toBe('https://www.gnu.org/licenses/old-licenses/gpl-2.0.html');
  });

  it('says the connector runs the course-xapi-mcp reference server, with no stale learning-mcp 0.1', () => {
    render(<HowItWorks />);
    const t = text();
    expect(t).toContain('It runs the course-xapi-mcp reference server');
    expect(t).toContain('Your record there is a practice record. Badges are off.');
    expect(t).toContain('on the course-xapi-mcp reference server');
    expect(t).not.toContain('learning-mcp 0.1');
    expect(t).not.toContain('moves onto the reference server next');
  });

  it('links the 0.2 spec draft and cites a source file that exists', () => {
    const { container } = render(<HowItWorks />);
    const hrefs = Array.from(container.querySelectorAll('a')).map((a) => a.getAttribute('href'));
    expect(hrefs).toContain('https://course-xapi-mcp.sqwrlz.com/spec/0.2/');
    expect(readFileSync('functions/_lib/mcp/practiceStore.ts', 'utf8')).toContain('MCP_TTL_MS');
    expect(text()).toContain('functions/_lib/mcp/practiceStore.ts');
  });

  it('labels the planted bug as the lessons do, and says who planted it', () => {
    render(<HowItWorks />);
    expect(text()).toContain('AI-written code. We planted one bug. Find it.');
    expect(text()).toContain('planted on purpose by the course author');
  });

  it('every number matches the file it comes from, and the page names that file', () => {
    render(<HowItWorks />);
    const t = text();
    expect(t).toContain(ROUTES.placement.model);
    expect(ROUTES.judge.model).toBe(ROUTES.placement.model);
    expect(t).toContain(ROUTES.tutor.model);
    expect(ROUTES.feedback.model).toBe(ROUTES.tutor.model);
    expect(t).toContain(`$${MONTH_CAP_MICROS / 1_000_000} a month`);
    expect(t).toContain(`$${DAY_CAP_MICROS / 1_000_000} a day`);
    expect(t).toContain(`$${COST_PER_1000_LEARNERS_USD.toFixed(2)} per 1000 learners`);
    expect(t).toContain(`${MCP_LIMITS.global.limit.toLocaleString('en-US')} requests`);
    expect(t).toContain(`${MCP_LIMITS.perHandle.limit} tool calls`);
    expect(t).toContain(`${MCP_LIMITS.create.limit} new records`);
    expect(MCP_LIMITS.global.windowMs).toBe(600_000);
    expect(MCP_LIMITS.perHandle.windowMs).toBe(600_000);
    expect(MCP_LIMITS.create.windowMs).toBe(600_000);
    expect(t).toContain(`${MCP_LIMITS.bodyBytes / 1_048_576} MB`);
    expect(t).toContain(`${MCP_TTL_MS / 86_400_000} days`);
    const doc = readFileSync('docs/model-eval.md', 'utf8');
    const refusals = (model: string) => new RegExp(`^\\| ${model} \\|(?:[^|]*\\|){4} \\d+% \\((\\d)/(\\d)\\) \\|`, 'm').exec(doc)!;
    const scout = refusals('llama-4-scout-17b-16e-instruct');
    const oss = refusals('gpt-oss-120b');
    expect(scout[1]).toBe(scout[2]);
    expect(t).toContain(`tried ${oss[2]} times`);
    expect(t).toContain(`refused all ${scout[1]}`);
    expect(t).toContain(`refused ${oss[1]} of ${oss[2]}`);
    const runs = [...doc.matchAll(/Re-run: \d+% \((\d+)\/(\d+)\)/g)];
    const last = runs[runs.length - 1];
    expect(t).toContain(`placement got ${last[1]} of ${last[2]} test conversations right, measured on this site's own lessons`);
    expect(doc).toMatch(/Re-run: \d+% \(\d+\/\d+\) on the real content/);
    if (last[1] === last[2]) expect(t).not.toContain('The miss was');
    for (const f of ['docs/content-accuracy.md', 'docs/content-accuracy-learner.md', 'docs/content-accuracy-vibe-coder.md', 'content/paths/', 'docs/model-eval.md', 'functions/_lib/budget.ts', 'functions/_lib/mcp/gate.ts', 'functions/_lib/config.ts', 'docs/record-format.md']) {
      expect(t).toContain(f);
    }
  });

  it('opens with course-xapi-mcp, built on cmi5 and xAPI, and Learning Ledger feeding Sensei', () => {
    const { container } = render(<HowItWorks />);
    const lede = container.querySelector('.lede')!.textContent!.replace(/\s+/g, ' ');
    for (const s of ['course-xapi-mcp', 'MCP', 'cmi5', 'xAPI', 'Learning Ledger', 'WordPress plugin', 'Sensei', 'inside your own AI']) {
      expect(lede).toContain(s);
    }
  });

  it('has the sections in order: standard, backend, custody, Learning Ledger, one lesson, cost, concept', () => {
    const { container } = render(<HowItWorks />);
    const h2 = Array.from(container.querySelectorAll('h2')).map((h) => h.textContent!.trim());
    expect(h2).toEqual([
      'One course, any AI',
      'The backend',
      'Who holds the record',
      'Learning Ledger',
      'One lesson, end to end',
      'What the AI costs',
      "What's concept",
      'Credit',
      'Sources',
    ]);
  });

  it('links both GitHub repos, and names the licences', () => {
    const { container } = render(<HowItWorks />);
    const hrefs = Array.from(container.querySelectorAll('a')).map((a) => a.getAttribute('href'));
    expect(SPEC_REPO_URL).toBe('https://github.com/derintolu/course-xapi-mcp');
    expect(LEDGER_REPO_URL).toBe('https://github.com/derintolu/learning-ledger');
    expect(hrefs).toContain(SPEC_REPO_URL);
    expect(hrefs).toContain(LEDGER_REPO_URL);
    expect(text()).toContain('Apache-2.0');
    expect(text()).toContain('Learning Ledger on GitHub, GPL-2.0-or-later');
  });

  it('states the standard: built on cmi5 and xAPI, the record no one in the chat can alter, and its real status', () => {
    render(<HowItWorks />);
    const t = text();
    expect(t).toContain('A course is a valid cmi5 package');
    expect(t).toContain('Every step is recorded as an xAPI statement, and badges are Open Badges 3.0');
    expect(t).toContain('nobody in the chat, you or the AI, can change the official record');
    expect(t).toContain(`Draft ${SPEC.draft}, not stable`);
    expect(t).toContain(`${SPEC.requirements} numbered requirements`);
    expect(t).toContain(`${SPEC.tests} unit and integration tests pass`);
    expect(t).toContain("Not yet tried: a launch from a real LMS");
    expect(SPEC).toEqual({ draft: '0.2', requirements: 149, tests: 725 });
  });

  it('draws the backend as an accessible inline SVG with labelled MCP, xAPI, cmi5 and Open Badges flows', () => {
    const { container } = render(<HowItWorks />);
    const figure = container.querySelector('figure.how-diagram')!;
    expect(figure).toBeTruthy();
    expect(figure.querySelector('figcaption')!.textContent).toContain('Blue is the only path learning facts take');
    const svgs = Array.from(figure.querySelectorAll('svg'));
    expect(svgs.map((s) => s.getAttribute('class'))).toEqual(['how-diagram__wide', 'how-diagram__tall']);
    for (const svg of svgs) {
      expect(svg.getAttribute('role')).toBe('img');
      expect(svg.getAttribute('aria-label')).toBe(DIAGRAM_LABEL);
      expect(svg.getAttribute('viewBox')).toMatch(/^0 0 \d+ \d+$/);
      expect(svg.querySelector('script, style, foreignObject, image')).toBeNull();
      const drawn = Array.from(svg.querySelectorAll('text')).map((t) => t.textContent).join(' | ');
      for (const label of ["Learner's AI", 'Course server', 'LRS', 'Learning Ledger', 'lrs.sqwrlz.com', 'Sensei LMS', 'MCP', 'xAPI', 'cmi5 launch', 'Open Badges 3.0']) {
        expect(drawn).toContain(label);
      }
      // Every arrowhead points at a marker defined in the same drawing.
      for (const el of Array.from(svg.querySelectorAll('[marker-end], [marker-start]'))) {
        for (const attr of ['marker-end', 'marker-start']) {
          const ref = el.getAttribute(attr);
          if (!ref) continue;
          const id = /^url\(#(.+)\)$/.exec(ref)![1];
          expect(svg.querySelector(`marker[id="${id}"]`)).toBeTruthy();
        }
      }
    }
    const ids = Array.from(container.querySelectorAll('[id]')).map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of ['MCP', 'xAPI statements', 'cmi5 launch', 'Open Badges 3.0', 'only thing that writes', 'not wired in yet']) {
      expect(DIAGRAM_LABEL).toContain(s);
    }
  });

  it('gives each component one status label, matching what runs here today', () => {
    const { container } = render(<HowItWorks />);
    const parts = Object.fromEntries(
      Array.from(container.querySelectorAll('.how-parts__list li')).map((li) => {
        const labels = li.querySelectorAll('.status');
        expect(labels).toHaveLength(1);
        return [li.querySelector('strong')!.textContent, labels[0].textContent];
      }),
    );
    expect(parts).toEqual({
      'The studio': STATUS.live,
      'The MCP connector': STATUS.live,
      'Record handles': STATUS.live,
      'The course-xapi-mcp reference server': STATUS.live,
      'Learning Ledger': STATUS.progress,
      'The LRS at lrs.sqwrlz.com': STATUS.idle,
      'Sensei as the course back end': STATUS.next,
      Badges: STATUS.next,
    });
    expect(text()).toContain(MCP_URL);
    expect(MCP_URL).toBe('https://learnwp.sqwrlz.com/api/mcp');
    expect(text()).toContain("Learning Ledger isn't installed there yet, so it holds no records");
  });

  it('explains the four custody options in order, and only practice earns no badge', () => {
    const { container } = render(<HowItWorks />);
    const cards = Array.from(container.querySelectorAll('.custody__card'));
    expect(cards.map((c) => c.querySelector('code')!.textContent)).toEqual(['lms-launched', 'author-lrs', 'server-kept', 'practice']);
    expect(cards.map((c) => c.querySelector('.custody__badges')!.textContent)).toEqual(['Badges: Yes', 'Badges: Yes', 'Badges: Yes', 'Badges: No']);
    expect(cards[1].textContent).toContain('This site is moving to this option');
    expect(text()).toContain("the agent can't write or replace the official record");
  });

  it('covers Learning Ledger: Sensei first, the cmi5 player, the LMSs to come and badge signing, without overclaiming', () => {
    const { container } = render(<HowItWorks />);
    const h3 = Array.from(container.querySelectorAll('h3')).map((h) => h.textContent);
    for (const h of ['Sensei first', 'A cmi5 player for Sensei', 'More LMSs', 'Badge signing']) expect(h3).toContain(h);
    const t = text();
    expect(t).toContain('loads only when that LMS is active');
    expect(t).toContain('It imports any cmi5 package');
    expect(t).toContain("its Sensei lesson is marked complete");
    expect(t).toContain('LifterLMS, Tutor LMS and LearnPress come next, in that order');
    expect(t).toContain("CATAPULT cmi5 test suite is wired in as a release gate and hasn't been run yet");
    expect(t).toContain('eddsa-rdfc-2022');
    expect(t).toContain('did:web:lrs.sqwrlz.com');
  });

  it('walks one lesson end to end in six labelled steps, using the real tool names', () => {
    const { container } = render(<HowItWorks />);
    const steps = Array.from(container.querySelectorAll('.how-flow > li'));
    expect(steps).toHaveLength(6);
    expect(steps.map((s) => s.querySelector('.status')!.textContent)).toEqual([STATUS.next, STATUS.live, STATUS.live, STATUS.live, STATUS.next, STATUS.next]);
    const flow = container.querySelector('.how-flow')!.textContent!;
    for (const tool of ['get_status', 'get_lesson', 'next_beat', 'check_code', 'submit_checkpoint', 'choose_branch']) expect(flow).toContain(tool);
  });

  it('uses only the labels it defines, and no em dashes', () => {
    const { container } = render(<HowItWorks />);
    const used = new Set(Array.from(container.querySelectorAll('.status')).map((s) => s.textContent));
    for (const l of used) expect(Object.values(STATUS)).toContain(l);
    expect(text()).not.toContain('—');
  });

  it('has one h1 and never skips a heading level', () => {
    const { container } = render(<HowItWorks />);
    const levels = Array.from(container.querySelectorAll('h1, h2, h3, h4')).map((h) => Number(h.tagName[1]));
    expect(levels.filter((l) => l === 1)).toHaveLength(1);
    expect(levels[0]).toBe(1);
    for (let i = 1; i < levels.length; i++) expect(levels[i] - levels[i - 1]).toBeLessThanOrEqual(1);
  });

  it('has no emoji', () => {
    render(<HowItWorks />);
    expect(text()).not.toMatch(/\p{Extended_Pictographic}/u);
  });
});

describe('COST_PER_1000_LEARNERS_USD', () => {
  it('matches the estimate in docs/model-eval.md', () => {
    const doc = readFileSync('docs/model-eval.md', 'utf8');
    const m = /Estimated cost of the chosen mix: about \$(\d+\.\d+) per 1000 learners/.exec(doc);
    expect(m).toBeTruthy();
    expect(COST_PER_1000_LEARNERS_USD).toBe(Number(m![1]));
  });
});

describe('/how-it-works with the Sensei content flag', () => {
  const flags = FEATURES as { wordpressContent: boolean };
  const view = () => render(<HowItWorks />);
  const hrefs = (c: Element) => Array.from(c.querySelectorAll('a')).map((a) => a.getAttribute('href'));
  afterEach(() => {
    flags.wordpressContent = false;
  });

  it('ships off, with the pinned version and the block-theme backend view', () => {
    expect(flags.wordpressContent).toBe(false);
    expect(SENSEI_VERSION).toBe('4.26.4');
    expect(BACKEND_VIEW_PATH).toBe('/backend/block-theme');
  });

  it('off: no Sensei backend copy and no backend-view link', () => {
    const { container } = view();
    expect(text()).not.toContain('backend view');
    expect(text()).not.toContain(SENSEI_VERSION);
    expect(hrefs(container)).not.toContain(BACKEND_VIEW_PATH);
    expect(text()).toContain('authored as plain files in the repo');
  });

  it('on: links the backend view, and the new copy has no emoji', () => {
    flags.wordpressContent = true;
    const { container } = view();
    expect(hrefs(container)).toContain(BACKEND_VIEW_PATH);
    expect(screen.getAllByRole('link', { name: /^the backend view/ }).length).toBeGreaterThan(0);
    expect(text()).not.toMatch(/\p{Extended_Pictographic}/u);
    // An app route now: opens in the same tab through the router, so no target.
    const link = container.querySelector(`a[href="${BACKEND_VIEW_PATH}"]`)!;
    expect(link.getAttribute('target')).toBeNull();
    expect(link.textContent).not.toContain('opens in a new tab');
  });

  it('on: names Sensei with the pinned version, and updates the branching, concept and sources lines', () => {
    flags.wordpressContent = true;
    view();
    const t = text();
    expect(t).toContain(`Sensei LMS ${SENSEI_VERSION}`);
    expect(t).toContain('authored in Sensei, with a reviewable copy committed to the repo');
    expect(t).not.toContain('authored as plain files in the repo');
    expect(t).toContain('Your progress does not appear in Sensei yet.');
    expect(t).not.toContain('Nothing here talks to learn.wordpress.org or Sensei');
    expect(t).toContain('content/snapshot/');
    expect(t).not.toContain('content/paths/');
  });

  it('on: labels Sensei as live here', () => {
    flags.wordpressContent = true;
    const { container } = view();
    const sensei = Array.from(container.querySelectorAll('.how-parts__list li')).find((li) => li.querySelector('strong')!.textContent === 'Sensei as the course back end')!;
    expect(sensei.querySelector('.status')!.textContent).toBe(STATUS.live);
  });
});

const SESSION_BULLET =
  'There are no accounts. Nobody signs in. At your first recorded step the site gives your browser a random session so the server can tell your steps apart. It holds no name or email, and "Delete my data" in the record menu removes it.';
const SESSION_TAIL =
  "Nothing syncs between your devices unless you move the record yourself. Signing in with a WordPress.org account is a possible next step, and it isn't built.";

describe('/how-it-works with sessions (phase 2)', () => {
  it('ships on', () => {
    expect(FEATURES.sessions).toBe(true);
  });

  it('on: the approved phase 2 accounts bullet, and nothing that says there is no server state', () => {
    render(<HowItWorks />);
    const t = text();
    expect(t).toContain(SESSION_BULLET);
    expect(t).toContain(SESSION_TAIL);
    expect(t).not.toContain('There are no accounts yet');
    expect(t).not.toContain('Nobody signs in today');
  });

  it('off: no session sentence', () => {
    setFlags({ sessions: false });
    render(<HowItWorks />);
    expect(text()).not.toContain('random session');
    expect(text()).toContain('There are no accounts yet. Nobody signs in today.');
  });

  it('the anonymous account replaces the session bullet', () => {
    setFlags({ senseiLearners: true });
    render(<HowItWorks />);
    expect(text()).not.toContain(SESSION_BULLET);
    expect(text()).toContain('You get an anonymous account.');
  });
});

describe('/how-it-works with the anonymous-accounts flag', () => {
  const flags = FEATURES as { senseiLearners: boolean; wordpressContent: boolean };
  const view = () => render(<HowItWorks />);
  afterEach(() => {
    flags.senseiLearners = false;
    flags.wordpressContent = false;
  });

  it('ships off', () => {
    expect(flags.senseiLearners).toBe(false);
  });

  it('off, sessions off: the pre-session accounts bullet', () => {
    setFlags({ sessions: false });
    view();
    expect(text()).toContain(
      "There are no accounts yet. Nobody signs in today. In the browser, your progress is one JSON file of xAPI statements under an anonymous ID (the record format), and it stays on your device.",
    );
    expect(text()).not.toContain('You get an anonymous account.');
  });

  it('on: the anonymous-account bullet replaces the no-accounts bullet, verbatim', () => {
    flags.senseiLearners = true;
    view();
    const t = text();
    expect(t).toContain(
      'You get an anonymous account. At your first recorded step the site creates a WordPress user for you in this prototype\'s Sensei, so Sensei can enrol you. It has a random ID, no name, no email and no password, and you never sign in to it. "Delete my data" in the record menu deletes it. Nothing syncs between your devices unless you move the record yourself. Signing in with a WordPress.org account is not built.',
    );
    expect(t).not.toContain('There are no accounts');
    expect(t).not.toMatch(/\p{Extended_Pictographic}/u);
  });

  it('on with Sensei content: adds the enrolment sentence to the Sensei part, and only then', () => {
    const enrol = "Sensei enrols you in a path when you start it. Sensei's own pages are the same for everyone and don't show your progress.";
    flags.senseiLearners = true;
    view();
    expect(text()).not.toContain(enrol);
    cleanup();
    flags.wordpressContent = true;
    view();
    expect(text()).toContain(enrol);
    cleanup();
    flags.senseiLearners = false;
    view();
    expect(text()).not.toContain(enrol);
  });
});

describe('/how-it-works with the official-record flag', () => {
  const flags = FEATURES as { officialRecord: boolean; senseiLearners: boolean; wordpressContent: boolean };
  const view = () => render(<HowItWorks />);
  const allOn = () => {
    flags.officialRecord = true;
    setFlags({ lrsShadow: true });
    flags.senseiLearners = true;
    flags.wordpressContent = true;
  };
  afterEach(() => {
    flags.officialRecord = false;
    flags.senseiLearners = false;
    flags.wordpressContent = false;
  });

  it('ships off, with the numbers from course-meta', () => {
    expect(flags.officialRecord).toBe(false);
    expect(RETENTION_DAYS).toBe(180);
    expect(LRS_HOST).toBe('lrs.sqwrlz.com');
  });

  it('off: no where-the-record-lives copy, and the page text is what it was', () => {
    const before = (view(), text());
    expect(before).not.toContain('Where your record lives');
    expect(before).not.toContain('Progress that reaches Sensei');
    expect(before).not.toContain(`${RETENTION_DAYS} days`);
    expect(before).not.toContain('A real record, kept in a real LRS');
  });

  it('on: the approved copy, verbatim, with the numbers read from course-meta', () => {
    allOn();
    view();
    const t = text();
    expect(t).toContain(
      `A real record, kept in a real LRS. Your progress is a set of xAPI statements, the standard format for learning records, under a random ID with no name or email. The official copy is kept in a learning record store at ${LRS_HOST}, a separate WordPress install running the Learning Ledger plugin. Only the course server writes to it.`,
    );
    expect(t).toContain("you can't edit it. Your browser keeps a working copy so the lesson stays quick, and your files can also be saved to a folder you pick (in Chromium browsers).");
    expect(t).toContain(
      'Progress that reaches Sensei. When you finish a lesson, or skip one by showing you already know it, the record store tells Sensei, which marks the lesson complete. A skipped lesson is marked complete in Sensei and shown as "tested out" in your record menu and in the "What Sensei sees" panel. Sensei\'s own reports only say "Complete". We aim for Sensei to catch up within 30 seconds and have set 90 seconds as the limit; both are targets we are measuring, not a promise.',
    );
    expect(t).toContain(
      `Where your record lives. It lives on our servers under a random ID, in two places: the record store at ${LRS_HOST}, and the Sensei user that tracks your lessons. It holds your steps, the answers you typed to checkpoints in your own words, and the files you edited, because those are what resuming and a future badge need. It holds no email unless you add one, which isn't built yet. A learner with no activity for ${RETENTION_DAYS} days is deleted, and "Delete my data" in the record menu deletes it at once: your steps and files in the record store, your Sensei user and its progress, and any connected agents. "Download my record" gives you a copy first. There is no third-party analytics.`,
    );
    expect(t).not.toMatch(/\p{Extended_Pictographic}/u);
  });

  it('on: has its own heading, and the relay copy is still there', () => {
    allOn();
    const { container } = view();
    expect(Array.from(container.querySelectorAll('h2')).map((h) => h.textContent)).toContain('Where your record lives');
    expect(text()).toContain('Record handles');
  });

  it('on: Sensei and concept lines follow phase 6', () => {
    allOn();
    view();
    const t = text();
    expect(t).toContain('Your progress in Sensei is shown in the "What Sensei sees" panel in the studio.');
    expect(t).toContain("This Sensei is the prototype's own, so your progress here doesn't count on Learn.");
    expect(t).not.toContain('Your progress does not appear in Sensei yet.');
    expect(t).toContain('Records from before this change can be brought over once; those lessons show as complete but never count toward a badge.');
  });

  it('off with the other flags on: phase 4 lines unchanged', () => {
    flags.wordpressContent = true;
    flags.senseiLearners = true;
    view();
    const t = text();
    expect(t).toContain('Your progress does not appear in Sensei yet.');
    expect(t).not.toContain('What Sensei sees');
    expect(t).not.toContain('Records from before this change');
  });

  it('on with every earlier phase on: no browser-only or Sensei-not-installed sentence', () => {
    allOn();
    view();
    const t = text();
    expect(t).not.toContain('There are no accounts yet');
    expect(t).not.toContain('it stays on your device');
    expect(t).not.toContain("isn't installed on this site's WordPress yet");
    expect(t).not.toContain('Nothing here talks to learn.wordpress.org or Sensei');
    expect(t).toContain('You get an anonymous account.');
  });

  it.each([
    ['wordpressContent', { senseiLearners: true, wordpressContent: false }],
    ['senseiLearners', { senseiLearners: false, wordpressContent: true }],
    ['both', { senseiLearners: false, wordpressContent: false }],
  ])('on with %s off: renders exactly as with the flag off', (_n, set) => {
    Object.assign(flags, { ...set, officialRecord: false });
    const r = view();
    const base = text();
    r.unmount();
    Object.assign(flags, { ...set, officialRecord: true });
    view();
    expect(text()).toBe(base);
  });
});

describe('/how-it-works final rewrite (phase 8)', () => {
  const flags = FEATURES as { officialRecord: boolean; senseiLearners: boolean; wordpressContent: boolean; badges: boolean };
  const allOn = () => {
    flags.officialRecord = true;
    setFlags({ lrsShadow: true });
    flags.senseiLearners = true;
    flags.wordpressContent = true;
    flags.badges = true;
  };
  afterEach(() => {
    flags.officialRecord = false;
    flags.senseiLearners = false;
    flags.wordpressContent = false;
    flags.badges = false;
  });
  const REVOKED = 'Deleting your data revokes any badges you claimed, and a revoked badge stops verifying.';

  it.each([['today', () => {}], ['every flag on', allOn]])('%s: every source listed exists, and every Cite resolves', (_n, set) => {
    set();
    const { container } = render(<HowItWorks />);
    const items = Array.from(container.querySelectorAll('.prose__sources li'));
    for (const li of items) expect(existsSync(li.querySelector('code')!.textContent!), li.textContent ?? '').toBe(true);
    const ids = new Set(items.map((li) => li.id));
    for (const a of Array.from(container.querySelectorAll('a.prose__cite'))) expect(ids.has(a.getAttribute('href')!.slice(1)), a.textContent ?? '').toBe(true);
  });

  it('off: no badge, certificate or revocation copy', () => {
    flags.officialRecord = true;
    setFlags({ lrsShadow: true });
    render(<HowItWorks />);
    const t = text();
    for (const s of ['Badges you can verify', 'A Sensei certificate', 'revokes any badges', 'not an official WordPress credential', 'Sensei LMS and the open Learning Ledger plugin']) expect(t).not.toContain(s);
  });

  it('on: badges, certificate, revocation, the unofficial lines and the credit', () => {
    allOn();
    render(<HowItWorks />);
    const t = text();
    expect(t).toContain('Badges you can verify. Finishing a path earns a badge, issued as an Open Badges 3.0 credential and signed by the record store as "Learn WordPress, reimagined".');
    expect(t).toContain('The badge does not carry your random ID.');
    expect(t).toContain('A Sensei certificate. When a path\'s course is complete, Sensei LMS Certificates issues its usual PDF, and the studio offers it as a download from the "What Sensei sees" panel.');
    expect(t).toContain('The certificate is a document. The badge is a credential anyone can verify.');
    expect(t).toContain(REVOKED);
    expect(t).toContain("We don't revoke badges when a learner just goes idle.");
    expect(t).toContain('The badges are issued by this prototype, not by WordPress.org, and are not an official WordPress credential.');
    expect(t).toContain("Sensei's own pages are the backend view, not the learner experience.");
    expect(t).toContain('not reviewed by the Training Team');
    expect(t).toContain('not affiliated with WordPress.org or the WordPress Foundation');
    expect(t).toContain('It runs on Cloudflare Workers AI, Spacefast, WordPress Playground, Sensei LMS and the open Learning Ledger plugin and course-xapi-mcp standard.');
    expect(t).not.toMatch(/\p{Extended_Pictographic}/u);
  });

  it('on: the Badges part is live and the LRS holds records', () => {
    allOn();
    const { container } = render(<HowItWorks />);
    const li = (name: string) => Array.from(container.querySelectorAll('.how-parts__list li')).find((x) => x.querySelector('strong')!.textContent!.startsWith(name))!;
    expect(li('Badges').querySelector('.status')!.textContent).toBe(STATUS.live);
    expect(li('The LRS at').textContent).not.toContain('holds no records');
    expect(li('Learning Ledger').textContent).not.toContain("isn't installed");
  });

  it('on with an earlier phase off: renders as with the flag off', () => {
    flags.wordpressContent = true;
    flags.senseiLearners = true;
    flags.officialRecord = true;
    setFlags({ lrsShadow: true });
    const r = render(<HowItWorks />);
    const base = text();
    r.unmount();
    flags.badges = true;
    flags.senseiLearners = false;
    render(<HowItWorks />);
    expect(text()).not.toContain(REVOKED);
    expect(base).not.toContain(REVOKED);
  });
});

describe('/how-it-works LRS and Ledger parts per flag state', () => {
  const flags = FEATURES as { officialRecord: boolean; senseiLearners: boolean; wordpressContent: boolean; badges: boolean; agentOnStandard: boolean };
  afterEach(() => {
    Object.assign(flags, { officialRecord: false, senseiLearners: false, wordpressContent: false, badges: false, agentOnStandard: false });
  });
  const part = (c: HTMLElement, name: string) => Array.from(c.querySelectorAll('.how-parts__list li')).find((x) => x.querySelector('strong')!.textContent!.startsWith(name))!.textContent!;
  const on = (o: Partial<typeof flags>) => Object.assign(flags, { officialRecord: true, senseiLearners: true, wordpressContent: true, lrsShadow: true }, o);

  it('officialRecord only: no badge signing claim, agents keep practice records', () => {
    on({});
    const { container } = render(<HowItWorks />);
    expect(part(container, 'Learning Ledger')).not.toContain('badge signing');
    expect(part(container, 'The LRS at')).toContain('Agents keep practice records elsewhere until they sign in.');
    expect(part(container, 'The LRS at')).not.toContain('nothing else does');
  });
  it('badges on: badge signing is named', () => {
    on({ badges: true });
    const { container } = render(<HowItWorks />);
    expect(part(container, 'Learning Ledger')).toContain('and so is badge signing');
  });
  it('agentOnStandard on: the unconditional sentence', () => {
    on({ agentOnStandard: true });
    const { container } = render(<HowItWorks />);
    expect(part(container, 'The LRS at')).toContain('writes every learning record here, and nothing else does.');
    expect(part(container, 'The LRS at')).not.toContain('practice records');
  });
});

describe('/how-it-works with the LRS shadow (phase 5)', () => {
  it('off: no second-server sentence', () => {
    render(<HowItWorks />);
    expect(text()).not.toContain(SHADOW_COPY);
  });

  it('on, in R30 order: the approved sentence, verbatim', () => {
    phasesUpTo('lrsShadow');
    render(<HowItWorks />);
    expect(text()).toContain(
      'While we test a separate record store, a copy of your steps, including the answers you type to checkpoints, is also kept on a second server, under your random ID. Your local record is still the one the site uses. "Delete my data" removes the copy.',
    );
  });

  it('on out of order: nothing', () => {
    setFlags({ lrsShadow: true });
    render(<HowItWorks />);
    expect(text()).not.toContain(SHADOW_COPY);
  });

  it('officialRecord on: the shadow sentence gives way to where the record lives', () => {
    phasesUpTo('officialRecord');
    render(<HowItWorks />);
    expect(text()).not.toContain('Your local record is still the one the site uses.');
    expect(text()).toContain('Where your record lives.');
  });
});
