import { THEME_SLUG } from './themeZip';

/**
 * Playground has no documented fragment limit, and a fragment never reaches a server.
 * Chrome caps URLs at 2 MB; this is our own, generous budget. Past it, the finale
 * offers the zip instead.
 */
export const PLAYGROUND_URL_LIMIT = 200_000;

const THEME_DIR = `/wordpress/wp-content/themes/${THEME_SLUG}`;

export interface BlueprintStep {
  step: 'mkdir' | 'writeFile' | 'activateTheme';
  path?: string;
  data?: string;
  themeFolderName?: string;
}

export interface Blueprint {
  $schema: string;
  landingPage: string;
  preferredVersions: { wp: string; php: string };
  login: boolean;
  steps: BlueprintStep[];
}

/** Blueprint (developer.wordpress.org/playground/blueprints): write the theme, then activate it. */
export function playgroundBlueprint(files: Record<string, string>): Blueprint {
  const paths = Object.keys(files).sort();
  const dirs = new Set<string>([THEME_DIR]);
  for (const p of paths) {
    const parts = p.split('/').slice(0, -1);
    for (let i = 1; i <= parts.length; i++) dirs.add(`${THEME_DIR}/${parts.slice(0, i).join('/')}`);
  }
  return {
    $schema: 'https://playground.wordpress.net/blueprint-schema.json',
    landingPage: '/',
    preferredVersions: { wp: 'latest', php: '8.3' },
    login: true,
    steps: [
      ...[...dirs].sort().map((path): BlueprintStep => ({ step: 'mkdir', path })),
      ...paths.map((p): BlueprintStep => ({ step: 'writeFile', path: `${THEME_DIR}/${p}`, data: files[p] })),
      { step: 'activateTheme', themeFolderName: THEME_SLUG },
    ],
  };
}

/** The blueprint as minified, URI-encoded JSON in the fragment, as the Playground docs show. */
export function playgroundUrl(files: Record<string, string>): string {
  return `https://playground.wordpress.net/#${encodeURIComponent(JSON.stringify(playgroundBlueprint(files)))}`;
}
