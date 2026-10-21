import { describe, expect, it } from 'vitest';
import { buildContent } from '../../scripts/build-content';
import { buildCourse } from '../../functions/_lib/mcp/course';
import { applyImport, classifyPaste, planImport, INVALID_PASTE, NO_PROGRESS } from '../../src/agent/importRecord';
import {
  checkCode,
  chooseBranch,
  choosePlacement,
  newHandle,
  nextBeat,
  startPlacement,
  submitCheckpoint,
  type Ctx,
  type LearningRecord as McpRecord,
} from '../../vendor/learning-mcp/core/index.ts';
import { applyEvent, newRecord, parseRecord, type LearningRecord } from '../../src/shared/record';
import { activityId } from '../../src/shared/xapi';
import { COURSE_ID } from '../../src/shared/course-meta';

const content = buildContent('content');
const course = buildCourse(content);
const final = content.paths['block-theme'].finalFiles!;

function ctx(): Ctx {
  let n = 0;
  let t = Date.parse('2026-10-20T10:00:00.000Z');
  return { now: () => new Date((t += 1000)).toISOString(), uuid: () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}` };
}

function ok<T extends { ok: boolean }>(r: T): Extract<T, { ok: true }> {
  if (!r.ok) throw new Error((r as unknown as { error: string }).error);
  return r as Extract<T, { ok: true }>;
}

/** An agent that places the learner at lesson 1, teaches it, catches the bug and advances. */
function agentRun(answer = 'style.css and templates/index.html'): McpRecord {
  const c = ctx();
  let r = startPlacement(course, undefined, c).record;
  r = ok(choosePlacement(course, r, { pathId: 'block-theme', startLessonId: 'bt-what-is-a-block-theme', skip: [], reason: 'New to themes.' }, c)).record;
  let step = ok(nextBeat(course, r, {}, c));
  r = step.record;
  for (let i = 0; i < 20 && (step.data as { step: string }).step === 'beat'; i++) {
    const q = (step.data as { beat: { question: string | null } }).beat.question;
    step = ok(nextBeat(course, r, q ? { learner_reply: 'A reply.' } : {}, c));
    r = step.record;
  }
  r = ok(checkCode(course, r, { file: 'theme.json', content: final['theme.json'] }, c)).record;
  r = ok(nextBeat(course, r, {}, c)).record;
  r = ok(submitCheckpoint(course, r, { response: answer }, c)).record;
  r = ok(chooseBranch(course, r, { branch: 'advance', rationale: 'Meets the rubric.' }, c)).record;
  r = ok(nextBeat(course, r, {}, c)).record; // first beat of lesson 2
  return r;
}

const siteAt = (lessonId: string, beatIndex = 0): LearningRecord => applyEvent(newRecord(), { type: 'beatViewed', lessonId, beatIndex }, content);

describe('planImport and applyImport', () => {
  it('imports a fresh agent run into an empty site record', () => {
    const site = newRecord();
    const p = planImport(site, agentRun(), content);
    if (!p.ok) throw new Error(p.error);
    expect(p.plan.conflicts).toEqual([]);
    expect(p.plan.summary).toEqual({ lessons: 1, checkpoints: 1, files: 1 });
    const out = applyImport(site, p.plan, new Set(), content);
    expect(out.completedLessons).toEqual(['bt-what-is-a-block-theme']);
    expect(out.files['theme.json']).toBe(final['theme.json']);
    expect(out.fileLessons?.['theme.json']).toBe('bt-what-is-a-block-theme');
    expect(out.current).toEqual({ pathId: 'block-theme', lessonId: 'bt-style-css-and-theme-json', beatIndex: 0 });
    expect(out.placement?.startLessonId).toBe('bt-what-is-a-block-theme');
    const answered = out.statements.find((s) => s.verb.id.endsWith('/answered') && s.object.id === activityId(['lessons', 'bt-what-is-a-block-theme', 'checkpoint']));
    expect(answered?.result?.response).toBe('style.css and templates/index.html');
    const branched = out.statements.find((s) => s.verb.id.endsWith('/branched'));
    expect(branched?.object.id).toBe(activityId(['lessons', 'bt-style-css-and-theme-json']));
    expect(out.statements.some((s) => s.object.id === activityId(['lessons', 'bt-what-is-a-block-theme', 'files', 'theme.json']) && s.result?.success === true)).toBe(true);
  });

  it('does not duplicate a checkpoint already answered on the site', () => {
    let site = siteAt('bt-what-is-a-block-theme');
    site = applyEvent(site, { type: 'checkpointAnswered', lessonId: 'bt-what-is-a-block-theme', response: 'Mine.', outcome: 'advance', to: 'bt-style-css-and-theme-json' }, content);
    const p = planImport(site, agentRun(), content);
    if (!p.ok) throw new Error(p.error);
    expect(p.plan.events.filter((e) => e.type === 'checkpointAnswered')).toEqual([]);
    expect(p.plan.ignored).toContain('already answered on the site: bt-what-is-a-block-theme');
  });

  it('a differing file and position become conflicts and are not applied unless accepted', () => {
    let site = siteAt('bt-patterns', 1);
    site = applyEvent(site, { type: 'fileEdited', file: 'theme.json', content: '{"mine":true}', lessonId: 'bt-global-styles' }, content);
    const p = planImport(site, agentRun(), content);
    if (!p.ok) throw new Error(p.error);
    expect(p.plan.conflicts.map((c) => c.key).sort()).toEqual(['file:theme.json', 'position']);
    const out = applyImport(site, p.plan, new Set(), content);
    expect(out.current).toEqual(site.current);
    expect(out.files['theme.json']).toBe('{"mine":true}');
    expect(out.completedLessons).toEqual(['bt-what-is-a-block-theme']);
  });

  it('accepted conflicts are applied', () => {
    let site = siteAt('bt-patterns', 1);
    site = applyEvent(site, { type: 'fileEdited', file: 'theme.json', content: '{"mine":true}' }, content);
    site = applyEvent(site, { type: 'placed', placement: { pathId: 'block-theme', startLessonId: 'bt-patterns', skip: [], reason: 'x' } }, content);
    const p = planImport(site, agentRun(), content);
    if (!p.ok) throw new Error(p.error);
    expect(p.plan.conflicts.map((c) => c.key).sort()).toEqual(['file:theme.json', 'placement', 'position']);
    const out = applyImport(site, p.plan, new Set(['file:theme.json', 'position', 'placement']), content);
    expect(out.files['theme.json']).toBe(final['theme.json']);
    expect(out.current?.lessonId).toBe('bt-style-css-and-theme-json');
    expect(out.placement?.startLessonId).toBe('bt-what-is-a-block-theme');
  });

  it('ignores other courses, unknown lessons, beat replies and caught bugs, and lists them', () => {
    const agent = agentRun();
    agent.courses['other-course'] = { courseVersion: '1.0.0', registration: 'r', completedLessons: ['x'], caughtBugs: [], files: {} };
    agent.courses[COURSE_ID].completedLessons.push('bt-gone');
    agent.courses[COURSE_ID].files['evil.php'] = '<?php';
    const p = planImport(newRecord(), agent, content);
    if (!p.ok) throw new Error(p.error);
    const ig = p.plan.ignored.join('\n');
    expect(ig).toContain('other course: other-course');
    expect(ig).toContain('unknown lesson: bt-gone');
    expect(ig).toContain('file not in the course: evil.php');
    expect(ig).toMatch(/beat replies: \d+/);
    expect(ig).toMatch(/planted bugs caught: 1/);
    expect(ig).toMatch(/beats taught in the agent: \d+/);
  });

  it("rejects a site record, a newer version and another learner's statement with the parser's message", () => {
    const site = siteAt('bt-patterns');
    const before = JSON.stringify(site);
    expect(planImport(site, site, content)).toEqual({ ok: false, error: 'not a learning-mcp/record file' });
    expect(planImport(site, { ...agentRun(), version: 2 }, content)).toEqual({ ok: false, error: 'this record was made by a newer version' });
    const other = agentRun();
    other.statements[0] = { ...other.statements[0], actor: { ...other.statements[0].actor, account: { ...other.statements[0].actor.account, name: 'someone-else' } } };
    expect(planImport(site, other, content)).toEqual({ ok: false, error: 'statement 0 belongs to another learner' });
    const empty = startPlacement(course, undefined, ctx()).record;
    delete (empty.courses as Record<string, unknown>)[COURSE_ID];
    expect(planImport(site, empty, content)).toEqual({ ok: false, error: NO_PROGRESS });
    expect(JSON.stringify(site)).toBe(before);
  });

  it("the result passes the site's parseRecord, and the site's statements are an unchanged prefix", () => {
    const site = siteAt('bt-patterns', 2);
    const p = planImport(site, agentRun(), content);
    if (!p.ok) throw new Error(p.error);
    const out = applyImport(site, p.plan, new Set(['position']), content);
    expect(parseRecord(JSON.parse(JSON.stringify(out))).ok).toBe(true);
    expect(out.statements.slice(0, site.statements.length)).toEqual(site.statements);
    expect(out.learnerId).toBe(site.learnerId);
  });
});

describe('classifyPaste', () => {
  it('tells a handle from JSON and from anything else', () => {
    const h = newHandle();
    expect(classifyPaste(`  ${h}\n`)).toEqual({ kind: 'handle', handle: h });
    expect(classifyPaste(' {"a":1} ')).toEqual({ kind: 'json', value: { a: 1 } });
    for (const bad of ['{broken', 'hello', '', 'lr_short']) expect(classifyPaste(bad)).toEqual({ kind: 'invalid', message: INVALID_PASTE });
  });
});
