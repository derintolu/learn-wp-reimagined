// The committed course snapshot: content/snapshot/ holds the course-xapi-mcp package (authoring flavour) that
// the studio builds from. `npm run content:pull` refreshes it from the course server; `--from-yaml` writes it
// from today's YAML (until the YAML is deleted).
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import { PROGRAM_KEY } from '../functions/_lib/config';
import type { ConnectorClient } from '../functions/_lib/ledger/connector';
import { bundleToPackage } from '../src/shared/package';
import type { PackageFiles } from '../src/shared/package';
import { buildContentFromYaml } from './yaml-content';

export const SNAPSHOT_DIR = 'content/snapshot';
const VERSION_FILE = 'VERSION.json';

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v !== null && typeof v === 'object') {
    return Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, x]) => [k, sortKeys(x)]));
  }
  return v;
}

const lf = (s: string) => s.replace(/\r\n?/g, '\n');
const withNewline = (s: string) => (s.endsWith('\n') ? s : s + '\n');

/** Writes package files to `dir`: JSON with sorted keys and 2-space indent, LF line endings, no timestamps. Replaces what was there. */
export function writeSnapshot(files: PackageFiles, dir: string, meta: { version: number; etag: string } = { version: 0, etag: '' }): void {
  rmSync(dir, { recursive: true, force: true });
  const all: PackageFiles = { ...files, [VERSION_FILE]: JSON.stringify({ version: meta.version, etag: meta.etag }) };
  for (const name of Object.keys(all).sort()) {
    const text = name.endsWith('.json') ? JSON.stringify(sortKeys(JSON.parse(all[name]!)), null, 2) : lf(all[name]!);
    const file = join(dir, name);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, withNewline(text));
  }
}

/** Reads a snapshot back as package files (VERSION.json is not part of the package). */
export function readSnapshot(dir: string): PackageFiles {
  const out: PackageFiles = {};
  const walk = (d: string) => {
    for (const e of readdirSync(d).sort()) {
      const p = join(d, e);
      if (statSync(p).isDirectory()) walk(p);
      else {
        const name = relative(dir, p).split(sep).join('/');
        if (name !== VERSION_FILE) out[name] = readFileSync(p, 'utf8');
      }
    }
  };
  walk(dir);
  return out;
}

/** Signed GET of course-server/packages/<program> (full flavour), unzipped and written to the snapshot directory. */
export async function pullSnapshot(connector: Pick<ConnectorClient, 'getPackage'>, dir = SNAPSHOT_DIR): Promise<void> {
  const r = await connector.getPackage(PROGRAM_KEY);
  if (r.status !== 200) throw new Error('the course server answered 304 to a pull that sent no etag');
  const dec = new TextDecoder();
  const files = Object.fromEntries(Object.entries(unzipSync(r.zip)).map(([k, v]) => [k, dec.decode(v)]));
  writeSnapshot(files, dir, { version: r.version, etag: r.etag });
}

async function main(args: string[]): Promise<number> {
  const out = process.env.SNAPSHOT_DIR ?? SNAPSHOT_DIR;
  if (args[0] === '--from-yaml') {
    const yamlDir = args[1] ?? 'content';
    writeSnapshot(bundleToPackage(buildContentFromYaml(yamlDir)), out);
    console.log(`snapshot: written to ${out} from ${yamlDir}`);
    return 0;
  }
  const { ConnectorClient: Client } = await import('../functions/_lib/ledger/connector');
  const { readConnectorEnv } = await import('./keys');
  const env = readConnectorEnv(process.env.ENV_FILE ?? '.env.server') as unknown as ConstructorParameters<typeof Client>[0];
  await pullSnapshot(new Client(env), out);
  console.log(`snapshot: pulled ${PROGRAM_KEY} into ${out}`);
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv.slice(2)).then((c) => process.exit(c), (e) => { console.error((e as Error).message); process.exit(1); });
}
