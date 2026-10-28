import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  FUNCTIONS_BUNDLE_LIMIT,
  assertBundleFits,
  assertNoEnvFiles,
  bundleFunctions,
  compiledBundleSize,
  envFilesIn,
  routeModules,
} from '../../scripts/assemble';
import { getContent } from '../../functions/_lib/content';
import { connectMcp } from '../helpers/mcpClient';

const API = fileURLToPath(new URL('../../functions/api', import.meta.url));

const dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), 'assemble-'));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** Every .js file under `dir`, at any depth, chunks included. */
const allJs = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? allJs(full) : name.endsWith('.js') ? [full] : [];
  });

/** The module specifiers a built ESM file imports. */
const importsOf = (code: string): string[] => [...code.matchAll(/^\s*import\s[^;]*?from\s*["']([^"']+)["']/gm)].map((m) => m[1]);

describe('routeModules', () => {
  it('lists routes and skips helpers, declarations and tests', () => {
    const d = tmp();
    mkdirSync(join(d, 'admin'));
    mkdirSync(join(d, '_lib'));
    for (const f of ['status.ts', 'admin/spend.ts', '[...rest].ts', '_lib/db.ts', '_helper.ts', 'types.d.ts', 'x.test.ts', 'notes.md']) {
      writeFileSync(join(d, f), '');
    }
    expect(routeModules(d)).toEqual(['[...rest].ts', 'admin/spend.ts', 'status.ts']);
  });
});

