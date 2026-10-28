import { describe, it, expect, beforeEach } from 'vitest';
import { projectOfficial } from '../../src/shared/official';
import { buildContent } from '../../scripts/build-content';
import { auIdOf } from '../../functions/_lib/record/official';
import { ADL_VERBS, CMI5, CXM_EXT, CXM_VERBS, activityIds } from '../../vendor/course-xapi-mcp/core/constants';
import type { XapiStatement } from '../../vendor/course-xapi-mcp/core/xapi/types';
import type { ContentBundle } from '../../src/shared/types';

let bundle: ContentBundle;
let n = 0;
beforeEach(() => {
  bundle = buildContent('tests/fixtures/content');
});

const at = (i: number) => new Date(Date.UTC(2026, 9, 27, 12, 0, i)).toISOString();
const st = (verb: string, object: string, over: Partial<XapiStatement> = {}): XapiStatement =>
  ({
    id: `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`,
    actor: { account: { homePage: 'https://learnwp.sqwrlz.com', name: 'a1' } },
    verb: { id: verb },
    object: { objectType: 'Activity', id: object },
    context: { registration: 'r' },
    timestamp: at(n),
    ...over,
  }) as XapiStatement;
const au = (key: string) => activityIds.au(auIdOf(key));
const completed = (key: string) => st(ADL_VERBS.completed, au(key));
const waived = (key: string, ext: Record<string, unknown>) => st(ADL_VERBS.waived, au(key), { result: { extensions: ext } });
const testedOut = (key: string) => waived(key, { [CMI5.extReason]: 'Tested Out' });
const carriedOver = (key: string) => waived(key, { [CMI5.extReason]: 'Administrative', [CXM_EXT['carried-over']]: true });

describe('projectOfficial', () => {
  it('tested-out then completed counts as completed only', () => {
    const r = projectOfficial([testedOut('theme-json-basics'), completed('theme-json-basics')], bundle);
    expect(r.completed).toEqual(['theme-json-basics']);
    expect(r.testedOut).toEqual([]);
  });

  it('a tested-out waiver after completion does not undo it', () => {
    const r = projectOfficial([completed('theme-json-basics'), testedOut('theme-json-basics')], bundle);
    expect(r.completed).toEqual(['theme-json-basics']);
    expect(r.testedOut).toEqual([]);
  });

  it('carried-over never appears as completed or testedOut', () => {
    const r = projectOfficial([testedOut('patterns'), carriedOver('patterns'), carriedOver('theme-json-basics'), testedOut('theme-json-basics')], bundle);
    expect(r.carriedOver).toEqual(['theme-json-basics', 'patterns'].sort((a, b) => Object.keys(bundle.lessons).indexOf(a) - Object.keys(bundle.lessons).indexOf(b)));
    expect(r.completed).toEqual([]);
    expect(r.testedOut).toEqual([]);
  });

  it('lists branches and ignores a duplicate statement and other activities', () => {
    const b = st(CXM_VERBS.branched, 'https://learnwp.sqwrlz.com/activities/lessons/theme-json-basics/au/checkpoints/x', {
      context: { registration: 'r', contextActivities: { parent: [{ objectType: 'Activity', id: au('theme-json-basics') }] } },
      result: { extensions: { [CXM_EXT.branch]: 'skip', [CXM_EXT.to]: auIdOf('patterns') } },
    });
    const r = projectOfficial([b, b, st(ADL_VERBS.completed, 'https://example.com/other')], bundle, [], '2026-10-28T00:00:00.000Z');
    expect(r.branches).toEqual([{ from: 'theme-json-basics', to: 'patterns', outcome: 'skip' }]);
    expect(r.completed).toEqual([]);
    expect(r.asOf).toBe('2026-10-28T00:00:00.000Z');
  });
});
