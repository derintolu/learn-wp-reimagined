import { strToU8, zipSync } from 'fflate';
import type { LearningRecord } from '../shared/record';
import type { ContentBundle } from '../shared/types';

/** The theme's folder name, matching the Text Domain in the starter style.css. */
export const THEME_SLUG = 'my-block-theme';

/** Theme-relative paths only: no leading slash, no `..` or empty segments. */
function safePath(p: string): boolean {
  if (!/^[A-Za-z0-9._\-/]+$/.test(p)) return false;
  return p.split('/').every((seg) => seg !== '' && seg !== '.' && seg !== '..');
}

/**
 * R24: the starter files in path lesson order (later lessons win), then the learner's
 * edits over everything. Every lesson's starters count, so skipping a lesson leaves no gap.
 */
export function buildThemeFiles(c: ContentBundle, r: LearningRecord): Record<string, string> {
  const out: Record<string, string> = {};
  for (const id of c.paths['block-theme']?.lessons ?? []) {
    Object.assign(out, c.lessons[id]?.starterFiles ?? {});
  }
  Object.assign(out, r.files);
  for (const p of Object.keys(out)) if (!safePath(p)) delete out[p];
  return out;
}

/** A zip of the theme with every file under `my-block-theme/`, ready for Upload Theme. */
export function themeZip(files: Record<string, string>): Uint8Array {
  const entries: Record<string, Uint8Array> = {};
  for (const [p, data] of Object.entries(files)) entries[`${THEME_SLUG}/${p}`] = strToU8(data);
  return zipSync(entries, { level: 6 });
}