describe('bundleFunctions', () => {
  it('writes one ESM entry per route, keeping the method exports, importing only shared chunks', async () => {
    const out = tmp();
    const routes = routeModules(API);
    expect(routes.length).toBeGreaterThan(0);
    const files = await bundleFunctions(API, out);
    expect(files.map((f) => f.slice(out.length + 1)).sort()).toEqual(routes.map((r) => r.replace(/\.tsx?$/, '.js')).sort());
    for (const f of files) {
      const code = readFileSync(f, 'utf8');
      for (const spec of importsOf(code)) expect(spec, f).toMatch(/^\.\.?\/(\.\.\/)*_chunks\//);
      expect(code).toMatch(/export\s*\{[^}]*\b(GET|POST|default)\b/);
    }
    // Shared code sits under `_chunks/`, which Spacefast never routes.
    expect(routeModules(out).sort()).toEqual(files.map((f) => f.slice(out.length + 1)).sort());
    // Every chunk is imported by some route's graph: Spacefast compiles those and would publish any other
    // file under functions/ as a public static file.
    const all = allJs(out);
    const referenced = new Set(all.flatMap((f) => [...readFileSync(f, 'utf8').matchAll(/["'](\.\.?\/[^"']*\.js)["']/g)].map((m) => resolve(dirname(f), m[1]))));
    for (const f of all.filter((x) => !files.includes(x))) expect(referenced.has(resolve(f)), f).toBe(true);
  });

  it('emits code shared by several routes once', async () => {
    const src = tmp();
    mkdirSync(join(src, '_lib'));
    writeFileSync(join(src, '_lib/big.ts'), `export const BIG = ${JSON.stringify('shared-marker-' + 'x'.repeat(200_000))};`);
    for (const r of ['a', 'b', 'c']) {
      writeFileSync(join(src, `${r}.ts`), `import { BIG } from './_lib/big';\nexport function GET() { return new Response(BIG + '${r}'); }`);
    }
    const root = tmp();
    const files = await bundleFunctions(src, join(root, 'functions'));
    expect(files).toHaveLength(3);
    const copies = allJs(join(root, 'functions')).filter((f) => readFileSync(f, 'utf8').includes('shared-marker-'));
    expect(copies).toHaveLength(1);
    const size = await compiledBundleSize(join(root, 'functions'));
    expect(size).toBeGreaterThan(200_000);
    expect(size).toBeLessThan(300_000);
  });
});

describe('the compiled Functions bundle', () => {
  it('measures what Spacefast compiles: every route in one minified module, serialized as its manifest', async () => {
    const root = tmp();
    mkdirSync(join(root, 'functions/api'), { recursive: true });
    writeFileSync(join(root, 'functions/api/ping.js'), 'export function GET() { return new Response("pong"); }\n');
    writeFileSync(join(root, 'functions/api/_unused.js'), `export const X = ${JSON.stringify('y'.repeat(100_000))};\n`);
    const size = await compiledBundleSize(join(root, 'functions'));
    expect(size).toBeGreaterThan(0);
    // `_` helpers that no route imports are not part of the worker.
    expect(size).toBeLessThan(10_000);
  });

  it('the real routes fit the Spacefast limit once compiled', async () => {
    const root = tmp();
    await bundleFunctions(API, join(root, 'functions/api'));
    const size = await compiledBundleSize(join(root, 'functions'));
    expect(size).toBeLessThan(FUNCTIONS_BUNDLE_LIMIT);
  });

  it('assertBundleFits refuses a bundle over 8 MiB', () => {
    expect(FUNCTIONS_BUNDLE_LIMIT).toBe(8 * 1024 * 1024);
    expect(() => assertBundleFits(FUNCTIONS_BUNDLE_LIMIT)).not.toThrow();
    expect(() => assertBundleFits(FUNCTIONS_BUNDLE_LIMIT + 1)).toThrow(/over the 8\.0 MB limit/);
  });
});

describe('the MCP connector bundle', () => {
  it('bundles the SDK for a web runtime: no node: imports, with its methods', async () => {
    const out = tmp();
    const files = await bundleFunctions(API, out);
    const mcp = files.find((f) => f.endsWith('/mcp.js'))!;
    expect(mcp).toBeTruthy();
    const code = readFileSync(mcp, 'utf8');
    for (const f of allJs(out)) {
      const c = readFileSync(f, 'utf8');
      expect(c, f).not.toMatch(/["']node:/);
      expect(c, f).not.toMatch(/\brequire\(/);
    }
    expect(code).toMatch(/export\s*\{[^}]*\bPOST\b/);
    expect(code).toMatch(/export\s*\{[^}]*\bGET\b/);
    expect(code).toMatch(/export\s*\{[^}]*\bDELETE\b/);
    for (const f of allJs(out)) expect(readFileSync(f, 'utf8'), f).not.toMatch(/from\s*["']node:/);
  });

  it('the bundled connector serves tools/list when imported as a module', async () => {
    const out = tmp();
    const files = await bundleFunctions(API, out);
    const mod = await import(files.find((f) => f.endsWith('/mcp.js'))!);
    const { createSqliteD1 } = await import('../../dev/sqliteD1');
    const res: Response = await mod.POST(
      new Request('http://localhost/api/mcp', {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
      }),
      { params: {}, env: { DB: createSqliteD1() } },
    );
    expect(res.status).toBe(200);
    const text = await res.text();
    for (const t of ['get_status', 'start_placement', 'next_beat', 'reveal_bug', 'delete_practice_record']) expect(text).toContain(`"${t}"`);
  });

  it('carries the reference server without its Node-only parts: no Directory stores, private files or badge signing', async () => {
    const out = tmp();
    const files = await bundleFunctions(API, out);
    // The connector's code now sits in shared chunks: check every emitted file.
    expect(files.some((x) => /\/mcp\.js$/.test(x))).toBe(true);
    for (const f of allJs(out)) {
      const code = readFileSync(f, 'utf8');
      for (const gone of ['DirectoryPracticeStore', 'DirectoryServerStore', 'writeFileAtomic', 'digitalbazaar', 'readFileSync', 'gzipSync']) expect(code, `${f}: ${gone}`).not.toContain(gone);
    }
  });

  it('the bundled connector runs a code checkpoint with its regex checks (the web shims, not Node)', async () => {
    const out = tmp();
    const files = await bundleFunctions(API, out);
    const mod = await import(files.find((f) => f.endsWith('/mcp.js'))!);
    const { createSqliteD1 } = await import('../../dev/sqliteD1');
    const env = { DB: createSqliteD1() };
    const { client, call } = await connectMcp((req) => mod.POST(req, { params: {}, env }), 'modern');
    try {
      const handle = (await call('start_placement')).data.handle as string;
      expect(handle).toMatch(/^cxp_/);
      await call('choose_placement', { handle, pathKey: 'block-theme', startLessonKey: 'bt-style-css-and-theme-json', skip: ['bt-what-is-a-block-theme'], reason: 'x' });
      let r = await call('next_beat', { handle });
      for (let i = 0; i < 20 && r.data.step === 'beat'; i++) r = await call('next_beat', r.data.beat.question ? { handle, learner_reply: 'Yes.' } : { handle });
      expect(r.data.step).toBe('checkpoint');
      const bad = await call('check_code', { handle, file: 'theme.json', content: '{}' });
      expect(bad.data.passed).toBe(false);
      const good = await call('check_code', { handle, file: 'theme.json', content: getContent().paths['block-theme'].finalFiles!['theme.json'] });
      expect(good.data).toMatchObject({ passed: true });
      expect(good.data.checks.every((c: { passed: boolean }) => c.passed)).toBe(true);
    } finally {
      await client.close();
    }
  });
});

describe('no .env files in the publish directory', () => {
  it('finds .env files at any depth', () => {
    const d = tmp();
    mkdirSync(join(d, 'a/b'), { recursive: true });
    writeFileSync(join(d, 'index.html'), '');
    writeFileSync(join(d, 'a/b/.env.server'), 'X=1');
    writeFileSync(join(d, '.env'), 'X=1');
    expect(envFilesIn(d).sort()).toEqual(['.env', 'a/b/.env.server']);
    expect(() => assertNoEnvFiles(d)).toThrow(/refusing to publish.*\.env/);
  });

  it('passes a clean directory', () => {
    const d = tmp();
    writeFileSync(join(d, 'index.html'), '');
    expect(() => assertNoEnvFiles(d)).not.toThrow();
  });
});
