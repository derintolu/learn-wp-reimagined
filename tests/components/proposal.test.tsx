// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { cleanup, render, screen } from '@testing-library/preact';
import { Proposal } from '../../src/pages/Proposal';
import { FEATURES, REPO_URL } from '../../src/config';
import { BACKEND_VIEW_PATH, COST_PER_1000_LEARNERS_USD, LRS_HOST, RETENTION_DAYS, SENSEI_VERSION } from '../../src/shared/course-meta';
import { REVIEW_DISCLAIMER } from '../../src/studio/Feed';
import { DAY_CAP_MICROS, MONTH_CAP_MICROS } from '../../functions/_lib/budget';
import { MCP_TTL_MS } from '../../functions/_lib/mcp/recordStore';
import { phasesUpTo, restoreFlags, setFlags } from '../helpers/flags';
import { SHADOW_COPY } from '../../src/pages/copy';

afterEach(() => {
  cleanup();
  restoreFlags();
});

const SOURCE = readFileSync('src/pages/Proposal.tsx', 'utf8');
const text = () => (document.querySelector('.proposal-page')?.textContent ?? '').replace(/\s+/g, ' ');

const SECTIONS = [
  'The gap',
  'What the demo proves',
  'A phased path onto Learn',
  'How authored branching fits the content workflow',
  'Cost, privacy, accessibility and upkeep',
  'Design decisions',
];

