import { unzipSync, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { buildContentFromYaml as buildContent } from '../../scripts/yaml-content';
import { bundleZip, buildMigrationZip, migrate, packageErrors, zipPackage } from '../../scripts/migrate-to-sensei';
import type { SpacefastApi } from '../../scripts/lib/spacefast';
import type { ConnectorClient } from '../../functions/_lib/ledger/connector';
import { bundleToPackage } from '../../src/shared/package';
import type { ContentBundle } from '../../src/shared/types';

const bundle = (): ContentBundle => buildContent('content');
const enc = new TextEncoder();
const fakeApi = (ok = true) => {
  const calls: Array<{ spaceId: string; args: string[] }> = [];
  const api: SpacefastApi = { async wpCli(spaceId, args) { calls.push({ spaceId, args }); return { ok }; } };
  return { api, calls };
};
const fakeConnector = (zip: Uint8Array) => {
  const programs: string[] = [];
  const connector = { async getPackage(program: string) { programs.push(program); return { status: 200 as const, etag: 'e', version: 1, zip }; } } as unknown as ConnectorClient;
  return { connector, programs };
};

describe('migration zip', () => {
  it('zip contains cmi5.xml, cxm/course.json and 18 lesson files', () => {
    const files = unzipSync(bundleZip(bundle()));
    expect(files['cmi5.xml']).toBeDefined();
    expect(files['cxm/course.json']).toBeDefined();
    expect(Object.keys(files).filter((f) => /^cxm\/lessons\/[^/]+\.json$/.test(f))).toHaveLength(18);
  });

  it('the real content either zips or fails with validator codes (count not pinned)', () => {
    try {
      const files = unzipSync(buildMigrationZip('content'));
      expect(files['cmi5.xml']).toBeDefined();
    } catch (e) {
      expect((e as Error).message).toMatch(/CXM-[A-Z]+-\d+/);
    }
  });

  it('invalid content fails with validator codes', () => {
    const b = bundle();
    const lesson = Object.values(b.lessons).find((l) => l.checkpoint?.checks?.length)!;
    // A check that already passes on the starter code proves nothing (CXM-PKG-022); a missing file breaks loading.
    const files = bundleToPackage(b);
    delete files['cxm/lessons/' + lesson.id + '.json'];
    const errors = packageErrors(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, enc.encode(v)])));
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.join('\n')).toMatch(/CXM-[A-Z]+-\d+/);
    expect(() => zipPackage(files)).toThrow(/CXM-[A-Z]+-\d+/);
  });
});

describe('migrate', () => {
  const pkgZip = (b: ContentBundle) => zipSync(Object.fromEntries(Object.entries(bundleToPackage(b)).map(([k, v]) => [k, enc.encode(v)])));

  it('imports the package url and finds no diffs when the pulled package is unchanged', async () => {
    const yaml = bundle();
    const { api, calls } = fakeApi();
    const { connector, programs } = fakeConnector(pkgZip(yaml));
    const r = await migrate({ api, connector, spaceId: 'sp1', packageUrl: 'https://example.test/p.zip', yaml });
    expect(calls).toEqual([{ spaceId: 'sp1', args: ['learning-ledger', 'package', 'import', 'https://example.test/p.zip'] }]);
    expect(programs).toEqual(['learn-wp-reimagined']);
    expect(r).toEqual({ imported: true, diffs: [] });
  });

  it('re-running with an unchanged package yields no diffs', async () => {
    const yaml = bundle();
    const { api } = fakeApi();
    const { connector } = fakeConnector(pkgZip(yaml));
    const deps = { api, connector, spaceId: 'sp1', packageUrl: 'https://example.test/p.zip', yaml };
    expect((await migrate(deps)).diffs).toEqual([]);
    expect((await migrate(deps)).diffs).toEqual([]);
  });

  it('migrate reports diffs from a fake connector that drops a check', async () => {
    const yaml = bundle();
    const dropped: ContentBundle = JSON.parse(JSON.stringify(yaml));
    const l = Object.values(dropped.lessons).find((x) => (x.checkpoint?.checks?.length ?? 0) > 0)!;
    l.checkpoint!.checks!.pop();
    const { api } = fakeApi();
    const { connector } = fakeConnector(pkgZip(dropped));
    const r = await migrate({ api, connector, spaceId: 'sp1', packageUrl: 'https://example.test/p.zip', yaml });
    expect(r.imported).toBe(true);
    expect(r.diffs.length).toBeGreaterThan(0);
    expect(r.diffs.join('\n')).toContain(l.id);
  });

  it('does not pull the package back when the import fails', async () => {
    const yaml = bundle();
    const { api } = fakeApi(false);
    const { connector, programs } = fakeConnector(pkgZip(yaml));
    const r = await migrate({ api, connector, spaceId: 'sp1', packageUrl: 'https://example.test/p.zip', yaml });
    expect(r).toEqual({ imported: false, diffs: [] });
    expect(programs).toEqual([]);
  });
});
