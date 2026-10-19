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
});