describe('/proposal', () => {
  it('renders h1 and the six section headings in order', () => {
    const { container } = render(<Proposal />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('The proposal');
    const h2s = Array.from(container.querySelectorAll('h2')).map((h) => h.textContent);
    expect(h2s.slice(0, SECTIONS.length)).toEqual(SECTIONS);
  });

  it('every claim in "The gap" has a link', () => {
    const { container } = render(<Proposal />);
    const claims = Array.from(container.querySelectorAll('section[aria-labelledby="gap-title"] .gap-claims > li'));
    expect(claims.length).toBeGreaterThanOrEqual(4);
    for (const li of claims) {
      const links = Array.from(li.querySelectorAll('a[href^="https://"]'));
      expect(links.length, li.textContent ?? '').toBeGreaterThan(0);
    }
  });

  it('records every gap source URL with the date it was checked, in the comment block at the top', () => {
    const { container } = render(<Proposal />);
    const header = /^\/\*\*([\s\S]*?)\*\//.exec(SOURCE)?.[1] ?? '';
    const hrefs = Array.from(container.querySelectorAll('section[aria-labelledby="gap-title"] .gap-claims a')).map((a) => a.getAttribute('href')!);
    expect(hrefs.length).toBeGreaterThan(0);
    for (const href of hrefs) {
      const line = header.split('\n').find((l) => l.includes(href));
      expect(line, href).toBeTruthy();
      expect(line!, href).toMatch(/checked \d{4}-\d{2}-\d{2}/);
    }
  });

  it('the cost figure matches docs/model-eval.md', () => {
    render(<Proposal />);
    const doc = readFileSync('docs/model-eval.md', 'utf8');
    const m = /Estimated cost of the chosen mix: about \$(\d+\.\d+) per 1000 learners/.exec(doc)!;
    expect(COST_PER_1000_LEARNERS_USD).toBe(Number(m[1]));
    // One constant, shared with How this works: the page imports it and never writes the number itself.
    expect(SOURCE).toMatch(/import \{[^}]*COST_PER_1000_LEARNERS_USD[^}]*\} from '\.\.\/shared\/course-meta'/);
    expect(SOURCE).not.toContain(m[1]);
    const t = text();
    expect(t).toContain(`$${COST_PER_1000_LEARNERS_USD.toFixed(2)} per 1000 learners`);
    expect(doc).toContain('1 placement call, 6 judge calls and 20 tutor turns');
    expect(t).toContain('1 placement chat, 6 checkpoint judgements and 20 tutor turns');
    expect(doc).toContain('covers roughly 20,000 learners');
    expect(t).toContain('roughly 20,000 learners');
    expect(t).toContain(`$${MONTH_CAP_MICROS / 1_000_000} a month`);
    expect(t).toContain(`$${DAY_CAP_MICROS / 1_000_000} a day`);
    expect(t).toContain(`${MCP_TTL_MS / 86_400_000} days`);
  });

  it('credits the Training Team, states the disclaimers and links its sources', () => {
    const { container } = render(<Proposal />);
    const t = text();
    expect(t).toContain('Training Team');
    expect(t).toContain('not affiliated with WordPress.org or the WordPress Foundation');
    expect(t.toLowerCase()).toContain(REVIEW_DISCLAIMER.toLowerCase());
    const hrefs = Array.from(container.querySelectorAll('a')).map((a) => a.getAttribute('href'));
    expect(hrefs).toContain(REPO_URL);
    expect(hrefs).toContain('/how-it-works');
    expect(hrefs).toContain('/connect');
    for (const f of ['docs/model-eval.md', 'functions/_lib/budget.ts', 'docs/record-format.md', 'functions/_lib/mcp/practiceStore.ts', 'scripts/build-content.ts']) {
      expect(t).toContain(f);
    }
  });

  it('every in-page citation points at an entry in the sources list', () => {
    const { container } = render(<Proposal />);
    const cites = Array.from(container.querySelectorAll('a.prose__cite')).map((a) => a.getAttribute('href')!.slice(1));
    expect(cites.length).toBeGreaterThan(0);
    for (const id of cites) expect(container.querySelector(`.prose__sources li[id="${id}"]`), id).toBeTruthy();
  });

  it('gives each design decision its cost', () => {
    const { container } = render(<Proposal />);
    const items = Array.from(container.querySelectorAll('section[aria-labelledby="decisions-title"] .decisions > li'));
    expect(items.length).toBeGreaterThanOrEqual(5);
    expect(items.length).toBeLessThanOrEqual(8);
    for (const li of items) expect(li.textContent, li.textContent ?? '').toMatch(/The cost:/);
  });

  it('has one h1 and never skips a heading level', () => {
    const { container } = render(<Proposal />);
    const levels = Array.from(container.querySelectorAll('h1, h2, h3, h4')).map((h) => Number(h.tagName[1]));
    expect(levels.filter((l) => l === 1)).toHaveLength(1);
    expect(levels[0]).toBe(1);
    for (let i = 1; i < levels.length; i++) expect(levels[i] - levels[i - 1]).toBeLessThanOrEqual(1);
  });

  it('states only what the demo can show', () => {
    render(<Proposal />);
    const t = text();
    expect(t).not.toContain('Every learner sees the same pathway');
    expect(t).toContain('Learners pick a level themselves; nothing places them.');
    expect(t).not.toContain('The AI never hands over working code');
    expect(t).toContain('The AI is told never to hand over working code');
    expect(t).not.toContain('nothing surprises the reviewer');
    expect(t).toContain('every route can be reviewed');
    expect(t).toContain('were checked in the browser');
  });

  it('has no emoji and no sales language', () => {
    render(<Proposal />);
    const t = text();
    expect(t).not.toMatch(/\p{Extended_Pictographic}/u);
    expect(t).not.toMatch(/revolutionary|game.?chang|cutting.?edge|seamless|best-in-class|world-class|unlock|supercharge/i);
  });
});

describe('/proposal with the Sensei content flag', () => {
  const flags = FEATURES as { wordpressContent: boolean };
  const view = () => render(<Proposal />);
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
    expect(text()).toContain('Lessons stay in Sensei, written and reviewed as they are now.');
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

  it('on: phase 1 says lessons live in Sensei, upkeep and sources follow the snapshot', () => {
    flags.wordpressContent = true;
    view();
    const t = text();
    expect(t).toContain('Lessons live in Sensei, written and reviewed as they are now. In this concept they do: all 18 are stored in Sensei');
    expect(t).not.toContain('Lessons stay in Sensei');
    expect(t).toContain("The tutor and placement are running in this concept. What isn't shown is Sensei progress (phase 3 below) and the Training Team's review of these lessons.");
    expect(t).toContain('authored in Sensei and exported to a committed snapshot');
    expect(t).not.toContain('are plain YAML files');
    expect(t).toContain('as exported from Sensei.');
    expect(t).not.toContain('content/paths/');
    expect(t).toContain('content/snapshot/');
  });
});

const PRIVACY_SESSION = 'The server keeps only a random session, with no name or email, and the learner can delete it from the record menu.';

