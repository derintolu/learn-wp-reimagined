// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { cleanup, render, screen } from '@testing-library/preact';
import { HowItWorks } from '../../src/pages/HowItWorks';
import { REPO_URL } from '../../src/config';
import { COST_PER_1000_LEARNERS_USD } from '../../src/shared/course-meta';
import { REVIEW_DISCLAIMER } from '../../src/studio/Feed';
import { ROUTES } from '../../functions/_lib/config';
import { DAY_CAP_MICROS, MONTH_CAP_MICROS } from '../../functions/_lib/budget';
import { MCP_LIMITS } from '../../functions/_lib/mcp/gate';
import { MCP_TTL_MS } from '../../functions/_lib/mcp/recordStore';

afterEach(cleanup);

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
    expect(t).toContain(`placement got ${last[1]} of ${last[2]} test conversations`);
    for (const f of ['docs/content-accuracy.md', 'docs/content-accuracy-learner.md', 'docs/content-accuracy-vibe-coder.md', 'content/paths/', 'docs/model-eval.md', 'functions/_lib/budget.ts', 'functions/_lib/mcp/gate.ts', 'functions/_lib/config.ts', 'docs/record-format.md']) {
      expect(t).toContain(f);
    }
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
