import { describe, expect, it } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import { buildContent } from '../../scripts/build-content';
import { applyEvent, newRecord, type LearningRecord, type RecordEvent } from '../../src/shared/record';
import { buildThemeFiles, resolveTheme, themeZip, THEME_SLUG } from '../../src/finale/themeZip';
import { PLAYGROUND_URL_LIMIT, playgroundBlueprint, playgroundUrl } from '../../src/finale/playground';

const c = buildContent('content');
const L = c.lessons;
const FINAL = c.paths['block-theme'].finalFiles!;

/** A record built by the real reducer, as the app would. */
const play = (...events: RecordEvent[]): LearningRecord => events.reduce((r, e) => applyEvent(r, e, c), newRecord());
const edit = (file: string, content: string, lessonId?: string): RecordEvent => ({ type: 'fileEdited', file, content, lessonId });
const done = (lessonId: string): RecordEvent => ({ type: 'lessonCompleted', lessonId });
const skipped = (lessonId: string, to: string): RecordEvent => ({ type: 'checkpointAnswered', lessonId, response: 'skip', outcome: 'skip', to });

const l1Fixed = L['bt-what-is-a-block-theme'].bug!.code.replace('"value"', '"color"');
/** What a learner who passes lesson 4's checkpoint writes. */
const l4Answer = JSON.stringify(
  {
    ...JSON.parse(L['bt-global-styles'].starterFiles!['theme.json']),
    styles: {
      color: { background: 'var:preset|color|base', text: 'var:preset|color|contrast' },
      elements: { link: { color: { text: 'var:preset|color|accent' } } },
    },
  },
  null,
  2,
);

