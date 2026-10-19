// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/preact';
import { Header } from '../../src/components/Header';
import { Footer } from '../../src/components/Footer';
import { CapNotice } from '../../src/components/CapNotice';
import { Bubble } from '../../src/components/Bubble';
import { Swipe } from '../../src/components/Swipe';
import { App } from '../../src/app';

vi.mock('../../src/ai/client', () => ({ getStatus: vi.fn(async () => ({ ai: 'off' })), placement: vi.fn() }));

afterEach(cleanup);

describe('Header', () => {
  it('renders the wordmark and the unofficial concept sticker', () => {
    render(<Header />);
    const home = screen.getByRole('link', { name: /Learn WordPress, reimagined/ });
    expect(home.getAttribute('href')).toBe('/');
    expect(screen.getByText('unofficial concept')).toBeTruthy();
  });
});

describe('Footer', () => {
  it('credits the author and disclaims affiliation', () => {
    const { container } = render(<Footer />);
    const text = container.textContent ?? '';
    expect(text).toContain('Concept and build by Derin Tolu');
    expect(text).toContain('Not affiliated with WordPress.org or the WordPress Foundation.');
    const hrefs = Array.from(container.querySelectorAll('a')).map((a) => a.getAttribute('href'));
    expect(hrefs).toContain('https://github.com/derintolu');
    expect(hrefs).toContain('mailto:hello@derintolu.com');
    expect(hrefs).toContain('https://github.com/derintolu/learn-wp-reimagined');
    expect(text).toContain('CC BY-SA 4.0');
    expect(text).toContain('GPL-2.0-or-later');
  });
});

describe('Branding', () => {
  it('has no image presented as the WordPress logo anywhere in the shell', () => {
    const { container } = render(<App />);
    const logos = Array.from(container.querySelectorAll('img')).filter((img) =>
      (img.getAttribute('alt') ?? '').toLowerCase().includes('wordpress logo'),
    );
    expect(logos).toHaveLength(0);
  });
});

describe('CapNotice', () => {
  it('hides "Continue in your own agent" while the agent feature is off, but keeps the message', () => {
    const { container } = render(<CapNotice state="capped" />);
    expect(screen.queryByRole('link', { name: 'Continue in your own agent' })).toBeNull();
    expect((container.textContent ?? '').length).toBeGreaterThan(20);
    expect(container.querySelector('[role="status"]')).toBeTruthy();
  });
});

describe('Bubble and Swipe', () => {
  it('marks who is speaking and keeps swiped words readable as text', () => {
    const { container } = render(
      <div>
        <Bubble from="learner">I want a portfolio</Bubble>
        <Bubble from="tutor">Nice. Block themes it is.</Bubble>
        <h1>
          Learn WordPress, <Swipe>your way</Swipe>.
        </h1>
      </div>,
    );
    expect(container.querySelector('.bubble--learner')?.textContent).toContain('I want a portfolio');
    expect(container.querySelector('.bubble--tutor')?.textContent).toContain('Block themes');
    expect(container.querySelector('h1')?.textContent).toBe('Learn WordPress, your way.');
    expect(container.querySelector('.swipe svg')?.getAttribute('aria-hidden')).toBe('true');
  });
});
