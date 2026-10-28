// Packs the blog's block theme (wordpress/theme) into dist/theme/lwr-blog-<version>.zip, so the
// space's WordPress can install it from the live site:
//   sf wp -- theme install https://learnwp.sqwrlz.com/theme/lwr-blog-<version>.zip --activate --force
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipSync } from 'fflate';

export const THEME_SLUG = 'lwr-blog';

export function themeVersion(themeDir: string): string {
  const header = readFileSync(join(themeDir, 'style.css'), 'utf8');
  const v = /^\s*Version:\s*([0-9][0-9A-Za-z.-]*)\s*$/m.exec(header)?.[1];
  if (!v) throw new Error('style.css has no Version header');
  return v;
}

/** Zips `themeDir` under a top-level `lwr-blog/` folder. Returns the zip path. */
export function packTheme(themeDir: string, outDir: string): string {
  const files: Record<string, Uint8Array> = {};
  const walk = (d: string) => {
    for (const name of readdirSync(d).sort()) {
      if (name.startsWith('.')) continue; // .DS_Store and friends
      const full = join(d, name);
      if (statSync(full).isDirectory()) walk(full);
      else files[`${THEME_SLUG}/${relative(themeDir, full).split(sep).join('/')}`] = readFileSync(full);
    }
  };
  walk(themeDir);
  mkdirSync(outDir, { recursive: true });
  const out = join(outDir, `${THEME_SLUG}-${themeVersion(themeDir)}.zip`);
  writeFileSync(out, zipSync(files, { level: 9 }));
  return out;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const root = process.cwd();
  console.log(packTheme(join(root, 'wordpress/theme'), join(root, 'dist/theme')));
}
