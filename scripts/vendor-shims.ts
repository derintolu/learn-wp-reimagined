// How the vendored course-xapi-mcp server is resolved for this host, without editing the vendored files.
//
// 1. Everywhere (vitest and the Functions bundle): server/tools.ts imports only `awardsFor` from the badges
//    package, but through its index, which also loads the signing code (@digitalbazaar/*, node:fs at module
//    load). /api/mcp runs practice custody, which never signs, so that one import resolves to badges/awards.ts.
// 2. Functions bundle only: the Node built-ins the vendored code imports resolve to web shims
//    (functions/_lib/shims/). Only randomUUID and the regex check are ever called on this path; everything
//    else (the Directory* stores, private files, readDir) is unused, tree-shaken, and throws if it is not.
import { fileURLToPath } from 'node:url';
import type { Plugin as EsbuildPlugin } from 'esbuild';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const VENDOR = ROOT + 'vendor/course-xapi-mcp/';
const SHIMS = ROOT + 'functions/_lib/shims/';

/** Node built-ins the vendored server imports, and the web shim each resolves to in the Functions bundle. */
export const NODE_SHIMS: Record<string, string> = {
  'node:crypto': SHIMS + 'node-crypto.ts',
  'node:vm': SHIMS + 'node-vm.ts',
  'node:fs/promises': SHIMS + 'node-fs-promises.ts',
  'node:path': SHIMS + 'node-path.ts',
};

const norm = (p: string) => p.split('\\').join('/');

/** The badges index, as server/tools.ts imports it, resolves to the awards module alone. */
export function badgesRedirect(specifier: string, importer: string | undefined): string | undefined {
  if (specifier !== '../badges/index.ts' || !importer) return undefined;
  return norm(importer) === VENDOR + 'server/tools.ts' ? VENDOR + 'badges/awards.ts' : undefined;
}

/** The web shim for a Node built-in imported by vendored course-xapi-mcp code; undefined for anything else. */
export function nodeShim(specifier: string, importer: string | undefined): string | undefined {
  if (!importer || !norm(importer).startsWith(VENDOR)) return undefined;
  return NODE_SHIMS[specifier];
}

/** Vite/vitest plugin: the badges redirect only (tests run on Node, which has the built-ins). */
export function vendorRedirectsVite() {
  return {
    name: 'course-xapi-mcp-redirects',
    enforce: 'pre' as const,
    resolveId(source: string, importer: string | undefined) {
      return badgesRedirect(source, importer) ?? null;
    },
  };
}

/** esbuild plugin for the Functions bundle: the badges redirect and the Node built-in shims. */
export function vendorShimsEsbuild(): EsbuildPlugin {
  return {
    name: 'course-xapi-mcp-shims',
    setup(build) {
      build.onResolve({ filter: /^\.\.\/badges\/index\.ts$/ }, (a) => {
        const path = badgesRedirect(a.path, a.importer);
        return path ? { path } : undefined;
      });
      build.onResolve({ filter: /^node:/ }, (a) => {
        const path = nodeShim(a.path, a.importer);
        return path ? { path } : undefined;
      });
    },
  };
}
