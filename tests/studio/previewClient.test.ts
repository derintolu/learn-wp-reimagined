// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { playgroundBlueprint, sitePagesPhp } from '../../src/finale/playground';
import { setPlaygroundImporter, startLivePreview } from '../../src/studio/previewClient';

function fake() {
  const calls: string[] = [];
  const client = {
    isReady: vi.fn(async () => {}),
    mkdir: vi.fn(async (p: string) => void calls.push(`mkdir ${p}`)),
    writeFile: vi.fn(async (p: string, d: string) => void calls.push(`write ${p} ${d}`)),
    run: vi.fn(async (o: { code: string }) => void calls.push(`run ${o.code}`)),
    goTo: vi.fn(async (p: string) => void calls.push(`goTo ${p}`)),
  };
  const startPlaygroundWeb = vi.fn(async (_o: unknown) => client);
  setPlaygroundImporter(async () => ({ startPlaygroundWeb }) as never);
  return { client, startPlaygroundWeb, calls };
}

afterEach(() => setPlaygroundImporter(null));

describe('writer targets the preview kind and lands on the lesson\'s page', () => {
  it('theme: writes under the theme folder and goes to the landing page', async () => {
    const { calls } = fake();
    const files = { 'style.css': 'a' };
    const p = await startLivePreview(document.createElement('iframe'), files, { kind: 'theme', slug: 'my-block-theme' }, '/sample-page/');
    await p.write({ 'parts/h.html': 'h' });
    expect(calls).toEqual([
      'mkdir /wordpress/wp-content/themes/my-block-theme/parts',
      'write /wordpress/wp-content/themes/my-block-theme/parts/h.html h',
      'goTo /sample-page/',
    ]);
  });

  it('plugin: boots on the known-good main file, then writes the workspace into the plugins folder', async () => {
    const { calls, startPlaygroundWeb } = fake();
    const MAIN = 'hello-learn/hello-learn.php';
    const known = { [MAIN]: '<?php /* Plugin Name: Hello */' };
    const files = { [MAIN]: '<?php syntax error', 'hello-learn/inc/a.php': '<?php // a' };
    const preview = { kind: 'plugin', slug: 'hello-learn' } as const;
    const p = await startLivePreview(document.createElement('iframe'), files, preview, '/wp-admin/', undefined, undefined, known);
    const opts = startPlaygroundWeb.mock.calls[0][0] as { blueprint: unknown };
    expect(opts.blueprint).toEqual(playgroundBlueprint(files, preview, { login: false, landing: '/wp-admin/', known }));
    expect(JSON.stringify(opts.blueprint)).not.toContain('syntax error');
    expect(calls).toEqual([
      `write /wordpress/wp-content/plugins/${MAIN} <?php syntax error`,
      'write /wordpress/wp-content/plugins/hello-learn/inc/a.php <?php // a',
      'goTo /wp-admin/',
    ]);
    calls.length = 0;
    await p.write({ 'hello-learn/new/b.php': 'b' });
    expect(calls).toEqual([
      'mkdir /wordpress/wp-content/plugins/hello-learn/new',
      'write /wordpress/wp-content/plugins/hello-learn/new/b.php b',
      'goTo /wp-admin/',
    ]);
  });

  it('site: writes pages under /tmp/learn-pages, re-runs the pages PHP, then goes to the landing page', async () => {
    const { calls, client } = fake();
    const files = { 'pages/home.html': 'home' };
    const p = await startLivePreview(document.createElement('iframe'), files, { kind: 'site' }, '/');
    await p.write({ 'pages/about.html': 'about' });
    expect(client.run).toHaveBeenCalledWith({ code: sitePagesPhp(['pages/about.html', 'pages/home.html']) });
    expect(calls).toEqual([
      'write /tmp/learn-pages/pages/about.html about',
      `run ${sitePagesPhp(['pages/about.html', 'pages/home.html'])}`,
      'goTo /',
    ]);
  });
});
