// Assembles the publish directory for `sf publish dist`.
//
// Layout (Spacefast docs, checked 2026-10-19):
//  - https://spacefast.com/docs/functions: a `functions/` directory with at least one route module is
//    detected as a file router; a filename is its route, `.js` modules are accepted, and names that
//    start with `_` are never routed.
//  - https://spacefast.com/docs/frameworks: build yourself and publish the output directory.
//  - https://spacefast.com/docs/config-file: `sf.jsonc` lives at the root of the published directory.
// We publish `dist/`, which has no node_modules, so the routes are pre-bundled to ESM at
// `dist/functions/api/**.js`, with the code they share split into `dist/functions/api/_chunks/`.
//
// How Spacefast compiles them (sf CLI 0.5.0, `sf publish`, src/functions-bundle.ts, read 2026-10-28): it
// generates one dispatcher module that imports every route under `functions/`, bundles it with esbuild
// (bundle, minify, esm, follows relative imports), and refuses the version if the serialized bundle
// manifest is over FUNCTIONS_BUNDLE_MAX_BYTES (8 MiB, docs/functions#limits). So a module two routes
// import is compiled once only if it is one file both import: self-contained per-route bundles each
// carried their own copy of the content bundle, the vendored course-xapi-mcp server and zod.
import { execFileSync } from 'node:child_process';
import { copyFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type BuildOptions, build as esbuild } from 'esbuild';
import { build as viteBuild } from 'vite';
import { packCliPlugin, packTheme } from './pack-theme.ts';
import { zipWpPlugin } from './zip-wp-plugin.ts';
import { vendorShimsEsbuild } from './vendor-shims.ts';

export const FUNCTIONS_BUNDLE_LIMIT = 8 * 1024 * 1024; // Spacefast compiled bundle limit (docs/functions#limits)

const NEUTRAL_RESOLUTION: Pick<BuildOptions, 'platform' | 'mainFields'> = {
  platform: 'neutral',
  // platform 'neutral' sets no mainFields, so an npm dependency without `exports` would not resolve.
  mainFields: ['module', 'main'],
};

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

/**
 * Bundles every route in `srcDir` (e.g. functions/api) to `outDir`, one ESM entry per route. Code that
 * more than one route uses is split into `outDir/_chunks/` (never routed: its name starts with `_`), so
 * it is emitted, and compiled by Spacefast, once. Returns the route entries.
 */
export async function bundleFunctions(srcDir: string, outDir: string): Promise<string[]> {
  const routes = routeModules(srcDir);
  const result = await esbuild({
    entryPoints: routes.map((rel) => join(srcDir, rel)),
    outdir: outDir,
    outbase: srcDir,
    entryNames: '[dir]/[name]',
    chunkNames: '_chunks/[name]-[hash]',
    bundle: true,
    splitting: true,
    format: 'esm',
    ...NEUTRAL_RESOLUTION,
    // The MCP SDK's `_shims` export resolves to a Node shim (node:process, Ajv) without these; its
    // workerd build uses web APIs only. Only packages that publish these conditions are affected.
    conditions: ['workerd', 'worker', 'browser'],
    target: 'es2022',
    external: [],
    // The vendored course-xapi-mcp server's Node built-ins resolve to web shims (scripts/vendor-shims.ts).
    plugins: [vendorShimsEsbuild()],
    // Not minified here: Spacefast minifies when it compiles, and its route scan reads these files' exports.
    metafile: true,
    logLevel: 'warning',
  });
  const written = routes.map((rel) => join(outDir, rel.replace(ROUTE_EXT, '.js')));
  const outputs = new Map(Object.entries(result.metafile!.outputs).map(([f, o]) => [resolve(f), o]));
  for (const f of written) if (!outputs.has(resolve(f))) throw new Error(`esbuild emitted no ${f}`);
  // A dynamic import in code that tree-shaking dropped still gets its own chunk, imported by nothing.
  // Spacefast would serve such a file under functions/ as a public static file, so remove it.
  const reached = new Set<string>();
  const visit = (f: string) => {
    if (reached.has(f) || !outputs.has(f)) return;
    reached.add(f);
    for (const i of outputs.get(f)!.imports) visit(resolve(i.path));
  };
  for (const f of written) visit(resolve(f));
  for (const f of outputs.keys()) if (!reached.has(f)) rmSync(f);
  return written;
}

/**
 * The size Spacefast measures for the Functions under `functionsDir` (the published `functions/`): every
 * route compiled into one minified module the way `sf publish` does, as the JSON bundle manifest whose
 * byte length it checks against FUNCTIONS_BUNDLE_LIMIT. Leaves out its router runtime (about 3 KB).
 */
export async function compiledBundleSize(functionsDir: string): Promise<number> {
  const routes = routeModules(functionsDir);
  const contents = [
    ...routes.map((rel, i) => `import * as route${i} from ${JSON.stringify(`./${rel}`)};`),
    `export const MODULES = [${routes.map((_, i) => `route${i}`).join(', ')}];`,
  ].join('\n');
  const built = await esbuild({
    stdin: { contents, resolveDir: functionsDir, sourcefile: 'spacefast-router-entry.js', loader: 'js' },
    outfile: 'index.js',
    bundle: true,
    write: false,
    format: 'esm',
    target: 'es2024',
    ...NEUTRAL_RESOLUTION,
    conditions: ['workerd', 'worker', 'browser', 'import', 'module', 'default'],
    external: ['cloudflare:*'],
    loader: { '.js': 'jsx', '.mjs': 'jsx', '.cjs': 'jsx' },
    define: { 'process.env.NODE_ENV': '"production"' },
    minify: true,
    logLevel: 'silent',
  });
  const js = built.outputFiles![0].text;
  const manifest = { format: 'spacefast.functions.bundle.v1', mainModule: 'index.js', modules: { 'index.js': { js } } };
  return Buffer.byteLength(JSON.stringify(manifest), 'utf8');
}

const mb = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

/** Throws, as `sf publish` would, if the compiled Functions bundle is over the limit. */
export function assertBundleFits(size: number, limit = FUNCTIONS_BUNDLE_LIMIT): void {
  if (size > limit) throw new Error(`Functions bundle is ${mb(size)} (${size} bytes), over the ${mb(limit)} limit`);
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
  // The MCP connector converts the content at runtime; fail the build here if it no longer loads as the
  // course-xapi-mcp package the server teaches.
  // Imported late: the converter reads src/generated/content.json, which the step above just wrote.
  const { buildContent } = await import('./build-content.ts');
  const { buildAgentCourse } = await import('../functions/_lib/mcp/agentCourse.ts');
  buildAgentCourse(buildContent(join(root, 'content/snapshot')));
  await viteBuild({ root, logLevel: 'warn' });
  const dist = join(root, 'dist');
  rmSync(join(dist, 'functions'), { recursive: true, force: true });
  const files = await bundleFunctions(join(root, 'functions/api'), join(dist, 'functions/api'));
  const bundleSize = await compiledBundleSize(join(dist, 'functions'));
  assertBundleFits(bundleSize);
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
  console.log(`functions bundle, compiled: ${mb(bundleSize)} (${bundleSize} bytes, limit ${FUNCTIONS_BUNDLE_LIMIT})`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await assemble(process.cwd());
}
