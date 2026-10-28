// @vitest-environment happy-dom
// Home and How it works describe sign-in when the agent asks with agentOnStandard on, and handles with it off.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/preact';

const flags = vi.hoisted(() => ({ agent: true, serverEvents: true, sessions: true, wordpressContent: false, senseiLearners: false, agentOnStandard: false, officialRecord: false }));
vi.mock('../../src/config', () => ({ FEATURES: flags, phaseOn: () => false, REPO_URL: 'https://github.com/derintolu/learn-wp-reimagined' }));

import { Home } from '../../src/pages/Home';
import { HowItWorks } from '../../src/pages/HowItWorks';

afterEach(() => {
  cleanup();
  flags.agentOnStandard = false;
});
const body = (c: HTMLElement) => (c.textContent ?? '').replace(/\s+/g, ' ');

describe('Home', () => {
  it('flag off keeps the handle copy', () => {
    const { container } = render(<Home />);
    expect(body(container)).toMatch(/with no sign-in/);
    expect(body(container)).toMatch(/record handle/);
    expect(container.querySelector('a[href="/connect#import"]')).not.toBeNull();
  });
  it('flag on says sign in when your agent asks, with no handle or import link', () => {
    flags.agentOnStandard = true;
    const { container } = render(<Home />);
    expect(body(container)).toMatch(/sign in when your agent asks/i);
    expect(body(container)).not.toMatch(/paste your record|random record handle|with no sign.?in/i);
    expect(container.querySelector('a[href="/connect#import"]')).toBeNull();
  });
});

describe('How it works', () => {
  it('flag off keeps the handle copy', () => {
    const { container } = render(<HowItWorks />);
    expect(body(container)).toMatch(/Today there's no sign-in, and you give your AI a record handle/);
  });
  it('flag on says sign in when your agent asks', () => {
    flags.agentOnStandard = true;
    const { container } = render(<HowItWorks />);
    expect(body(container)).toMatch(/You sign in when your agent asks/);
    expect(body(container)).not.toMatch(/there's no sign-in|give your AI a record handle/);
  });
});