describe('/proposal with sessions (phase 2)', () => {
  it('on: the approved Privacy sentence between the record and the relay lines', () => {
    render(<Proposal />);
    expect(text()).toContain(
      `The record lives in the learner's browser, or in a folder they pick, and they can download or restore it at any time. ${PRIVACY_SESSION} The record isn't kept on a server unless they opt in to the relay below.`,
    );
  });

  it('off: the sentence is absent', () => {
    setFlags({ sessions: false });
    render(<Proposal />);
    expect(text()).not.toContain(PRIVACY_SESSION);
    expect(text()).toContain("at any time. The record isn't kept on a server unless they opt in to the relay below.");
  });

  it('senseiLearners replaces it with the session-and-Sensei-user sentence', () => {
    setFlags({ senseiLearners: true });
    render(<Proposal />);
    expect(text()).not.toContain(PRIVACY_SESSION);
    expect(text()).toContain('The server keeps a random session and an anonymous Sensei user with no name or email');
  });
});

describe('/proposal with the anonymous-accounts flag', () => {
  const flags = FEATURES as { senseiLearners: boolean };
  afterEach(() => {
    flags.senseiLearners = false;
  });

  it('ships off', () => {
    expect(flags.senseiLearners).toBe(false);
  });

  it('off: today\'s decision, privacy line and phase 2 heading, unchanged', () => {
    render(<Proposal />);
    const t = text();
    expect(t).toContain('A record the learner keeps, instead of accounts. No sign-up, and no personal data held.');
    expect(t).toContain('Phase 2: keep the record with a WordPress.org login');
    expect(t).not.toContain('An anonymous account, not a sign-up.');
    expect(t).not.toContain('anonymous Sensei user');
    expect(t).toContain("Progress stays in the learner's browser, so no accounts are needed. If the AI is down, the lessons read exactly as they do today.");
  });

  it('on: the anonymous-user decision, privacy line and phase 2 copy, verbatim', () => {
    flags.senseiLearners = true;
    render(<Proposal />);
    const t = text();
    expect(t).toContain(
      "An anonymous account, not a sign-up. Learners start with no form. The first recorded step creates a Sensei user with a random ID and no email, and the learner can delete it. The cost: the site now holds a server-side user for every learner who starts, which needs rate limits and a clean-up rule, and progress still doesn't follow a learner between devices unless they move the file. An optional \"keep my progress\" by email link is a possible next step, and isn't built.",
    );
    expect(t).not.toContain('instead of accounts');
    expect(t).not.toContain('no accounts are needed');
    expect(t).toContain('You get an anonymous account on the course server: a random id, no email and no password. Your progress record stays in your browser.');
    expect(t).not.toContain("Progress stays in the learner's browser");
    expect(t).toContain('If the AI is down, the lessons read exactly as they do today.');
    expect(t).toContain('The server keeps a random session and an anonymous Sensei user with no name or email, and the learner can delete both from the record menu.');
    expect(t).toContain('Phase 2: keep the record, with or without a login');
    expect(t).not.toContain('Phase 2: keep the record with a WordPress.org login');
    expect(t).toContain("In this concept the learner already has an anonymous account that Sensei tracks. What's still open is only the harder step, linking it to a WordPress.org login.");
    expect(t).not.toMatch(/\p{Extended_Pictographic}/u);
  });
});

