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
import { copyFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build as esbuild } from 'esbuild';
import { build as viteBuild } from 'vite';

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
      target: 'es2022',
      external: [],
      logLevel: 'warning',
    });
    const size = statSync(outfile).size;
    if (size > BUNDLE_LIMIT) throw new Error(`${outfile} is ${size} bytes, over the 8 MiB limit`);
    written.push(outfile);
  }
  return written;
}

export async function assemble(root: string): Promise<void> {
  execFileSync(process.execPath, ['--import', 'tsx', join(root, 'scripts/build-content.ts')], {
    cwd: root,
    stdio: 'inherit',
  });
  await viteBuild({ root, logLevel: 'warn' });
  const dist = join(root, 'dist');
  const files = await bundleFunctions(join(root, 'functions/api'), join(dist, 'functions/api'));
  copyFileSync(join(root, 'sf.jsonc'), join(dist, 'sf.jsonc'));
  for (const f of files) console.log(`function: ${relative(root, f)} (${statSync(f).size} bytes)`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await assemble(process.cwd());
}
