// Assembles the publish directory for `sf publish dist`.
//
// Layout (Spacefast docs, checked 2026-10-19):
//  - https://spacefast.com/docs/functions: a `functions/` directory with at least one route module is
//    detected as a file router; a filename is its route, `.js` modules are accepted, and names that
//    start with `_` are never routed.
//  - https://spacefast.com/docs/frameworks: build yourself and publish the output directory.
//  - https://spacefast.com/docs/config-file: `sf.jsonc` lives at the root of the published directory.
// We publish `dist/`, which has no node_modules, so each route is pre-bundled into one self-contained
// ESM file at `dist/functions/api/**.js`.
import { execFileSync } from 'node:child_process';
import { copyFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build as esbuild } from 'esbuild';
import { build as viteBuild } from 'vite';
import { packCliPlugin, packTheme } from './pack-theme.ts';
import { zipWpPlugin } from './zip-wp-plugin.ts';
import { vendorShimsEsbuild } from './vendor-shims.ts';

export const BUNDLE_LIMIT = 8 * 1024 * 1024; // Spacefast compiled bundle limit (docs/functions#limits)

const ROUTE_EXT = /\.(ts|tsx|js|mjs)$/;

/** Route modules under `dir`, relative paths with `/`. Skips `_`/`.` helpers, `.d.ts` and tests. */
export function routeModules(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const name of readdirSync(d).sort()) {
      if (name.startsWith('_') || name.startsWith('.')) continue;
      const full = join(d, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (ROUTE_EXT.test(name) && !name.endsWith('.d.ts') && !/\.(test|spec)\./.test(name)) {
        out.push(relative(dir, full).split(sep).join('/'));
      }
    }
  };
  walk(dir);
  return out;
}

/** Bundles every route in `srcDir` (e.g. functions/api) to `outDir`, one self-contained .js each. */
export async function bundleFunctions(srcDir: string, outDir: string): Promise<string[]> {
  const routes = routeModules(srcDir);
  const written: string[] = [];
  for (const rel of routes) {
    const outfile = join(outDir, rel.replace(ROUTE_EXT, '.js'));
    await esbuild({
      entryPoints: [join(srcDir, rel)],
      outfile,
      bundle: true,
      format: 'esm',
      platform: 'neutral',
      // platform 'neutral' sets no mainFields, so an npm dependency without `exports` would not resolve.
      mainFields: ['module', 'main'],
      // The MCP SDK's `_shims` export resolves to a Node shim (node:process, Ajv) without these; its
      // workerd build uses web APIs only. Only packages that publish these conditions are affected.
      conditions: ['workerd', 'worker', 'browser'],
      target: 'es2022',
      external: [],
      // The vendored course-xapi-mcp server's Node built-ins resolve to web shims (scripts/vendor-shims.ts).
      plugins: [vendorShimsEsbuild()],
      logLevel: 'warning',
    });
    const size = statSync(outfile).size;
    if (size > BUNDLE_LIMIT) throw new Error(`${outfile} is ${size} bytes, over the 8 MiB limit`);
    written.push(outfile);
  }
  return written;
}

/** Every `.env*` file under `dir`, at any depth. */
export function envFilesIn(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      const full = join(d, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (name.startsWith('.env')) out.push(relative(dir, full).split(sep).join('/'));
    }
  };
  walk(dir);
  return out;
}

/** Throws if the publish directory holds any `.env*` file: secrets must never be uploaded. */
export function assertNoEnvFiles(dir: string): void {
  const found = envFilesIn(dir);
  if (found.length) throw new Error(`refusing to publish: ${dir} contains ${found.join(', ')}`);
}

export async function assemble(root: string): Promise<void> {
  execFileSync(process.execPath, ['--import', 'tsx', join(root, 'scripts/build-content.ts')], {
    cwd: root,
    stdio: 'inherit',
  });
  // The MCP connector converts the content at runtime; fail the build here if it no longer fits learning-mcp
  // or no longer loads as a course-xapi-mcp package.
  // Imported late: the converter reads src/generated/content.json, which the step above just wrote.
  const { buildContent } = await import('./build-content.ts');
  const { buildCourse } = await import('../functions/_lib/mcp/course.ts');
  buildCourse(buildContent(join(root, 'content/snapshot')));
  // And as the course-xapi-mcp package the standard's server loads (SERVER_FLAGS.mcpOnStandard).
  const { buildStandardCourse } = await import('../functions/_lib/mcp/standardCourse.ts');
  buildStandardCourse(buildContent(join(root, 'content/snapshot')));
  await viteBuild({ root, logLevel: 'warn' });
  const dist = join(root, 'dist');
  rmSync(join(dist, 'functions'), { recursive: true, force: true });
  const files = await bundleFunctions(join(root, 'functions/api'), join(dist, 'functions/api'));
  copyFileSync(join(root, 'sf.jsonc'), join(dist, 'sf.jsonc'));
  // The blog's block theme, served as a file so the space's WordPress can install it by URL.
  console.log(`theme: ${relative(root, packTheme(join(root, 'wordpress/theme'), join(dist, 'theme')))}`);
  // `wp lwr-blog put`, installed by URL the same way, so posts longer than one WP-CLI argument fit.
  console.log(`plugin: ${relative(root, packCliPlugin(join(root, 'wordpress/mu-plugins/lwr-blog-cli.php'), join(dist, 'plugin')))}`);
  // Our WordPress plugins, zipped and served as files so the space's WordPress can install them by URL.
  const zips = zipWpPlugin(join(root, 'wordpress/lwr-backend-view'), join(root, 'dist/wp-zips'));
  console.log(`wp-zip: ${relative(root, zips)}`);
  assertNoEnvFiles(dist);
  for (const f of files) console.log(`function: ${relative(root, f)} (${statSync(f).size} bytes)`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await assemble(process.cwd());
}