describe('finalFiles (the finished reference theme)', () => {
  it('is a complete, styled theme by default', () => {
    const files = buildThemeFiles(c, newRecord());
    expect(Object.keys(files).sort()).toEqual(
      ['parts/footer.html', 'parts/header.html', 'patterns/hero.php', 'style.css', 'templates/index.html', 'theme.json'],
    );
    const tj = JSON.parse(files['theme.json']);
    expect(tj.version).toBe(3);
    expect(tj.settings.layout).toEqual({ contentSize: '40rem', wideSize: '64rem' });
    expect(tj.settings.useRootPaddingAwareAlignments).toBe(true);
    expect(tj.settings.typography.fontFamilies[0].fontFamily).toMatch(/system-ui|sans-serif/);
    expect(tj.styles.typography.fontFamily).toBe(`var:preset|font-family|${tj.settings.typography.fontFamilies[0].slug}`);
    expect(Object.keys(tj.styles.spacing.padding).sort()).toEqual(['bottom', 'left', 'right', 'top']);
    expect(tj.styles.color).toEqual({ background: 'var:preset|color|base', text: 'var:preset|color|contrast' });
    expect(tj.styles.elements.link.color.text).toBe('var:preset|color|accent');
    const index = files['templates/index.html'];
    expect(index).toMatch(/^<!-- wp:template-part \{"slug":"header"/);
    expect(index).toContain('<!-- wp:pattern {"slug":"my-block-theme/hero"} /-->');
    expect(index).toContain('<!-- wp:query ');
    expect(index).toContain('"slug":"footer"');
    expect(resolveTheme(c, newRecord()).used).toEqual([]);
  });
});

describe('resolveTheme (R25 merge rule)', () => {
  it('fixing the lesson 1 bug then skipping lessons 2 and 4 still ships the finished theme.json', () => {
    const r = play(
      edit('theme.json', l1Fixed, 'bt-what-is-a-block-theme'),
      done('bt-what-is-a-block-theme'),
      skipped('bt-style-css-and-theme-json', 'bt-templates-and-parts'),
      skipped('bt-templates-and-parts', 'bt-global-styles'),
      skipped('bt-global-styles', 'bt-patterns'),
    );
    expect(r.fileLessons).toEqual({ 'theme.json': 'bt-what-is-a-block-theme' });
    const t = resolveTheme(c, r);
    expect(t.files['theme.json']).toBe(FINAL['theme.json']);
    const tj = JSON.parse(t.files['theme.json']);
    expect(tj.settings.layout.contentSize).toBe('40rem');
    expect(tj.styles.typography.fontFamily).toBeTruthy();
    expect(t.used).toEqual([]);
    expect(t.replaced).toEqual([{ file: 'theme.json', message: expect.stringContaining('lesson 4') }]);
  });

  it('an unfixed planted bug falls back to the finished file', () => {
    const t = resolveTheme(c, play(edit('patterns/hero.php', L['bt-patterns'].bug!.code, 'bt-patterns')));
    expect(t.files['patterns/hero.php']).toBe(FINAL['patterns/hero.php']);
    expect(t.replaced[0].message).toBe("We used the finished version of patterns/hero.php because your copy didn't pass lesson 5's checks.");
  });

  it('invalid JSON falls back, even when the edit was made in the right lesson', () => {
    const t = resolveTheme(c, play(edit('theme.json', l4Answer.replace('"styles"', 'styles'), 'bt-global-styles')));
    expect(t.files['theme.json']).toBe(FINAL['theme.json']);
    expect(t.used).toEqual([]);
  });

  it("a valid theme.json made in lesson 4 is the learner's", () => {
    const t = resolveTheme(c, play(edit('theme.json', l4Answer, 'bt-global-styles')));
    expect(t.files['theme.json']).toBe(l4Answer);
    expect(t.used).toEqual(['theme.json']);
    expect(t.replaced).toEqual([]);
  });

  it('a lesson 3 index edit is checked against lesson 3', () => {
    const good = FINAL['templates/index.html'].replace('Nothing to show yet.', 'No posts yet.');
    expect(resolveTheme(c, play(edit('templates/index.html', good, 'bt-templates-and-parts'))).files['templates/index.html']).toBe(good);
    const noHeader = L['bt-templates-and-parts'].starterFiles!['templates/index.html'];
    expect(resolveTheme(c, play(edit('templates/index.html', noHeader, 'bt-templates-and-parts'))).files['templates/index.html']).toBe(
      FINAL['templates/index.html'],
    );
  });

  it('legacy edits with no lessonId count as the last owning lesson and must still pass', () => {
    expect(resolveTheme(c, play(edit('theme.json', l4Answer))).files['theme.json']).toBe(l4Answer);
    expect(resolveTheme(c, play(edit('theme.json', l1Fixed))).files['theme.json']).toBe(FINAL['theme.json']);
  });

  it('only includes files the block theme path owns', () => {
    const t = resolveTheme(c, play(edit('app.js', 'x'), edit('../evil.php', 'x'), edit('/etc/passwd', 'x')));
    expect(Object.keys(t.files).sort()).toEqual(Object.keys(FINAL).sort());
  });
});

describe('themeZip', () => {
  it('puts every file under my-block-theme/', () => {
    const files = buildThemeFiles(c, newRecord());
    const out = unzipSync(themeZip(files));
    expect(Object.keys(out)).toContain(`${THEME_SLUG}/style.css`);
    expect(Object.keys(out)).toContain(`${THEME_SLUG}/theme.json`);
    expect(Object.keys(out).every((k) => k.startsWith('my-block-theme/'))).toBe(true);
    expect(strFromU8(out['my-block-theme/patterns/hero.php'])).toBe(files['patterns/hero.php']);
  });
});

describe('playground blueprint', () => {
  const files = buildThemeFiles(c, newRecord());

  it('writes every file into the theme folder, then activates it', () => {
    const bp = playgroundBlueprint(files);
    expect(bp.landingPage).toBe('/');
    expect(bp.preferredVersions).toEqual({ wp: 'latest', php: '8.3' });
    const writes = bp.steps.filter((s) => s.step === 'writeFile');
    expect(writes.map((s) => s.path).sort()).toEqual(
      Object.keys(files).map((f) => `/wordpress/wp-content/themes/my-block-theme/${f}`).sort(),
    );
    for (const w of writes) expect(w.data).toBe(files[w.path!.replace('/wordpress/wp-content/themes/my-block-theme/', '')]);
    expect(bp.steps[bp.steps.length - 1]).toEqual({ step: 'activateTheme', themeFolderName: 'my-block-theme' });
    const mk = bp.steps.findIndex((s) => s.step === 'mkdir' && s.path === '/wordpress/wp-content/themes/my-block-theme/patterns');
    const wr = bp.steps.findIndex((s) => s.step === 'writeFile' && s.path?.endsWith('patterns/hero.php'));
    expect(mk).toBeGreaterThanOrEqual(0);
    expect(mk).toBeLessThan(wr);
  });

  it('encodes the blueprint in the URL fragment and round-trips', () => {
    const url = playgroundUrl(files);
    expect(url.startsWith('https://playground.wordpress.net/#')).toBe(true);
    expect(JSON.parse(decodeURIComponent(url.slice(url.indexOf('#') + 1)))).toEqual(playgroundBlueprint(files));
  });

  it('keeps a large realistic theme, using only files the path owns, under the URL limit', () => {
    expect(PLAYGROUND_URL_LIMIT).toBe(200_000);
    const longIndex = FINAL['templates/index.html'].replace('Nothing to show yet.', 'Nothing to show yet. '.repeat(40));
    const bigJson = JSON.stringify({ ...JSON.parse(l4Answer), settings: { ...JSON.parse(l4Answer).settings, custom: { notes: 'x'.repeat(4000) } } }, null, 2);
    const big = resolveTheme(
      c,
      play(
        edit('theme.json', bigJson, 'bt-global-styles'),
        edit('templates/index.html', longIndex, 'bt-templates-and-parts'),
        edit('parts/header.html', FINAL['parts/header.html'].repeat(3), 'bt-templates-and-parts'),
        edit('patterns/hero.php', FINAL['patterns/hero.php'] + '\n<!-- wp:paragraph --><p>More.</p><!-- /wp:paragraph -->\n'.repeat(30), 'bt-patterns'),
      ),
    );
    expect(big.used.sort()).toEqual(['parts/header.html', 'patterns/hero.php', 'templates/index.html', 'theme.json']);
    expect(playgroundUrl(big.files).length).toBeLessThan(PLAYGROUND_URL_LIMIT);
  });
});
