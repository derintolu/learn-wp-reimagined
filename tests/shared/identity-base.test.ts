import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { buildContent } from '../../scripts/build-content';
import { applyEvent, branchHistory, branchSkippedLessons, newRecord, parseRecord, type LearningRecord } from '../../src/shared/record';
import { LEGACY_XAPI_BASES, XAPI_BASE, currentIri, currentStatement, VERBS } from '../../src/shared/xapi';
import { COURSE_ACTIVITY_BASE, MCP_URL } from '../../src/shared/course-meta';
import { pastOutcome } from '../../src/components/CompletedSummary';

const OLD = 'https://learn-wp-reimagined.space.fast';
const NEW = 'https://learnwp.sqwrlz.com';

/** The same record as it was written before the base moved: every IRI under the old base. */
const asLegacy = (r: LearningRecord): LearningRecord => JSON.parse(JSON.stringify(r).replaceAll(NEW, OLD));

describe('identity base (ruling: the course moved to learnwp.sqwrlz.com)', () => {
  it('builds statements, activity IRIs and the connector URL on the new base', () => {
    expect(XAPI_BASE).toBe(NEW);
    expect(MCP_URL).toBe(`${NEW}/api/mcp`);
    expect(COURSE_ACTIVITY_BASE).toBe(`${NEW}/course`);
    expect(VERBS.branched.id).toBe(`${NEW}/xapi/verbs/branched`);
    expect(LEGACY_XAPI_BASES).toEqual([OLD]);
  });

  it('reads a legacy IRI as its current one and leaves everything else alone', () => {
    expect(currentIri(`${OLD}/activities/lessons/a`)).toBe(`${NEW}/activities/lessons/a`);
    expect(currentIri(OLD)).toBe(NEW);
    expect(currentIri('http://adlnet.gov/expapi/verbs/answered')).toBe('http://adlnet.gov/expapi/verbs/answered');
    expect(currentIri(`${OLD}.evil.example/x`)).toBe(`${OLD}.evil.example/x`);
    expect(currentIri(42)).toBe(42);
  });

  it('reads a legacy statement as current without changing the stored one', () => {
    const r = asLegacy(applyBranch('skip'));
    const st = r.statements.find((s) => s.verb.id === `${OLD}/xapi/verbs/branched`)!;
    const now = currentStatement(st);
    expect(now.verb.id).toBe(VERBS.branched.id);
    expect(now.object.id.startsWith(`${NEW}/activities/`)).toBe(true);
    expect(Object.keys(now.result!.extensions!).every((k) => k.startsWith(NEW))).toBe(true);
    expect(st.verb.id.startsWith(OLD)).toBe(true);
  });

  const c = buildContent(resolve(__dirname, '../fixtures/content'));
  const ids = c.paths['block-theme'].lessons;
  const withCp = ids.find((id) => c.lessons[id].checkpoint)!;
  function applyBranch(outcome: 'advance' | 'review' | 'skip'): LearningRecord {
    const branch = c.lessons[withCp].checkpoint!.branches.find((b) => b.outcome === outcome)!;
    return applyEvent(newRecord(), { type: 'checkpointAnswered', lessonId: withCp, response: 'ans', outcome, to: branch.to }, c);
  }

  it.each(['advance', 'review', 'skip'] as const)('a record made under the old base keeps its %s branch history', (outcome) => {
    const fresh = applyBranch(outcome);
    const legacy = asLegacy(fresh);
    expect(parseRecord(legacy).ok).toBe(true);
    expect(branchHistory(fresh)).toHaveLength(1);
    expect(branchHistory(legacy)).toEqual(branchHistory(fresh));
    expect(branchSkippedLessons(legacy, c, 'block-theme')).toEqual(branchSkippedLessons(fresh, c, 'block-theme'));
    expect(pastOutcome(legacy, withCp)).toBe(outcome);
  });
});
