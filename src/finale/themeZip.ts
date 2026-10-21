import { strToU8, zipSync } from 'fflate';
import { runChecks } from '../shared/checks';
import type { LearningRecord } from '../shared/record';
import type { ContentBundle, Lesson } from '../shared/types';
import { ownedFiles } from '../studio/workspace';

/** The theme's folder name, matching the Text Domain in the starter style.css. */
export const THEME_SLUG = 'my-block-theme';

const PATH_ID = 'block-theme';
const has = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

export interface ResolvedTheme {
  files: Record<string, string>;
  /** Files where the learner's own edit was used. */
  used: string[];
  /** Learner edits that were set aside, with a note saying why. */
  replaced: { file: string; message: string }[];
}

/**
 * R25: for each file, the learner's edit wins only if it was made in the last lesson
 * (in path order) that owns the file, passes that lesson's checks for it, and, for
 * .json, parses. Edits from before lessonIds were recorded count as made in that lesson.
 * Otherwise the path's finished `finalFiles` version is used, else the latest starter.
 * Only files a lesson owns or `finalFiles` lists are included.
 */
export function resolveTheme(c: ContentBundle, r: LearningRecord): ResolvedTheme {
  const path = c.paths[PATH_ID];
  const lessons = (path?.lessons ?? []).map((id) => c.lessons[id]).filter(Boolean);
  const files: Record<string, string> = {};
  const owner: Record<string, { lesson: Lesson; n: number }> = {};
  lessons.forEach((l, i) => {
    Object.assign(files, l.starterFiles ?? {});
    for (const f of ownedFiles(l)) owner[f] = { lesson: l, n: i + 1 };
  });
  Object.assign(files, path?.finalFiles ?? {});

  const used: string[] = [];
  const replaced: ResolvedTheme['replaced'] = [];
  for (const [file, text] of Object.entries(r.files)) {
    const o = has(owner, file) ? owner[file] : undefined;
    if (!o) continue; // not part of this theme
    const finished = path?.finalFiles && has(path.finalFiles, file) ? 'the finished version' : 'the starter version';
    const madeIn = r.fileLessons && has(r.fileLessons, file) ? r.fileLessons[file] : o.lesson.id;
    let why: string | null = null;
    if (madeIn !== o.lesson.id) {
      why = `lesson ${o.n} changes it after the copy you edited`;
    } else if (file.endsWith('.json') && !parses(text)) {
      why = "your copy isn't valid JSON";
    } else {
      const checks = [...(o.lesson.checkpoint?.checks ?? []), ...(o.lesson.bug?.fixChecks ?? [])].filter((ch) => ch.file === file);
      if (!runChecks(checks, { [file]: text }).passed) why = `your copy didn't pass lesson ${o.n}'s checks`;
    }
    if (why) {
      replaced.push({ file, message: `We used ${finished} of ${file} because ${why}.` });
    } else {
      files[file] = text;
      used.push(file);
    }
  }
  return { files, used, replaced };
}

function parses(text: string): boolean {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

export function buildThemeFiles(c: ContentBundle, r: LearningRecord): Record<string, string> {
  return resolveTheme(c, r).files;
}

/** A zip of the theme with every file under `my-block-theme/`, ready for Upload Theme. */
export function themeZip(files: Record<string, string>): Uint8Array {
  const entries: Record<string, Uint8Array> = {};
  for (const [p, data] of Object.entries(files)) entries[`${THEME_SLUG}/${p}`] = strToU8(data);
  return zipSync(entries, { level: 6 });
}
