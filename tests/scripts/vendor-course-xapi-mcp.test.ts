import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { vendorCourseXapiMcp } from '../../scripts/vendor-course-xapi-mcp';

let root: string;
let src: string;
let out: string;
let commit: string;

const git = (...args: string[]) => execFileSync('git', ['-C', src, ...args], { encoding: 'utf8' }).trim();
const put = (rel: string, body: string) => {
  mkdirSync(dirname(join(src, rel)), { recursive: true });
  writeFileSync(join(src, rel), body);
};
const pkg = (name: string, exports: Record<string, string>, dependencies: Record<string, string>) =>
  JSON.stringify({ name: `@course-xapi-mcp/${name}`, exports, dependencies });

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'cxm-vendor-'));
  src = join(root, 'src-repo');
  out = join(root, 'out');
  mkdirSync(src);
  git('init', '-q');
  git('config', 'user.email', 't@example.com');
  git('config', 'user.name', 't');
  put('LICENSE', 'Apache License fixture\n');
  put('NOTICE', 'notice fixture\n');
  put('reference/packages/core/package.json', pkg('core', { '.': './src/index.ts', './xapi': './src/xapi/index.ts' }, { zod: '4.6.7' }));
  put('reference/packages/core/src/index.ts', "export const core = 1;\nexport * from './xapi/index.ts';\n");
  put('reference/packages/core/src/xapi/index.ts', 'export const xapi = 2;\n');
  put('reference/packages/core/src/data/ctx.json', '{"a":1}\n');
  put('reference/packages/core/test/skip.test.ts', 'export {};\n');
  put(
    'reference/packages/validator/package.json',
    pkg('validator', { '.': './src/index.ts' }, { '@course-xapi-mcp/core': '0.2.0', fflate: '0.8.3' }),
  );
  put(
    'reference/packages/validator/src/lint/a.ts',
    "import { core } from '@course-xapi-mcp/core';\nimport { xapi } from '@course-xapi-mcp/core/xapi';\nconst lazy = () => import('@course-xapi-mcp/core');\nexport { core, xapi, lazy };\n",
  );
  put('reference/packages/validator/src/index.ts', "export * from './lint/a.ts';\n");
  git('add', '-A');
  git('commit', '-qm', 'fixture');
  commit = git('rev-parse', 'HEAD');
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('vendorCourseXapiMcp', () => {
  it('rewrites @course-xapi-mcp imports, subpaths included, to relative paths', () => {
    const files = vendorCourseXapiMcp(src, commit, { packages: ['core', 'validator'] }, out);
    const a = readFileSync(join(out, 'validator/lint/a.ts'), 'utf8');
    expect(a).toContain("from '../../core/index.ts'");
    expect(a).toContain("from '../../core/xapi/index.ts'");
    expect(a).toContain("import('../../core/index.ts')");
    expect(a).not.toContain('@course-xapi-mcp');
    expect(a.split('\n')[0]).toBe(
      `// Vendored from github.com/derintolu/learning-mcp @ ${commit}, reference/packages/validator/src/lint/a.ts. Do not edit here; change learning-mcp and re-vendor.`,
    );
    expect(files).toContain('core/index.ts');
    expect(files).toContain('validator/lint/a.ts');
    expect(files).toContain('core/data/ctx.json');
    expect(files.some((f) => f.includes('test'))).toBe(false);
    // data files are copied byte for byte, without a header
    expect(readFileSync(join(out, 'core/data/ctx.json'), 'utf8')).toBe('{"a":1}\n');
  });

  it('records the full commit, Apache-2.0 and the third-party dependencies', () => {
    vendorCourseXapiMcp(src, commit.slice(0, 7), { packages: ['core', 'validator'] }, out);
    const meta = JSON.parse(readFileSync(join(out, 'VENDORED.json'), 'utf8'));
    expect(meta.commit).toBe(commit);
    expect(meta.license).toBe('Apache-2.0');
    expect(meta.packages).toEqual(['core', 'validator']);
    expect(meta.dependencies).toEqual({ core: { zod: '4.6.7' }, validator: { fflate: '0.8.3' } });
    expect(readFileSync(join(out, 'LICENSE'), 'utf8')).toBe('Apache License fixture\n');
    expect(readFileSync(join(out, 'NOTICE'), 'utf8')).toBe('notice fixture\n');
  });

  it('refuses an unknown commit, and a package that imports one that is not vendored', () => {
    expect(() => vendorCourseXapiMcp(src, 'deadbeef'.repeat(5), { packages: ['core'] }, out)).toThrow();
    expect(() => vendorCourseXapiMcp(src, commit, { packages: ['validator'] }, out)).toThrow(/core/);
  });

  it('vendors the commit, not a dirty working tree', () => {
    put('reference/packages/core/src/index.ts', 'export const dirty = true;\n');
    vendorCourseXapiMcp(src, commit, { packages: ['core'] }, out);
    const index = readFileSync(join(out, 'core/index.ts'), 'utf8');
    expect(index).toContain('export const core = 1;');
    expect(index).not.toContain('dirty');
  });

  it('leaves the site README in place on a re-vendor and drops removed files', () => {
    vendorCourseXapiMcp(src, commit, { packages: ['core'] }, out);
    writeFileSync(join(out, 'README.md'), 'ours\n');
    writeFileSync(join(out, 'core/stale.ts'), 'x');
    vendorCourseXapiMcp(src, commit, { packages: ['core'] }, out);
    expect(readFileSync(join(out, 'README.md'), 'utf8')).toBe('ours\n');
    expect(() => readFileSync(join(out, 'core/stale.ts'))).toThrow();
  });
});
