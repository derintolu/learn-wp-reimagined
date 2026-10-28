// The studio's own rules on top of the standard's validator: what a course needs to work as this studio's paths.
import { runChecks } from '../src/shared/checks';
import type { ContentBundle, Outcome } from '../src/shared/types';

const OUTCOMES: Outcome[] = ['advance', 'review', 'skip'];

/** Problems with a bundle, one line each; empty when the bundle follows the house rules. */
export function houseRules(b: ContentBundle): string[] {
  const out: string[] = [];
  const owner = new Map<string, string>();
  for (const l of Object.values(b.lessons)) {
    if (l.sources.length < 1) out.push(`lesson "${l.id}" needs at least one source`);
    if (!l.checkpoint) continue;
    for (const o of OUTCOMES) {
      if (!l.checkpoint.branches.some((br) => br.outcome === o)) out.push(`lesson "${l.id}" checkpoint "${l.checkpoint.id}" is missing the ${o} branch`);
    }
  }
  for (const p of Object.values(b.paths)) {
    if (p.status !== 'live') continue;
    const lessons = p.lessons.map((id) => b.lessons[id]).filter((l) => !!l);
    const checkpoints = lessons.filter((l) => l.checkpoint).length;
    if (checkpoints < 2) out.push(`path "${p.id}" needs at least 2 checkpoints, found ${checkpoints}`);
    if (!p.preview) out.push(`path "${p.id}" needs a preview`);
    const owned = new Set(
      [
        ...lessons.flatMap((l) => [...Object.keys(l.starterFiles ?? {}), l.checkpoint?.file, l.bug?.file]),
        ...Object.keys(p.previewFiles ?? {}),
        ...Object.keys(p.finalFiles ?? {}),
      ].filter((f): f is string => !!f),
    );
    for (const f of owned) {
      const other = owner.get(f);
      if (other && other !== p.id) out.push(`file "${f}" is owned by both "${other}" and "${p.id}"; live paths may not share file names`);
      else owner.set(f, p.id);
    }
    const finalFiles = p.finalFiles ?? {};
    for (const l of lessons) {
      const checks = [...(l.checkpoint?.checks ?? []), ...(l.bug?.fixChecks ?? [])].filter((c) => Object.hasOwn(finalFiles, c.file));
      for (const { check, passed } of runChecks(checks, finalFiles).results) {
        if (!passed) out.push(`path "${p.id}" finalFiles ${check.file} fails a check in lesson "${l.id}": ${check.message}`);
      }
    }
  }
  return out;
}
