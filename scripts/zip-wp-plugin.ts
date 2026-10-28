// Zips a WordPress plugin directory into <outDir>/<slug>-<Version header>.zip, nested under <slug>/.
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipSync } from 'fflate';

export function pluginVersion(dir: string): string {
  const slug = basename(dir);
  const header = readFileSync(join(dir, `${slug}.php`), 'utf8');
  const v = /^\s*\*?\s*Version:\s*([0-9][0-9A-Za-z.-]*)\s*$/m.exec(header)?.[1];
  if (!v) throw new Error(`${slug}.php has no Version header`);
  return v;
}

export function zipWpPlugin(dir: string, outDir = 'dist/wp-zips'): string {
  const slug = basename(dir);
  const files: Record<string, Uint8Array> = {};
  const walk = (d: string) => {
    for (const name of readdirSync(d).sort()) {
      if (name.startsWith('.')) continue; // .DS_Store and friends
      const full = join(d, name);
      if (statSync(full).isDirectory()) walk(full);
      else files[`${slug}/${relative(dir, full).split(sep).join('/')}`] = readFileSync(full);
    }
  };
  walk(dir);
  mkdirSync(outDir, { recursive: true });
  const out = join(outDir, `${slug}-${pluginVersion(dir)}.zip`);
  writeFileSync(out, zipSync(files, { level: 9 }));
  return out;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const root = process.cwd();
  console.log(zipWpPlugin(join(root, 'wordpress/lwr-backend-view'), join(root, 'dist/wp-zips')));
}
