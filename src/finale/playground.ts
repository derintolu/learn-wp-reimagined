import type { Preview } from '../shared/types';

/**
 * Playground has no documented fragment limit, and a fragment never reaches a server.
 * Chrome caps URLs at 2 MB; this is our own, generous budget. Past it, the finale
 * offers the zip instead.
 */
export const PLAYGROUND_URL_LIMIT = 200_000;

/** Where the site kind's page files are written, for the pages PHP to read. */
const PAGES_DIR = '/tmp/learn-pages';
const PAGE_FILE = /^pages\/([a-z0-9-]+)\.html$/;

export interface BlueprintStep {
  step: 'mkdir' | 'writeFile' | 'activateTheme' | 'activatePlugin' | 'runPHP';
  path?: string;
  data?: string;
  themeFolderName?: string;
  pluginPath?: string;
  code?: string;
}

export interface Blueprint {
  $schema: string;
  landingPage: string;
  preferredVersions: { wp: string; php: string };
  login: boolean;
  steps: BlueprintStep[];
}

/**
 * The folder a path's files live under in Playground. Plugin file names already
 * carry `<slug>/`, so the plugin target is the plugins folder itself.
 */
export function previewTarget(preview: Preview): string {
  if (preview.kind === 'theme') return `/wordpress/wp-content/themes/${preview.slug}`;
  if (preview.kind === 'plugin') return '/wordpress/wp-content/plugins';
  return PAGES_DIR;
}

/** The page file names among `files`, sorted. */
export function pageNames(files: Record<string, string>): string[] {
  return Object.keys(files).filter((f) => PAGE_FILE.test(f)).sort();
}

/**
 * PHP (for a runPHP step or client.run) that upserts one published page per file name, by slug,
 * reading each page's markup from PAGES_DIR with file_get_contents. Built from the names only: page
 * text never enters the code. If pages/home.html is among them, it becomes the static front page.
 */
export function sitePagesPhp(names: string[]): string {
  const slugs = names.map((n) => {
    const m = PAGE_FILE.exec(n);
    if (!m) throw new Error(`Not a page file: ${n}`);
    return m[1];
  });
  const list = slugs.map((s) => `'${s}'`).join(', ');
  const front = slugs.includes('home')
    ? `
	if ( 'home' === $learn_slug ) {
		update_option( 'show_on_front', 'page' );
		update_option( 'page_on_front', $learn_id );
	}`
    : '';
  return `<?php
require_once '/wordpress/wp-load.php';
kses_remove_filters();
foreach ( array( ${list} ) as $learn_slug ) {
	$learn_file = '${PAGES_DIR}/pages/' . $learn_slug . '.html';
	if ( ! file_exists( $learn_file ) ) {
		continue;
	}
	$learn_post = array(
		'post_type'    => 'page',
		'post_status'  => 'publish',
		'post_name'    => $learn_slug,
		'post_title'   => ucwords( str_replace( '-', ' ', $learn_slug ) ),
		'post_content' => wp_slash( file_get_contents( $learn_file ) ),
	);
	$learn_page = get_page_by_path( $learn_slug, OBJECT, 'page' );
	if ( $learn_page ) {
		$learn_post['ID'] = $learn_page->ID;
		$learn_id = wp_update_post( $learn_post );
	} else {
		$learn_id = wp_insert_post( $learn_post );
	}${front}
}
`;
}

/** Folders to create for `paths` under `base`, parents first. The plugins folder already exists. */
function dirsUnder(base: string, paths: string[], withBase: boolean): string[] {
  const dirs = new Set<string>(withBase ? [base] : []);
  for (const p of paths) {
    const parts = p.split('/').slice(0, -1);
    for (let i = 1; i <= parts.length; i++) dirs.add(`${base}/${parts.slice(0, i).join('/')}`);
  }
  return [...dirs].sort();
}

/**
 * Blueprint (developer.wordpress.org/playground/blueprints): write the files under the preview's
 * target, then activate the theme, activate the plugin, or build the pages.
 * A plugin boots on `opts.known`'s main file (the path's previewFiles), so a broken edit can't stop
 * activation; the live preview writes the learner's files once it has booted.
 */
export function playgroundBlueprint(
  files: Record<string, string>,
  preview: Preview,
  opts: { login?: boolean; landing?: string; known?: Record<string, string> } = {},
): Blueprint {
  const base = previewTarget(preview);
  const boot = { ...files };
  let last: BlueprintStep[];
  if (preview.kind === 'theme') {
    last = [{ step: 'activateTheme', themeFolderName: preview.slug }];
  } else if (preview.kind === 'plugin') {
    const main = `${preview.slug}/${preview.slug}.php`;
    if (opts.known && Object.prototype.hasOwnProperty.call(opts.known, main)) boot[main] = opts.known[main];
    last = [{ step: 'activatePlugin', pluginPath: main }];
  } else {
    last = [{ step: 'runPHP', code: sitePagesPhp(pageNames(boot)) }];
  }
  const paths = Object.keys(boot).sort();
  return {
    $schema: 'https://playground.wordpress.net/blueprint-schema.json',
    landingPage: opts.landing ?? '/',
    preferredVersions: { wp: 'latest', php: '8.3' },
    login: opts.login ?? true,
    steps: [
      ...dirsUnder(base, paths, preview.kind !== 'plugin').map((path): BlueprintStep => ({ step: 'mkdir', path })),
      ...paths.map((p): BlueprintStep => ({ step: 'writeFile', path: `${base}/${p}`, data: boot[p] })),
      ...last,
    ],
  };
}

/** The blueprint as minified, URI-encoded JSON in the fragment, as the Playground docs show. */
export function playgroundUrl(files: Record<string, string>, preview: Preview): string {
  return `https://playground.wordpress.net/#${encodeURIComponent(JSON.stringify(playgroundBlueprint(files, preview)))}`;
}
