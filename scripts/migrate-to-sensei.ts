// Moves the YAML course into Sensei through the learning-ledger package importer, then pulls the package back
// and compares it with the YAML so a lossy import shows up as a list of differences.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync, zipSync } from 'fflate';
import type { ConnectorClient } from '../functions/_lib/ledger/connector';
import { PROGRAM_KEY } from '../functions/_lib/config';
import { bundleToPackage, compareBundles, packageToBundle } from '../src/shared/package';
import type { PackageFiles } from '../src/shared/package';
import type { ContentBundle } from '../src/shared/types';
import { loadPackage } from '../vendor/course-xapi-mcp/core/package/index.ts';
import { behaviourIssues } from '../vendor/course-xapi-mcp/validator/behaviour.ts';
import { lintIssues } from '../vendor/course-xapi-mcp/validator/lint.ts';
import { buildContent } from './build-content';
import type { SpacefastApi } from './lib/spacefast';

const enc = new TextEncoder();
const dec = new TextDecoder();
export const ZIP_PATH = 'dist/wp-zips/learn-wp-reimagined-authoring.zip';

/** Validator errors as "CODE file pointer: message" lines. XSD checks need schema files that are not vendored. */
export function packageErrors(files: Record<string, Uint8Array>): string[] {
  const loaded = loadPackage(files);
  const line = (i: { code: string; file?: string; pointer?: string; message?: string }) =>
    `${i.code} ${[i.file, i.pointer].filter(Boolean).join(' ')}${i.message ? `: ${i.message}` : ''}`;
  const out = loaded.issues.filter((i) => i.severity === 'error').map(line);
  if (!loaded.ok) return out;
  const lessons = Object.values(loaded.course.lessons).map((l) => {
    const file = `cxm/lessons/${l.key}.json`;
    return { key: l.key, file, base: '', lesson: JSON.parse(dec.decode(files[file]!)) };
  });
  const course = { file: 'cxm/course.json', base: '', rules: loaded.course.rules };
  const issues = [...behaviourIssues(lessons, 'authoring'), ...lintIssues(course, lessons)];
  return [...out, ...issues.filter((i) => i.severity === 'error').map(line)];
}

const toBytes = (files: PackageFiles) => Object.fromEntries(Object.entries(files).map(([k, v]) => [k, enc.encode(v)]));

/** Zips package files without validating them. */
export function bundleZip(b: ContentBundle): Uint8Array {
  return zipSync(toBytes(bundleToPackage(b)), { level: 9 });
}

/** Validates package files and zips them; throws with the validator's error codes. */
export function zipPackage(files: PackageFiles): Uint8Array {
  const bytes = toBytes(files);
  const errors = packageErrors(bytes);
  if (errors.length) throw new Error(`The package fails validation (${errors.length} errors):\n${errors.join('\n')}`);
  return zipSync(bytes, { level: 9 });
}

export function buildMigrationZip(yamlDir: string): Uint8Array {
  return zipPackage(bundleToPackage(buildContent(yamlDir)));
}

export interface MigrateDeps {
  api: SpacefastApi;
  connector: ConnectorClient;
  spaceId: string;
  packageUrl: string;
  yaml: ContentBundle;
  /** The ledger program to pull back. */
  program?: string;
}

export async function migrate(deps: MigrateDeps): Promise<{ imported: boolean; diffs: string[] }> {
  const { ok } = await deps.api.wpCli(deps.spaceId, ['learning-ledger', 'package', 'import', deps.packageUrl]);
  if (!ok) return { imported: false, diffs: [] };
  const pulled = await deps.connector.getPackage(deps.program ?? PROGRAM_KEY);
  if (pulled.status !== 200) throw new Error(`the ledger answered ${pulled.status} for the package`);
  const files = Object.fromEntries(Object.entries(unzipSync(pulled.zip)).filter(([n]) => !n.endsWith('/')).map(([n, d]) => [n, dec.decode(d)]));
  return { imported: true, diffs: compareBundles(deps.yaml, packageToBundle(files)) };
}

async function main(argv: string[]): Promise<number> {
  const [cmd, packageUrl] = argv;
  if (cmd === 'zip') {
    const out = join(process.cwd(), ZIP_PATH);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, buildMigrationZip('content'));
    console.log(out);
    return 0;
  }
  if (cmd === 'run' && packageUrl) {
    const { httpSpacefastApi } = await import('./lib/spacefast');
    const { ConnectorClient: Client } = await import('../functions/_lib/ledger/connector');
    const token = process.env.SPACEFAST_TOKEN;
    const spaceId = process.env.SPACE_A_ID;
    if (!token || !spaceId) throw new Error('set SPACEFAST_TOKEN and SPACE_A_ID');
    const { readConnectorEnv } = await import('./keys');
    const env = readConnectorEnv(process.env.ENV_FILE ?? '.env.server') as unknown as ConstructorParameters<typeof Client>[0];
    const r = await migrate({ api: httpSpacefastApi(token), connector: new Client(env), spaceId, packageUrl, yaml: buildContent('content') });
    if (!r.imported) { console.error('the import failed'); return 1; }
    for (const d of r.diffs) console.log(d);
    console.log(r.diffs.length ? `${r.diffs.length} differences` : 'round trip clean');
    return r.diffs.length ? 1 : 0;
  }
  console.error('usage: migrate-to-sensei.ts zip | run <packageUrl>');
  return 2;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv.slice(2)).then((c) => process.exit(c), (e) => { console.error((e as Error).message); process.exit(1); });
}
