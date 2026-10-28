// Packs the blog's block theme (wordpress/theme) into dist/theme/lwr-blog-<version>.zip, so the
// space's WordPress can install it from the live site:
//   sf wp -- theme install https://learnwp.sqwrlz.com/theme/lwr-blog-<version>.zip --activate --force
// and the one-file `wp lwr-blog put` plugin (wordpress/mu-plugins/lwr-blog-cli.php) into
// dist/plugin/lwr-blog-cli-<version>.zip, the same way:
//   sf wp -- plugin install https://learnwp.sqwrlz.com/plugin/lwr-blog-cli-<version>.zip --activate --force
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipSync } from 'fflate';

export const THEME_SLUG = 'lwr-blog';
export const CLI_PLUGIN_SLUG = 'lwr-blog-cli';

export function themeVersion(themeDir: string): string {
  const header = readFileSync(join(themeDir, 'style.css'), 'utf8');
  const v = /^\s*Version:\s*([0-9][0-9A-Za-z.-]*)\s*$/m.exec(header)?.[1];
  if (!v) throw new Error('style.css has no Version header');
  return v;
}

/** The `Version:` header of a single-file plugin. */
export function pluginVersion(file: string): string {
  const v = /^\s*\*?\s*Version:\s*([0-9][0-9A-Za-z.-]*)\s*$/m.exec(readFileSync(file, 'utf8'))?.[1];
  if (!v) throw new Error(`${file} has no Version header`);
  return v;
}

/** Zips a single-file plugin as `lwr-blog-cli/lwr-blog-cli.php`. Returns the zip path. */
export function packCliPlugin(file: string, outDir: string): string {
  mkdirSync(outDir, { recursive: true });
  const out = join(outDir, `${CLI_PLUGIN_SLUG}-${pluginVersion(file)}.zip`);
  writeFileSync(out, zipSync({ [`${CLI_PLUGIN_SLUG}/${CLI_PLUGIN_SLUG}.php`]: readFileSync(file) }, { level: 9 }));
  return out;
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
  console.log(packCliPlugin(join(root, 'wordpress/mu-plugins/lwr-blog-cli.php'), join(root, 'dist/plugin')));
}
