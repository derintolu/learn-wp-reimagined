// @vitest-environment happy-dom
// @vitest-environment-options {"settings": {"enableIframePageLoading": true}}
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/preact';
import { Header } from '../../src/components/Header';
import { Footer } from '../../src/components/Footer';
import { CapNotice } from '../../src/components/CapNotice';
import { Bubble } from '../../src/components/Bubble';
import { Swipe } from '../../src/components/Swipe';
import { App } from '../../src/app';
import { setRecordManager } from '../../src/record/useRecord';
import { setPlaygroundImporter } from '../../src/studio/previewClient';
import { content } from '../../src/content';
import { memoryManager } from './helpers';

vi.mock('../../src/ai/client', () => ({ getStatus: vi.fn(async () => ({ ai: 'off' })), placement: vi.fn() }));

afterEach(() => {
  cleanup();
  setRecordManager(null);
  setPlaygroundImporter(null);
  history.replaceState(null, '', '/');
});

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
    // JSX drops the line break before the link, so the space must be explicit.
    const licence = Array.from(container.querySelectorAll('p')).find((p) => p.textContent?.includes('CC BY-SA'))!;
    expect(licence.textContent).toContain('Lesson content is CC BY-SA 4.0. Code is GPL-2.0-or-later.');
    expect(licence.textContent).not.toContain('isCC');
    expect(text).toContain('GPL-2.0-or-later');
    expect(screen.getByRole('link', { name: 'CC BY-SA 4.0' }).getAttribute('href')).toBe('https://creativecommons.org/licenses/by-sa/4.0/');
    expect(screen.getByRole('link', { name: 'GPL-2.0-or-later' }).getAttribute('href')).toBe('https://www.gnu.org/licenses/old-licenses/gpl-2.0.html');
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

describe('Course bar', () => {
  it('replaces the header on a lesson: wordmark home, the sticker, no WordPress logo, no footer', async () => {
    setPlaygroundImporter(() => Promise.reject(new Error('no Playground in tests')));
    setRecordManager(memoryManager(content));
    history.replaceState(null, '', '/learn/bt-what-is-a-block-theme');
    const { container } = render(<App />);
    await screen.findByRole('heading', { level: 1 });
    const bar = container.querySelector('header.course-bar') as HTMLElement;
    expect(within(bar).getByRole('link', { name: /Learn WordPress, reimagined/ }).getAttribute('href')).toBe('/');
    expect(within(bar).getByText('unofficial concept')).toBeTruthy();
    expect(container.querySelectorAll('img').length).toBe(0);
    expect(container.querySelector('.site-header')).toBeNull();
    expect(container.querySelector('footer')).toBeNull();
    expect(screen.getByRole('link', { name: 'Skip to content' }).getAttribute('href')).toBe('#feed');
  });
});

describe('CapNotice', () => {
  it('offers "Continue in your own agent", linking to /connect, and keeps the message', () => {
    const { container } = render(<CapNotice status={{ ai: 'capped', reason: 'day-cap' }} />);
    expect(screen.getByRole('link', { name: 'Continue in your own agent' }).getAttribute('href')).toBe('/connect');
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
