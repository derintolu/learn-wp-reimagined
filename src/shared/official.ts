// The learner's official record as the course shows it: a projection of the cmi5 statements the LRS holds for
// their registration (Task 34). Pure; the LRS stays the source of truth.
import type { BadgeSummary } from '../../functions/_lib/lrs/client';
import { ADL_VERBS, CMI5, CXM_EXT, CXM_VERBS } from '../../vendor/course-xapi-mcp/core/constants';
import type { XapiStatement } from '../../vendor/course-xapi-mcp/core/xapi/types';
import { activityId, currentIri } from './xapi';
import type { ContentBundle, Outcome } from './types';

export interface OfficialRecord {
  /** Lessons with a completed statement. */
  completed: string[];
  /** Lessons waived Tested Out and not completed since. */
  testedOut: string[];
  /** Lessons carried over from the local record (waived Administrative). Never counted as completed or tested out. */
  carriedOver: string[];
  branches: { from: string; to: string; outcome: Outcome }[];
  badges: BadgeSummary[];
  asOf: string;
}

const OUTCOMES: readonly string[] = ['advance', 'review', 'skip'];
const stamp = (s: XapiStatement) => s.timestamp ?? (s as { stored?: string }).stored ?? '';

export function projectOfficial(statements: XapiStatement[], bundle: ContentBundle, badges: BadgeSummary[] = [], asOf?: string): OfficialRecord {
  // `{au@id}/au` and the bare au@id (the branch extensions) to the lesson key.
  const lessonOf = new Map<string, string>();
  for (const id of Object.keys(bundle.lessons)) {
    const au = activityId(['lessons', id]);
    lessonOf.set(au, id);
    lessonOf.set(`${au}/au`, id);
  }
  const lesson = (iri: unknown) => (typeof iri === 'string' ? lessonOf.get(currentIri(iri)) : undefined);

  const seen = new Set<string>();
  const ordered = statements
    .filter((s) => !seen.has(s.id) && seen.add(s.id))
    .sort((a, b) => stamp(a).localeCompare(stamp(b)) || a.id.localeCompare(b.id));

  const completed = new Set<string>();
  const tested = new Set<string>();
  const carried = new Set<string>();
  const branches: OfficialRecord['branches'] = [];
  let latest = '';

  for (const s of ordered) {
    if (stamp(s) > latest) latest = stamp(s);
    const verb = currentIri(s.verb.id);
    const ext = { ...s.context?.extensions, ...s.result?.extensions };
    if (verb === ADL_VERBS.completed) {
      const key = lesson(s.object.id);
      if (key) {
        completed.add(key);
        tested.delete(key);
        carried.delete(key);
      }
    } else if (verb === ADL_VERBS.waived) {
      const key = lesson(s.object.id);
      if (!key || completed.has(key)) continue;
      if (CXM_EXT['carried-over'] in ext) {
        carried.add(key);
        tested.delete(key);
      } else if (ext[CMI5.extReason] === 'Tested Out' && !carried.has(key)) tested.add(key);
    } else if (verb === CXM_VERBS.branched) {
      const outcome = s.result?.extensions?.[CXM_EXT.branch];
      const from = lesson(s.context?.contextActivities?.parent?.[0]?.id);
      const to = lesson(s.result?.extensions?.[CXM_EXT.to]);
      if (from && to && typeof outcome === 'string' && OUTCOMES.includes(outcome)) branches.push({ from, to, outcome: outcome as Outcome });
    }
  }

  const inOrder = (set: Set<string>) => Object.keys(bundle.lessons).filter((k) => set.has(k));
  return {
    completed: inOrder(completed),
    testedOut: inOrder(tested),
    carriedOver: inOrder(carried),
    branches,
    badges,
    asOf: asOf ?? (latest || new Date(0).toISOString()),
  };
}
