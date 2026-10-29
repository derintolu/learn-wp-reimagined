// @vitest-environment happy-dom
// Home and How it works describe sign-in when the agent asks, with no record handle.
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/preact';
import { Home } from '../../src/pages/Home';
import { HowItWorks } from '../../src/pages/HowItWorks';

afterEach(cleanup);
const body = (c: Element) => (c.textContent ?? '').replace(/\s+/g, ' ');

describe('Home', () => {
  it('says sign in when your agent asks, with no handle or import link', () => {
    const { container } = render(<Home />);
    expect(body(container)).toMatch(/sign in when your agent asks/i);
    expect(body(container)).not.toMatch(/paste your record|random record handle|with no sign.?in/i);
    expect(container.querySelector('a[href="/connect#import"]')).toBeNull();
  });
  it('does not promise the files in the AI', () => {
    const t = body(render(<Home />).container);
    expect(t).toContain('Your AI picks up at that lesson.');
    expect(t).not.toContain('with your files');
  });
});

describe('How it works', () => {
  it('says sign in when your agent asks', () => {
    const { container } = render(<HowItWorks />);
    expect(body(container)).toMatch(/You sign in when your agent asks/);
    expect(body(container)).not.toMatch(/there's no sign-in|give your AI a record handle/);
  });
});