describe('/proposal with the official-record flag', () => {
  const flags = FEATURES as { officialRecord: boolean; senseiLearners: boolean; wordpressContent: boolean };
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

  it('ships off', () => {
    expect(flags.officialRecord).toBe(false);
  });

  it('off: phases 2 and 3, privacy and decisions unchanged', () => {
    render(<Proposal />);
    const t = text();
    expect(t).toContain('Phase 2: keep the record with a WordPress.org login');
    expect(t).toContain('Phase 3: Sensei progress');
    expect(t).toContain('The record lives in the learner\'s browser, or in a folder they pick');
    expect(t).not.toContain('A separate record store.');
    expect(t).not.toContain(LRS_HOST);
    expect(t).not.toContain(`${RETENTION_DAYS} days`);
  });

  it('on: phases 2 and 3, privacy and the new decision, verbatim, with numbers from course-meta', () => {
    allOn();
    render(<Proposal />);
    const t = text();
    expect(t).toContain('Phase 2: the record in a store, not in the browser');
    expect(t).toContain('Phase 3: Sensei progress');
    expect(t).toContain("In this concept the learner's record is written by the course server to a separate learning record store, and read back into the studio.");
    expect(t).toContain('a record under an anonymous ID can\'t be rewritten, so linking it to a profile needs an agreed approach, such as a signed "linked" statement.');
    expect(t).toContain('with skipped lessons marked complete and recorded as "tested out". Sensei has no REST route for this, so the plugin calls Sensei\'s PHP from inside WordPress.');
    expect(t).not.toContain('Phase 2: keep the record');
    expect(t).not.toContain('Once a learner is signed in');
    expect(t).toContain('The official record is stored on our servers under a random ID, with no name or email. It includes the answers a learner types to checkpoints, in their own words, because the record, and later a badge, link to that evidence.');
    expect(t).toContain(`It is kept in a separate store at ${LRS_HOST}, owned by the same person, with no third-party analytics.`);
    expect(t).toContain(`A learner who is idle for ${RETENTION_DAYS} days is deleted.`);
    expect(t).toContain('A learner can download their record at any time and delete it at any time from the record menu. Deleting removes the statements, files, Sensei user and progress, and connected agents.');
    expect(t).not.toContain("The record lives in the learner's browser");
    expect(t).toContain('What a learner types to the AI is sent to the model provider to get a reply.');
    expect(t).toContain('A separate record store. The official record is kept apart from Sensei and from the learner.');
    expect(t).toContain('A daily check compares the two and reports any difference.');
    expect(t).not.toMatch(/\p{Extended_Pictographic}/u);
  });

  it('on: phase 1 stops saying the record stays in the browser, and the new sources are cited', () => {
    allOn();
    const { container } = render(<Proposal />);
    expect(text()).not.toContain('Your progress record stays in your browser.');
    const hrefs = Array.from(container.querySelectorAll('.prose__sources a')).map((a) => a.getAttribute('href'));
    expect(hrefs).toContain('https://github.com/derintolu/learning-ledger');
    expect(hrefs.some((h) => h!.endsWith('functions/_lib/lrs'))).toBe(true);
  });

  it('on with every earlier phase on: the browser-only decision and phase 1 line are gone', () => {
    allOn();
    render(<Proposal />);
    const t = text();
    expect(t).not.toContain('A record the learner keeps, instead of accounts');
    expect(t).not.toContain("Progress stays in the learner's browser");
    expect(t).not.toContain("The record lives in the learner's browser");
    expect(t).toContain('You get an anonymous account on the course server: a random id, no email and no password. If the AI is down');
  });

  it.each([
    ['wordpressContent', { officialRecord: true, senseiLearners: true, wordpressContent: false }],
    ['senseiLearners', { officialRecord: true, senseiLearners: false, wordpressContent: true }],
    ['both', { officialRecord: true, senseiLearners: false, wordpressContent: false }],
  ])('on with %s off: renders as the earlier phases say, with no phase 6 copy', (_n, set) => {
    const base = (() => {
      Object.assign(flags, { ...set, officialRecord: false });
      const r = render(<Proposal />);
      const x = text();
      r.unmount();
      return x;
    })();
    Object.assign(flags, set);
    render(<Proposal />);
    expect(text()).toBe(base);
    expect(text()).not.toContain(LRS_HOST);
  });
});

