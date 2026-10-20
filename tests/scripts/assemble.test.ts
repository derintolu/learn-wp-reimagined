import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { bundleFunctions, routeModules } from '../../scripts/assemble';

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
    for (const f of ['status.ts', 'admin/spend.ts', '_lib/db.ts', '_helper.ts', 'types.d.ts', 'x.test.ts', 'notes.md']) {
      writeFileSync(join(d, f), '');
    }
    expect(routeModules(d)).toEqual(['admin/spend.ts', 'status.ts']);
  });
});

describe('bundleFunctions', () => {
  it('writes one self-contained ESM file per route, keeping the method exports', async () => {
    const out = tmp();
    const files = await bundleFunctions('functions/api', out);
    expect(files.map((f) => f.slice(out.length + 1)).sort()).toEqual([
      'admin/spend.js',
      'checkpoint.js',
      'code-feedback.js',
      'placement.js',
      'status.js',
      'tutor.js',
    ]);
    const status = readFileSync(join(out, 'status.js'), 'utf8');
    expect(status).not.toMatch(/^\s*import\s/m);
    expect(status).toMatch(/export\s*\{[^}]*\bGET\b/);
  });
});
