/**
 * The paths this app owns. `pattern` is the sf.jsonc rewrite source (Spacefast glob);
 * `rewrite` is the matching preact-iso route. Every other path falls through to WordPress.
 */
export const APP_ROUTES: readonly { pattern: string; rewrite: string }[] = [
  { pattern: '/', rewrite: '/' },
  { pattern: '/path/*', rewrite: '/path/:pathId' },
  { pattern: '/learn/*', rewrite: '/learn/:lessonId' },
  { pattern: '/finale', rewrite: '/finale' },
  { pattern: '/finale/*', rewrite: '/finale/:pathId' },
  { pattern: '/connect', rewrite: '/connect' },
  { pattern: '/how-it-works', rewrite: '/how-it-works' },
  { pattern: '/proposal', rewrite: '/proposal' },
  { pattern: '/blog', rewrite: '/blog' },
  { pattern: '/blog/*', rewrite: '/blog/:slug' },
  { pattern: '/backend/*', rewrite: '/backend/:pathId' },
  { pattern: '/backend/*', rewrite: '/backend/:pathId/:lessonId' },
];