describe('/proposal final rewrite (phase 8)', () => {
  const flags = FEATURES as { officialRecord: boolean; senseiLearners: boolean; wordpressContent: boolean; badges: boolean; agentOnStandard: boolean };
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
    flags.agentOnStandard = false;
  });

  const REVOKED = 'Deleting your data revokes any badges you claimed, and a revoked badge stops verifying.';

  it.each([
    ['today', () => {}],
    ['every flag on', () => { allOn(); flags.agentOnStandard = true; }],
  ])('%s: every source listed is a file or folder that exists, and every Cite resolves to one', (_n, set) => {
    set();
    const { container } = render(<Proposal />);
    const items = Array.from(container.querySelectorAll('.prose__sources li'));
    expect(items.length).toBeGreaterThan(5);
    for (const li of items) {
      const file = li.querySelector('code')!.textContent!;
      if (!file.startsWith('https://')) expect(existsSync(file), file).toBe(true);
    }
    const ids = new Set(items.map((li) => li.id));
    for (const a of Array.from(container.querySelectorAll('a.prose__cite'))) expect(ids.has(a.getAttribute('href')!.slice(1)), a.textContent ?? '').toBe(true);
    expect(text()).not.toContain('vendor/learning-mcp');
    expect(text()).not.toContain('functions/_lib/mcp/recordStore.ts');
  });

  it('off: none of the phase 8 copy renders', () => {
    flags.officialRecord = true;
    setFlags({ lrsShadow: true });
    render(<Proposal />);
    const t = text();
    for (const s of ['no longer only proposed', 'A standard, so the course', 'A plugin, so Sensei', 'Why the record store is separate', 'revokes any badges', 'plain hosting']) expect(t).not.toContain(s);
  });

  it('on: phases 1 to 3 shown as running, the three new sections, and the revoked-badge sentence', () => {
    allOn();
    const { container } = render(<Proposal />);
    const t = text();
    expect(t).toContain('Phases 1 to 3 below are no longer only proposed: each is running in this concept, with a link to where you can see it.');
    expect(t).toContain('See it: start the placement chat, then read the same lesson on the backend view to see what Learn shows today.');
    expect(t).toContain('See it: open the record menu, then the record on the record store\'s own page.');
    expect(t).toContain("See it: finish a lesson, then open 'What Sensei sees'.");
    expect(t).toContain('A standard, so the course isn\'t tied to this site.');
    expect(t).toContain('The standard is by the same author as this concept and has not been reviewed outside it.');
    expect(t).toContain('A plugin, so Sensei doesn\'t change.');
    expect(t).toContain('Other LMS integrations are on its roadmap and aren\'t built. Nothing in Sensei is patched.');
    expect(t).toContain('Why the record store is separate.');
    expect(t).toContain('so that address has to stay registered.');
    expect(t).toContain('The record store, Sensei and the sign-in add no model cost; they are plain hosting.');
    expect(t).toContain(REVOKED);
    expect(t).toContain('not reviewed by the Training Team');
    const hrefs = Array.from(container.querySelectorAll('a')).map((a) => a.getAttribute('href'));
    expect(hrefs).toContain('https://course-xapi-mcp.sqwrlz.com/');
    expect(hrefs).toContain(BACKEND_VIEW_PATH);
    expect(Array.from(container.querySelectorAll('.prose__sources code')).map((c) => c.textContent)).toContain('vendor/course-xapi-mcp/');
    expect(t).not.toMatch(/\p{Extended_Pictographic}/u);
  });

  it('on with an earlier phase off: no phase 8 copy', () => {
    allOn();
    flags.officialRecord = false;
    render(<Proposal />);
    expect(text()).not.toContain('no longer only proposed');
    expect(text()).not.toContain(REVOKED);
  });

  it('agentOnStandard replaces the handle decision; off keeps it', () => {
    render(<Proposal />);
    expect(text()).toContain('The record handle is the only key to an agent record.');
    cleanup();
    flags.agentOnStandard = true;
    render(<Proposal />);
    const t = text();
    expect(t).not.toContain('The record handle is the only key to an agent record.');
    expect(t).toContain('Agents sign in, instead of holding a handle.');
    expect(t).toContain('We don\'t fall back to a secret handle.');
  });
});

describe('/proposal with the LRS shadow (phase 5)', () => {
  it('on: the approved sentence in Privacy, and no line that says the record is on no server', () => {
    phasesUpTo('lrsShadow');
    render(<Proposal />);
    const t = text();
    expect(t).toContain(SHADOW_COPY);
    expect(t).not.toContain("The record isn't kept on a server");
    expect(t).not.toContain('Your progress record stays in your browser.');
  });

  it('off: unchanged', () => {
    setFlags({ senseiLearners: true, wordpressContent: true });
    render(<Proposal />);
    const t = text();
    expect(t).not.toContain(SHADOW_COPY);
    expect(t).toContain("The record isn't kept on a server unless they opt in to the relay below.");
    expect(t).toContain('Your progress record stays in your browser.');
  });

  it('officialRecord on: the official Privacy list replaces it', () => {
    phasesUpTo('officialRecord');
    render(<Proposal />);
    expect(text()).not.toContain(SHADOW_COPY);
    expect(text()).toContain('The official record is stored on our servers under a random ID');
  });
});
