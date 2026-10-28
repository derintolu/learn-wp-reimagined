// @vitest-environment happy-dom
// Deferred 22b: Sensei's HTML is shown on the app's own origin, where a relative link to a WordPress page lands on
// the app's NotFound. Only /wp-content/ is served by WordPress here, so other relative URLs are dropped.
import { describe, expect, it } from 'vitest';
import { sanitizeHtml } from '../../src/backend/sanitize';

describe('sanitizeHtml relative URLs', () => {
  it('keeps absolute links, mailto, fragments and /wp-content/ files', () => {
    const out = sanitizeHtml(
      '<a href="https://learn.wordpress.org/x">a</a><a href="mailto:x@y.z">b</a><a href="#part">c</a><a href="/wp-content/uploads/f.pdf">d</a><img src="/wp-content/uploads/i.png" alt="i"><img src="https://w.org/i.png" alt="j">',
    );
    expect(out).toContain('href="https://learn.wordpress.org/x"');
    expect(out).toContain('href="mailto:x@y.z"');
    expect(out).toContain('href="#part"');
    expect(out).toContain('href="/wp-content/uploads/f.pdf"');
    expect(out).toContain('src="/wp-content/uploads/i.png"');
    expect(out).toContain('src="https://w.org/i.png"');
  });

  it('drops a relative link to a WordPress page but keeps its text', () => {
    const out = sanitizeHtml('<p>See <a href="/lesson/other/">the other lesson</a> and <a href="../x">this</a>.</p>');
    expect(out).not.toContain('href=');
    expect(out).toContain('the other lesson');
    expect(out).toContain('this');
  });

  it('drops an image with a relative src outside /wp-content/', () => {
    expect(sanitizeHtml('<p>x<img src="/wp-includes/i.png" alt="i"><img src="i.png" alt="j"></p>')).not.toContain('<img');
  });
});
