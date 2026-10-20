import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { assertNoEnvFiles, bundleFunctions, envFilesIn, routeModules } from '../../scripts/assemble';

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
