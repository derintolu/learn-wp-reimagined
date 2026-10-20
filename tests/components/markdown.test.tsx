// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/preact';
import { Markdown } from '../../src/components/Markdown';

afterEach(cleanup);

describe('Markdown', () => {
  it('renders inline code, emphasis, lists and fenced code', () => {
    const { container } = render(
      <Markdown text={'Use `theme.json` for **presets** and *styles*.\n\n- one\n- two\n\n```json\n{ "version": 3 }\n```'} />,
    );
    expect(container.querySelector('code')?.textContent).toBe('theme.json');
    expect(container.querySelector('strong')?.textContent).toBe('presets');
    expect(container.querySelector('em')?.textContent).toBe('styles');
    expect(container.querySelectorAll('li')).toHaveLength(2);
    expect(container.querySelector('pre code')?.textContent).toBe('{ "version": 3 }');
  });

  it('never turns text into markup', () => {
    const { container } = render(<Markdown text={'<img src=x onerror="alert(1)"> <script>alert(1)</script>'} />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('script')).toBeNull();
    expect(container.textContent).toContain('<img src=x');
  });

  it('links only safe URLs, and autolinks bare https URLs without trailing punctuation', () => {
    const { container } = render(
      <Markdown text={'[ok](https://developer.wordpress.org/themes/) [bad](javascript:alert(1)) See https://learn.wordpress.org/lesson/x.'} />,
    );
    const links = [...container.querySelectorAll('a')].map((a) => a.getAttribute('href'));
    expect(links).toEqual(['https://developer.wordpress.org/themes/', 'https://learn.wordpress.org/lesson/x']);
    expect(container.textContent).toContain('bad');
  });

  it('starts markdown headings below the page headings', () => {
    const { container } = render(<Markdown text={'# Big'} />);
    expect(container.querySelector('h1')).toBeNull();
    expect(container.querySelector('h3')?.textContent).toBe('Big');
  });
});
