import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ContentBundleSchema } from '../src/shared/schema';
import { packageToBundle } from '../src/shared/package';
import type { ContentBundle } from '../src/shared/types';
import { SNAPSHOT_DIR, readSnapshot } from './content-pull';
import { houseRules } from './house-rules';
import { packageErrors } from './migrate-to-sensei';

const enc = new TextEncoder();

/** Builds the studio's bundle from a committed course package snapshot: the standard's validator, then the house rules. */
export function buildContent(dir = SNAPSHOT_DIR): ContentBundle {
  const files = readSnapshot(dir);
  const errors = packageErrors(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, enc.encode(v)])));
  if (errors.length) throw new Error(`${dir}: the package fails validation (${errors.length} errors):\n${errors.join('\n')}`);
  const parsed = ContentBundleSchema.safeParse(packageToBundle(files));
  if (!parsed.success) throw new Error(`${dir}: ${parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')}`);
  const problems = houseRules(parsed.data as ContentBundle);
  if (problems.length) throw new Error(`${dir}: house rules:\n${problems.join('\n')}`);
  return parsed.data as ContentBundle;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const dir = process.env.CONTENT_DIR || SNAPSHOT_DIR;
  const bundle = buildContent(dir);
  mkdirSync('src/generated', { recursive: true });
  writeFileSync('src/generated/content.json', JSON.stringify(bundle, null, 2) + '\n');
  console.log(`content: ${Object.keys(bundle.lessons).length} lessons from ${dir}`);
}
