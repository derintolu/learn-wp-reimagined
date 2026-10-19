import type { Branch, ContentBundle, Outcome, PathId } from './types';

export interface Placement { pathId: PathId; startLessonId: string; skip: string[]; reason: string }

export function validatePlacement(
  c: ContentBundle,
  raw: unknown,
): { ok: true; placement: Placement } | { ok: false; error: string } {
  const fail = (error: string) => ({ ok: false as const, error });
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return fail('placement must be an object');
  const r = raw as Record<string, unknown>;
  if (typeof r.pathId !== 'string' || !Object.prototype.hasOwnProperty.call(c.paths, r.pathId)) return fail('unknown path');
  const path = c.paths[r.pathId as PathId];
  if (path.status !== 'live') return fail('path is not live');
  if (typeof r.startLessonId !== 'string') return fail('startLessonId must be a string');
  const startIdx = path.lessons.indexOf(r.startLessonId);
  if (startIdx < 0) return fail('startLessonId is not in the path');
  if (!Array.isArray(r.skip) || !r.skip.every((s) => typeof s === 'string')) return fail('skip must be an array of lesson ids');
  const before = new Set(path.lessons.slice(0, startIdx));
  if (!r.skip.every((s) => before.has(s as string))) return fail('skip may only contain lessons before the start lesson');
  if (typeof r.reason !== 'string' || r.reason.length === 0 || r.reason.length > 300) {
    return fail('reason must be 1 to 300 characters');
  }
  return {
    ok: true,
    placement: { pathId: path.id, startLessonId: r.startLessonId, skip: [...(r.skip as string[])], reason: r.reason },
  };
}

export function resolveBranch(c: ContentBundle, lessonId: string, outcome: Outcome): Branch {
  const cp = Object.prototype.hasOwnProperty.call(c.lessons, lessonId) ? c.lessons[lessonId].checkpoint : undefined;
  if (!cp) throw new Error(`lesson "${lessonId}" has no checkpoint`);
  const branch = cp.branches.find((b) => b.outcome === outcome);
  if (!branch) throw new Error(`lesson "${lessonId}" has no "${outcome}" branch`);
  return branch;
}

export function nextLessonId(
  c: ContentBundle,
  pathId: PathId,
  afterLessonId: string | null,
  skip: string[],
): string | null {
  const lessons = c.paths[pathId].lessons;
  const start = afterLessonId === null ? 0 : lessons.indexOf(afterLessonId) + 1;
  if (afterLessonId !== null && start === 0) return null;
  for (let i = start; i < lessons.length; i++) if (!skip.includes(lessons[i])) return lessons[i];
  return null;
}
