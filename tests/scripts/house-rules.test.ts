import { describe, expect, it } from 'vitest';
import { houseRules } from '../../scripts/house-rules';
import { buildContent } from '../../scripts/build-content';
import type { ContentBundle } from '../../src/shared/types';

const fixture = (): ContentBundle => structuredClone(buildContent('tests/fixtures/content'));

describe('houseRules', () => {
  it('the fixture and the real snapshot follow every rule', () => {
    expect(houseRules(fixture())).toEqual([]);
    expect(houseRules(buildContent())).toEqual([]);
  });

  it('a live path needs at least 2 checkpoints', () => {
    const b = fixture();
    delete b.lessons['templates-and-parts']!.checkpoint;
    expect(houseRules(b).join('\n')).toMatch(/path "block-theme" needs at least 2 checkpoints, found 1/);
  });

  it.each(['advance', 'review', 'skip'] as const)('a checkpoint needs a %s branch', (outcome) => {
    const b = fixture();
    const cp = b.lessons['theme-json-basics']!.checkpoint!;
    cp.branches = cp.branches.filter((br) => br.outcome !== outcome);
    expect(houseRules(b).join('\n')).toContain(`lesson "theme-json-basics" checkpoint "${cp.id}" is missing the ${outcome} branch`);
  });

  it('a live path needs a preview', () => {
    const b = fixture();
    delete b.paths.learner.preview;
    expect(houseRules(b).join('\n')).toContain('path "learner" needs a preview');
  });

  it('live paths may not share a file name', () => {
    const b = fixture();
    b.paths.learner.previewFiles = { ...b.paths.learner.previewFiles, 'style.css': '/* x */' };
    expect(houseRules(b).join('\n')).toMatch(/file "style\.css" is owned by both "(learner|block-theme)" and "(block-theme|learner)"/);
  });

  it('finalFiles must pass every lesson check', () => {
    const b = fixture();
    b.paths['block-theme'].finalFiles!['theme.json'] = '{ "version": 2 }';
    expect(houseRules(b).join('\n')).toMatch(/path "block-theme" finalFiles theme\.json fails a check in lesson/);
  });

  it('finalFiles must pass a planted bug fix check', () => {
    const b = fixture();
    b.paths['block-theme'].finalFiles!['patterns/hero.php'] = '<?php\n/**\n * Slug: hero\n */\n';
    expect(houseRules(b).join('\n')).toMatch(/finalFiles patterns\/hero\.php fails a check in lesson "patterns"/);
  });

  it('a theme preview needs style.css and templates/index.html', () => {
    for (const f of ['style.css', 'templates/index.html']) {
      const b = fixture();
      delete b.paths['block-theme'].previewFiles![f];
      expect(houseRules(b).join('\n')).toContain(`path "block-theme" previewFiles must include ${f}`);
    }
  });

  it('a plugin preview needs <slug>/<slug>.php with a Plugin Name header, and every file under <slug>/', () => {
    const b = fixture();
    const pf = b.paths['vibe-coder'].previewFiles!;
    pf['my-first-plugin/my-first-plugin.php'] = '<?php\n';
    expect(houseRules(b).join('\n')).toContain('my-first-plugin/my-first-plugin.php needs a Plugin Name header');
    delete pf['my-first-plugin/my-first-plugin.php'];
    expect(houseRules(b).join('\n')).toContain('previewFiles must include my-first-plugin/my-first-plugin.php');
    const c = fixture();
    c.paths['vibe-coder'].previewFiles!['stray.php'] = '<?php\n';
    expect(houseRules(c).join('\n')).toContain('plugin file "stray.php" must live under my-first-plugin/');
  });

  it('a site preview names its files pages/<slug>.html', () => {
    const b = fixture();
    b.paths.learner.previewFiles!['about.html'] = '<p>x</p>';
    expect(houseRules(b).join('\n')).toContain('site file "about.html" must be named pages/<slug>.html');
  });

  it('every lesson needs at least one source', () => {
    const b = fixture();
    b.lessons['patterns']!.sources = [];
    expect(houseRules(b).join('\n')).toContain('lesson "patterns" needs at least one source');
  });

  it('a path that is not live is exempt from the path rules', () => {
    const b = fixture();
    b.paths.learner.status = 'coming-soon';
    delete b.paths.learner.preview;
    b.paths.learner.lessons = [];
    for (const id of ['ln-what-is-wordpress', 'ln-posts-and-pages']) delete b.lessons[id];
    expect(houseRules(b)).toEqual([]);
  });
});
