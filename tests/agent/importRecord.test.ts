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
import { XAPI_BASE, activityId } from '../../src/shared/xapi';
import { COURSE_ID } from '../../src/shared/course-meta';
import { getStandardCourse } from '../../functions/_lib/mcp/standardCourse';
import { PRACTICE_FORMAT, PRACTICE_VERSION, newPracticeHandle, type PracticeRecord } from '../../vendor/course-xapi-mcp/core/practice-record.ts';
import { PRACTICE_HOMEPAGE, PRACTICE_LABEL } from '../../vendor/course-xapi-mcp/core/constants.ts';
import * as std from '../../vendor/course-xapi-mcp/core/session/index.ts';
import type { XapiStatement as StdStatement } from '../../vendor/course-xapi-mcp/core/xapi/types.ts';

const content = buildContent();
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

  it('imports an agent record made before the identity base moved exactly as a current one', () => {
    const OLD = 'https://learn-wp-reimagined.space.fast';
    const run = agentRun();
    const legacy = JSON.parse(JSON.stringify(run).replaceAll(XAPI_BASE, OLD)) as McpRecord;
    expect(JSON.stringify(legacy)).toContain(`${OLD}/course/lessons/`);
    const a = planImport(newRecord(), run, content);
    const b = planImport(newRecord(), legacy, content);
    if (!a.ok || !b.ok) throw new Error('plan failed');
    expect(b.plan.summary).toEqual(a.plan.summary);
    expect(b.plan.ignored).toEqual(a.plan.ignored);
    // A site record from before the move still counts as having answered that checkpoint.
    let site = siteAt('bt-what-is-a-block-theme');
    site = applyEvent(site, { type: 'checkpointAnswered', lessonId: 'bt-what-is-a-block-theme', response: 'Mine.', outcome: 'advance', to: 'bt-style-css-and-theme-json' }, content);
    const oldSite = JSON.parse(JSON.stringify(site).replaceAll(XAPI_BASE, OLD)) as LearningRecord;
    const c1 = planImport(site, run, content);
    const c2 = planImport(oldSite, run, content);
    if (!c1.ok || !c2.ok) throw new Error('plan failed');
    expect(c2.plan.summary).toEqual(c1.plan.summary);
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

  it('a file conflict previews the lines where the versions start to differ', () => {
    const agent = agentRun();
    const theirs = agent.courses[COURSE_ID].files['theme.json'];
    const lines = theirs.split('\n');
    const mine = [...lines.slice(0, 4), 'MINE', ...lines.slice(5)].join('\n');
    const site = applyEvent(newRecord(), { type: 'fileEdited', file: 'theme.json', content: mine }, content);
    const p = planImport(site, agent, content);
    if (!p.ok) throw new Error(p.error);
    const c = p.plan.conflicts.find((x) => x.key === 'file:theme.json')!;
    expect(c.site.startsWith('line 5:\nMINE')).toBe(true);
    expect(c.agent.startsWith(`line 5:\n${lines[4]}`)).toBe(true);
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
    expect(ig).toMatch(/beats taught in your AI: \d+/);
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

// ---------------------------------------------------------------------------
// The same run on the course-xapi-mcp reference server (/api/mcp with SERVER_FLAGS.mcpOnStandard): its
// practice copy, as /api/agent/record returns it.

function practiceRun(answer = 'style.css and templates/index.html'): PracticeRecord {
  const c = ctx();
  const model = getStandardCourse();
  const actor = { objectType: 'Agent' as const, account: { homePage: PRACTICE_HOMEPAGE, name: '00000000-0000-4000-8000-0000000000aa' } };
  const env: std.Env = { now: c.now, uuid: c.uuid, actor, custody: 'practice', practice: true };
  const statements: StdStatement[] = [];
  const run = <T extends std.Step<object>>(r: T) => {
    const s = ok(r as std.Step<object>);
    statements.push(...s.statements);
    return s;
  };
  let s = run(std.startPlacement(model, undefined, env));
  s = run(std.choosePlacement(model, s.state, { pathKey: 'block-theme', startLessonKey: 'bt-what-is-a-block-theme', skip: [], reason: 'New to themes.' }, env));
  s = run(std.nextBeat(model, s.state, {}, env));
  for (let i = 0; i < 20 && (s.data as { step: string }).step === 'beat'; i++) {
    const q = (s.data as { beat: { question: string | null } }).beat.question;
    s = run(std.nextBeat(model, s.state, q ? { learner_reply: 'A reply.' } : {}, env));
  }
  s = run(std.checkCode(model, s.state, { file: 'theme.json', content: final['theme.json'] }, env));
  s = run(std.nextBeat(model, s.state, {}, env));
  s = run(std.submitCheckpoint(model, s.state, { response: answer }, env));
  s = run(std.chooseBranch(model, s.state, { branch: 'advance', rationale: 'Meets the rubric.' }, env));
  s = run(std.nextBeat(model, s.state, {}, env));
  const state = s.state;
  return {
    format: PRACTICE_FORMAT,
    version: PRACTICE_VERSION,
    official: false,
    label: PRACTICE_LABEL,
    courseId: model.id,
    actor,
    createdAt: state.createdAt,
    updatedAt: state.updatedAt,
    state,
    statements,
  };
}

describe('planImport of a practice copy from the standard', () => {
  it('imports exactly what the same run on today\'s server imports', () => {
    const fromLegacy = ok(planImport(newRecord(), agentRun(), content));
    const fromStandard = ok(planImport(newRecord(), JSON.parse(JSON.stringify(practiceRun())), content));
    expect(fromStandard.plan.summary).toEqual({ lessons: 1, checkpoints: 1, files: 1 });
    expect(fromStandard.plan.conflicts).toEqual([]);
    const a = applyImport(newRecord(), fromLegacy.plan, new Set(), content);
    const b = applyImport(newRecord(), fromStandard.plan, new Set(), content);
    const shape = (r: LearningRecord) => ({
      completedLessons: r.completedLessons,
      files: r.files,
      fileLessons: r.fileLessons,
      current: r.current,
      placement: r.placement,
      statements: r.statements.map((s) => [s.verb.id, s.object.id, s.result?.response ?? null, s.result?.success ?? null]),
    });
    expect(shape(b)).toEqual(shape(a));
  });

  it('a practice copy for another course or with a damaged statement is refused with the reason', () => {
    const other = { ...practiceRun(), courseId: 'https://example.org/course' };
    const r = planImport(newRecord(), other, content);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toContain('another course');
    const copy = practiceRun();
    copy.statements[0] = { ...copy.statements[0], actor: { objectType: 'Agent', account: { homePage: PRACTICE_HOMEPAGE, name: 'someone-else' } } };
    const bad = planImport(newRecord(), copy, content);
    expect(bad.ok).toBe(false);
  });
});

describe('classifyPaste on the standard', () => {
  it('takes a practice handle as a handle', () => {
    const h = newPracticeHandle();
    expect(classifyPaste(` ${h}\n`)).toEqual({ kind: 'handle', handle: h });
    expect(classifyPaste('cxp_short').kind).toBe('invalid');
  });
});
