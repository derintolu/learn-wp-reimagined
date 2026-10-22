import type { ContentBundle, Lesson } from '../../src/shared/types';

export const PLUGIN_FILE = 'my-first-plugin/my-first-plugin.php';
export const PLUGIN_SOURCE = '<?php\n/* Plugin Name: My First Plugin */\n';
export const PAGE_FILE = 'pages/home.html';
export const PAGE_SOURCE = '<!-- wp:paragraph --><p>Hello</p><!-- /wp:paragraph -->';

const lesson = (id: string, pathId: Lesson['pathId'], title: string, file: string, text: string): Lesson => ({
  id,
  pathId,
  title,
  minutes: 5,
  sources: [{ title: 'Source', url: 'https://example.com' }],
  beats: [{ id: 'b', goal: 'Goal', content: 'Content' }],
  starterFiles: { [file]: text },
});

/**
 * A copy of `c` where the Learner (site) and Vibe coder (plugin) paths are live with one lesson each.
 * Neither is live in real content yet, so their finales are tested against this.
 */
export function liveFixturePaths(c: ContentBundle): ContentBundle {
  return {
    paths: {
      ...c.paths,
      learner: {
        ...c.paths.learner,
        status: 'live',
        lessons: ['ln-first-page'],
        preview: { kind: 'site' },
        finalFiles: { [PAGE_FILE]: PAGE_SOURCE },
      },
      'vibe-coder': {
        ...c.paths['vibe-coder'],
        status: 'live',
        lessons: ['vc-first-plugin'],
        preview: { kind: 'plugin', slug: 'my-first-plugin' },
        finalFiles: { [PLUGIN_FILE]: PLUGIN_SOURCE },
      },
    },
    lessons: {
      ...c.lessons,
      'ln-first-page': lesson('ln-first-page', 'learner', 'Your first page', PAGE_FILE, PAGE_SOURCE),
      'vc-first-plugin': lesson('vc-first-plugin', 'vibe-coder', 'Your first plugin', PLUGIN_FILE, PLUGIN_SOURCE),
    },
  };
}

/** Make the live fixture paths live in the (mocked) content module, in place; returns a restore function. */
export function makeLive(target: ContentBundle): () => void {
  const before = { paths: { ...target.paths }, lessons: { ...target.lessons } };
  const live = liveFixturePaths(target);
  Object.assign(target.paths, live.paths);
  Object.assign(target.lessons, live.lessons);
  return () => {
    for (const k of Object.keys(target.paths)) delete (target.paths as Record<string, unknown>)[k];
    for (const k of Object.keys(target.lessons)) delete target.lessons[k];
    Object.assign(target.paths, before.paths);
    Object.assign(target.lessons, before.lessons);
  };
}
