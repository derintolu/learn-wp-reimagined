// Copies a pinned commit of learning-mcp (github.com/derintolu/learning-mcp, GPL-2.0-or-later) into
// vendor/learning-mcp. Vendored rather than a `github:` dependency or a submodule: the repo is a private
// npm-workspaces monorepo, so a git dependency installs only its root, and a private submodule would
// break public clones of this site (plan B, ruling R-b).
//
//   npx tsx scripts/vendor-learning-mcp.ts <path-to-learning-mcp-checkout> <commit>
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const VENDOR_REPO = 'github.com/derintolu/learning-mcp';
/** The one change made to vendored code: the server imports core by relative path (ruling R-B2). */
export const CORE_IMPORT_FROM = "from '@learning-mcp/core'";
export const CORE_IMPORT_TO = "from '../core/index.ts'";

const header = (commit: string, src: string) =>
  `// Vendored from ${VENDOR_REPO} @ ${commit}, ${src}. Do not edit here; change learning-mcp and re-vendor.\n`;

export function vendorLearningMcp(srcRepo: string, commit: string, outDir = 'vendor/learning-mcp'): string[] {
  const full = execFileSync('git', ['-C', srcRepo, 'rev-parse', '--verify', `${commit}^{commit}`], { encoding: 'utf8' }).trim();
  const tmp = mkdtempSync(join(tmpdir(), 'lmcp-'));
  try {
    const tar = execFileSync('git', ['-C', srcRepo, 'archive', '--format=tar', full, 'packages/core/src', 'packages/server/src/server.ts', 'LICENSE']);
    execFileSync('tar', ['-x', '-C', tmp], { input: tar });
    // README.md (this site's licence notice) is ours and stays.
    for (const p of ['core', 'server', 'LICENSE', 'VENDORED.json']) rmSync(join(outDir, p), { recursive: true, force: true });
    mkdirSync(join(outDir, 'core'), { recursive: true });
    mkdirSync(join(outDir, 'server'), { recursive: true });
    const files: string[] = [];
    for (const name of readdirSync(join(tmp, 'packages/core/src')).sort()) {
      if (!name.endsWith('.ts')) continue;
      const src = `packages/core/src/${name}`;
      writeFileSync(join(outDir, 'core', name), header(full, src) + readFileSync(join(tmp, src), 'utf8'));
      files.push(`core/${name}`);
    }
    const serverSrc = readFileSync(join(tmp, 'packages/server/src/server.ts'), 'utf8');
    if (!serverSrc.includes(CORE_IMPORT_FROM)) throw new Error('server.ts no longer imports @learning-mcp/core; update the vendor transform');
    writeFileSync(join(outDir, 'server/server.ts'), header(full, 'packages/server/src/server.ts') + serverSrc.split(CORE_IMPORT_FROM).join(CORE_IMPORT_TO));
    files.push('server/server.ts');
    writeFileSync(join(outDir, 'LICENSE'), readFileSync(join(tmp, 'LICENSE')));
    files.push('LICENSE');
    const meta = {
      repo: VENDOR_REPO,
      commit: full,
      license: 'GPL-2.0-or-later',
      transforms: [`server/server.ts: ${CORE_IMPORT_FROM} -> ${CORE_IMPORT_TO}`, 'a one-line provenance header on each .ts file'],
      files,
    };
    writeFileSync(join(outDir, 'VENDORED.json'), JSON.stringify(meta, null, 2) + '\n');
    return files;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [repo, commit] = process.argv.slice(2);
  if (!repo || !commit) throw new Error('usage: vendor-learning-mcp.ts <repo> <commit>');
  const files = vendorLearningMcp(repo, commit);
  console.log(`vendored ${files.length} files at ${commit}`);
}
