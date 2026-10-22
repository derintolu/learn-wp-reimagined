// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { cleanup, render, screen } from '@testing-library/preact';
import { Proposal } from '../../src/pages/Proposal';
import { REPO_URL } from '../../src/config';
import { COST_PER_1000_LEARNERS_USD } from '../../src/shared/course-meta';
import { REVIEW_DISCLAIMER } from '../../src/studio/Feed';
import { DAY_CAP_MICROS, MONTH_CAP_MICROS } from '../../functions/_lib/budget';
import { MCP_TTL_MS } from '../../functions/_lib/mcp/recordStore';

afterEach(cleanup);

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
    for (const f of ['docs/model-eval.md', 'functions/_lib/budget.ts', 'docs/record-format.md', 'functions/_lib/mcp/recordStore.ts', 'scripts/build-content.ts']) {
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

  it('has no emoji and no sales language', () => {
    render(<Proposal />);
    const t = text();
    expect(t).not.toMatch(/\p{Extended_Pictographic}/u);
    expect(t).not.toMatch(/revolutionary|game.?chang|cutting.?edge|seamless|best-in-class|world-class|unlock|supercharge/i);
  });
});
