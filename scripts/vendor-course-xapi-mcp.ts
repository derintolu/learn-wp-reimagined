// Copies a pinned commit of the course-xapi-mcp standard (the reference packages in
// github.com/derintolu/learning-mcp, Apache-2.0) into vendor/course-xapi-mcp. Vendored rather than a `github:`
// dependency or a submodule for the same reasons as vendor/learning-mcp: a private npm-workspaces monorepo
// installs only its root as a git dependency, and a private submodule would break public clones of this site.
//
//   npx tsx scripts/vendor-course-xapi-mcp.ts <path-to-learning-mcp-checkout> <commit> [--packages core,validator,...]
//
// The archive is taken from the commit (`git archive`), never from the checkout's working tree, so an
// uncommitted change in the source checkout is not vendored. The commit must exist; the tree need not be clean.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

export const VENDOR_REPO = 'github.com/derintolu/learning-mcp';
export const SCOPE = '@course-xapi-mcp/';
export type VendorPackage = 'core' | 'validator' | 'server' | 'lrs-client' | 'badges' | 'bridge';
export const ALL_PACKAGES: VendorPackage[] = ['core', 'validator', 'server', 'lrs-client', 'badges', 'bridge'];

const header = (commit: string, src: string) =>
  `// Vendored from ${VENDOR_REPO} @ ${commit}, ${src}. Do not edit here; change learning-mcp and re-vendor.\n`;

type PackageJson = { exports?: Record<string, string>; dependencies?: Record<string, string> };

function walk(dir: string, base = dir): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p, base));
    else out.push(p.slice(base.length + 1));
  }
  return out;
}

export function vendorCourseXapiMcp(
  srcRepo: string,
  commit: string,
  opts: { packages: VendorPackage[] },
  outDir = 'vendor/course-xapi-mcp',
): string[] {
  const packages = [...opts.packages];
  const full = execFileSync('git', ['-C', srcRepo, 'rev-parse', '--verify', `${commit}^{commit}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const tmp = mkdtempSync(join(tmpdir(), 'cxm-'));
  try {
    const paths = packages.flatMap((p) => [`reference/packages/${p}/src`, `reference/packages/${p}/package.json`]);
    const tar = execFileSync('git', ['-C', srcRepo, 'archive', '--format=tar', full, ...paths, 'LICENSE', 'NOTICE'], { maxBuffer: 1 << 28 });
    execFileSync('tar', ['-x', '-C', tmp], { input: tar });

    const manifests = new Map<string, PackageJson>(
      packages.map((p) => [p, JSON.parse(readFileSync(join(tmp, `reference/packages/${p}/package.json`), 'utf8')) as PackageJson]),
    );
    /** `@course-xapi-mcp/<p>[/<sub>]` -> path inside outDir, through the package's "exports" map. */
    const resolveSpec = (spec: string, from: string): string => {
      const [pkgName, ...subParts] = spec.slice(SCOPE.length).split('/');
      const manifest = manifests.get(pkgName);
      if (!manifest) throw new Error(`${from} imports ${spec}, but ${pkgName} is not among the vendored packages (${packages.join(', ')})`);
      const key = subParts.length ? `./${subParts.join('/')}` : '.';
      const target = manifest.exports?.[key];
      if (!target || !target.startsWith('./src/')) throw new Error(`${from} imports ${spec}, which ${pkgName} does not export`);
      return `${pkgName}/${target.slice('./src/'.length)}`;
    };
    const importRe = /(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(['"])(@course-xapi-mcp\/[^'"]+)\2/g;

    for (const p of [...ALL_PACKAGES, ...packages]) rmSync(join(outDir, p), { recursive: true, force: true });
    for (const f of ['LICENSE', 'NOTICE', 'VENDORED.json']) rmSync(join(outDir, f), { force: true });
    mkdirSync(outDir, { recursive: true });

    const files: string[] = [];
    const rewrites = new Set<string>();
    for (const p of packages) {
      const srcDir = join(tmp, `reference/packages/${p}/src`);
      for (const rel of walk(srcDir)) {
        const dest = `${p}/${rel}`;
        const srcPath = `reference/packages/${p}/src/${rel}`;
        mkdirSync(dirname(join(outDir, dest)), { recursive: true });
        if (!rel.endsWith('.ts')) {
          writeFileSync(join(outDir, dest), readFileSync(join(srcDir, rel)));
        } else {
          let text = readFileSync(join(srcDir, rel), 'utf8').replace(importRe, (_m, lead: string, q: string, spec: string) => {
            const rawRel = posix.relative(posix.dirname(dest), resolveSpec(spec, srcPath));
            rewrites.add(p);
            return `${lead}${q}${rawRel.startsWith('.') ? rawRel : `./${rawRel}`}${q}`;
          });
          const h = header(full, srcPath);
          // keep a shebang on line 1
          text = text.startsWith('#!') ? text.replace(/^(#![^\n]*\n)/, `$1${h}`) : h + text;
          writeFileSync(join(outDir, dest), text);
        }
        files.push(dest);
      }
    }
    writeFileSync(join(outDir, 'LICENSE'), readFileSync(join(tmp, 'LICENSE')));
    writeFileSync(join(outDir, 'NOTICE'), readFileSync(join(tmp, 'NOTICE')));
    files.push('LICENSE', 'NOTICE');

    const dependencies = Object.fromEntries(
      packages.map((p) => [p, Object.fromEntries(Object.entries(manifests.get(p)!.dependencies ?? {}).filter(([n]) => !n.startsWith(SCOPE)))]),
    );
    const meta = {
      repo: VENDOR_REPO,
      commit: full,
      license: 'Apache-2.0',
      source: 'git archive of the commit; the source checkout working tree is never read',
      packages,
      transforms: [
        `${SCOPE}<package>[/<subpath>] imports -> relative paths to the vendored file (via each package.json "exports")`,
        'a one-line provenance header on each .ts file',
        'each package src/ is flattened to <package>/; tests, package.json and bin files are not vendored',
      ],
      dependencies,
      files,
    };
    writeFileSync(join(outDir, 'VENDORED.json'), JSON.stringify(meta, null, 2) + '\n');
    return files;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  const i = args.indexOf('--packages');
  const list = i >= 0 ? args.splice(i, 2)[1] : ALL_PACKAGES.join(',');
  const [repo, commit] = args;
  if (!repo || !commit) throw new Error('usage: vendor-course-xapi-mcp.ts <repo> <commit> [--packages core,validator,...]');
  const packages = list.split(',') as VendorPackage[];
  for (const p of packages) if (!ALL_PACKAGES.includes(p)) throw new Error(`unknown package ${p}`);
  const files = vendorCourseXapiMcp(repo, commit, { packages });
  console.log(`vendored ${files.length} files (${packages.join(', ')}) at ${commit}`);
}
