import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { BUNDLE_LIMIT, assertNoEnvFiles, bundleFunctions, envFilesIn, routeModules } from '../../scripts/assemble';

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
  it('writes one self-contained ESM file per route, keeping the method exports', async () => {
    const out = tmp();
    const routes = routeModules(API);
    expect(routes.length).toBeGreaterThan(0);
    const files = await bundleFunctions(API, out);
    expect(files.map((f) => f.slice(out.length + 1)).sort()).toEqual(routes.map((r) => r.replace(/\.tsx?$/, '.js')).sort());
    for (const f of files) {
      const code = readFileSync(f, 'utf8');
      expect(code).not.toMatch(/^\s*import\s/m);
      expect(code).toMatch(/export\s*\{[^}]*\b(GET|POST|default)\b/);
    }
  });
});

describe('the MCP connector bundle', () => {
  it('bundles the SDK for a web runtime: no node: imports, under the limit, with its methods', async () => {
    const out = tmp();
    const files = await bundleFunctions(API, out);
    const mcp = files.find((f) => f.endsWith('/mcp.js'))!;
    expect(mcp).toBeTruthy();
    const code = readFileSync(mcp, 'utf8');
    expect(code).not.toMatch(/["']node:/);
    expect(code).not.toMatch(/\brequire\(/);
    expect(code).toMatch(/export\s*\{[^}]*\bPOST\b/);
    expect(code).toMatch(/export\s*\{[^}]*\bGET\b/);
    expect(code).toMatch(/export\s*\{[^}]*\bDELETE\b/);
    expect(code.length).toBeLessThan(BUNDLE_LIMIT);
    for (const f of files) expect(readFileSync(f, 'utf8'), f).not.toMatch(/from\s*["']node:/);
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
    for (const t of ['list_paths', 'start_placement', 'next_beat', 'delete_record']) expect(text).toContain(`"${t}"`);
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
