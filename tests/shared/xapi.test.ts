import { describe, expect, it } from 'vitest';
import { XAPI_BASE, buildStatement, validateStatement, type VerbKey } from '../../src/shared/xapi';

const verbs: VerbKey[] = ['experienced', 'answered', 'passed', 'failed', 'completed', 'branched'];
const input = (verb: VerbKey) => ({ learnerId: 'learner-1', verb, activityPath: ['lessons', 'a'], name: 'Lesson A' });

describe('buildStatement', () => {
  it.each(verbs)('builds a valid %s statement', (verb) => {
    const s = buildStatement(input(verb));
    expect(validateStatement(s)).toEqual([]);
    expect(s.object.id).toBe(`${XAPI_BASE}/activities/lessons/a`);
  });
  it('uses ADL IRIs and the custom branched IRI', () => {
    expect(buildStatement(input('passed')).verb.id).toBe('http://adlnet.gov/expapi/verbs/passed');
    expect(buildStatement(input('branched')).verb.id).toBe(`${XAPI_BASE}/xapi/verbs/branched`);
  });
  it('has an anonymous account actor', () => {
    const s = buildStatement(input('experienced'));
    expect(s.actor).toEqual({ objectType: 'Agent', account: { homePage: XAPI_BASE, name: 'learner-1' } });
  });
  it('adds parent context and result', () => {
    const s = buildStatement({ ...input('answered'), parent: ['paths', 'block-theme'], result: { response: 'hi' } });
    expect(s.context?.contextActivities?.parent?.[0].id).toBe(`${XAPI_BASE}/activities/paths/block-theme`);
    expect(s.result?.response).toBe('hi');
  });
});

describe('validateStatement', () => {
  it('flags a missing verb id', () => {
    const s = buildStatement(input('passed')) as any;
    delete s.verb.id;
    expect(validateStatement(s).join()).toMatch(/verb/);
  });
  it('flags a non-IRI object id', () => {
    const s = buildStatement(input('passed')) as any;
    s.object.id = 'not an iri';
    expect(validateStatement(s).join()).toMatch(/object/);
  });
  it('rejects non-objects', () => {
    expect(validateStatement(null).length).toBeGreaterThan(0);
  });
  const base = () => buildStatement({ ...input('answered'), parent: ['paths', 'p'], result: { response: 'r' } }) as any;
  it.each([
    ['verb.display not a language map', (s: any) => { s.verb.display = { 'en-US': 5 }; }, /display/],
    ['verb.display empty key', (s: any) => { s.verb.display = { '': 'x' }; }, /display/],
    ['object.objectType wrong', (s: any) => { s.object.objectType = 'Agent'; }, /objectType/],
    ['result.success not boolean', (s: any) => { s.result.success = 'yes'; }, /success/],
    ['result.completion not boolean', (s: any) => { s.result.completion = 1; }, /completion/],
    ['result.response not string', (s: any) => { s.result.response = 5; }, /response/],
    ['result extension key not IRI', (s: any) => { s.result.extensions = { outcome: 'x' }; }, /extensions/],
    ['context extension key not IRI', (s: any) => { s.context.extensions = { bad: 1 }; }, /extensions/],
    ['parent id not IRI', (s: any) => { s.context.contextActivities.parent[0].id = 'nope'; }, /parent/],
    ['parent objectType wrong', (s: any) => { s.context.contextActivities.parent[0].objectType = 'Agent'; }, /parent/],
    ['timestamp without timezone', (s: any) => { s.timestamp = '2026-10-19T12:00:00'; }, /timestamp/],
    ['timestamp not ISO', (s: any) => { s.timestamp = 'Oct 19 2026'; }, /timestamp/],
    ['unknown top-level property', (s: any) => { s.mbox = 'x'; }, /unknown property/],
  ])('flags %s', (_n, mutate, re) => {
    const s = base();
    mutate(s);
    expect(validateStatement(s).join()).toMatch(re);
  });
  it('accepts a well-formed statement with context and result', () => {
    expect(validateStatement(base())).toEqual([]);
  });
});
