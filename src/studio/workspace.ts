import { runChecks } from '../shared/checks';
import type { LearningRecord } from '../shared/record';
import type { ContentBundle, Lesson, Preview } from '../shared/types';

/** The word for what a path builds, for copy that must not name one path. */
export function buildNoun(preview: Preview | undefined): 'theme' | 'plugin' | 'site' {
  return preview?.kind ?? 'theme';
}

const has = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

/** Every file a lesson supplies or tests: its starters, checkpoint file and planted-bug file. */
export function ownedFiles(l: Lesson): string[] {
  return [...Object.keys(l.starterFiles ?? {}), l.checkpoint?.file, l.bug?.file].filter((f): f is string => !!f);
}

function parses(text: string): boolean {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * The files to open a lesson with, from the lesson's own path only. Starts from the path's read-only `previewFiles`, then
 * applies each earlier lesson's starters. The R25 rule from `resolveFiles`, restricted to
 * earlier lessons: the learner's edit to a file wins only if it was made in the last earlier
 * lesson that owns the file, passes that lesson's checks for it, and, for .json, parses.
 * Then this lesson's starters, then this lesson's own saved edits.
 */
export function workspaceFiles(c: ContentBundle, r: LearningRecord, lessonId: string): { files: Record<string, string>; editable: string[] } {
  const current = c.lessons[lessonId];
  const path = current ? c.paths[current.pathId] : undefined;
  if (!path) return { files: {}, editable: [] };
  const upTo = path.lessons.indexOf(lessonId);
  const earlier = (upTo < 0 ? path.lessons : path.lessons.slice(0, upTo)).map((id) => c.lessons[id]).filter(Boolean);

  const files: Record<string, string> = { ...(path.previewFiles ?? {}) };
  const owner: Record<string, Lesson> = {};
  for (const l of earlier) {
    Object.assign(files, l.starterFiles ?? {});
    for (const f of ownedFiles(l)) owner[f] = l;
  }
  for (const [file, text] of Object.entries(r.files)) {
    if (!has(owner, file)) continue;
    const o = owner[file];
    const madeIn = r.fileLessons && has(r.fileLessons, file) ? r.fileLessons[file] : o.id;
    if (madeIn !== o.id) continue;
    if (file.endsWith('.json') && !parses(text)) continue;
    const checks = [...(o.checkpoint?.checks ?? []), ...(o.bug?.fixChecks ?? [])].filter((ch) => ch.file === file);
    if (runChecks(checks, { [file]: text }).passed) files[file] = text;
  }

  const editable = current ? ownedFiles(current) : [];
  Object.assign(files, current?.starterFiles ?? {});
  for (const f of editable) {
    if (has(r.files, f) && r.fileLessons && has(r.fileLessons, f) && r.fileLessons[f] === lessonId) files[f] = r.files[f];
  }
  return { files, editable };
}
