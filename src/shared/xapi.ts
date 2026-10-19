export const XAPI_BASE = 'https://learn-wp-reimagined.space.fast';

// Target: IEEE 9274.1.1-2023 (xAPI 2.0). See docs/record-format.md.
export const XAPI_VERSION = '2.0.0';

export type VerbKey = 'experienced' | 'answered' | 'passed' | 'failed' | 'completed' | 'branched';

const ADL = 'http://adlnet.gov/expapi/verbs';
export const VERBS: Record<VerbKey, { id: string; display: string }> = {
  experienced: { id: `${ADL}/experienced`, display: 'experienced' },
  answered: { id: `${ADL}/answered`, display: 'answered' },
  passed: { id: `${ADL}/passed`, display: 'passed' },
  failed: { id: `${ADL}/failed`, display: 'failed' },
  completed: { id: `${ADL}/completed`, display: 'completed' },
  branched: { id: `${XAPI_BASE}/xapi/verbs/branched`, display: 'branched' },
};

export interface XapiResult {
  success?: boolean;
  completion?: boolean;
  response?: string;
  extensions?: Record<string, unknown>;
}

interface XapiActivityRef { objectType: 'Activity'; id: string; definition?: { name: Record<string, string> } }

export interface XapiStatement {
  id: string;
  actor: { objectType: 'Agent'; account: { homePage: string; name: string } };
  verb: { id: string; display: Record<string, string> };
  object: XapiActivityRef;
  result?: XapiResult;
  context?: { contextActivities?: { parent?: XapiActivityRef[] } };
  timestamp: string;
  version: string;
}

export const activityId = (segments: string[]) => `${XAPI_BASE}/activities/${segments.join('/')}`;

export function buildStatement(input: {
  learnerId: string;
  verb: VerbKey;
  activityPath: string[];
  name: string;
  result?: XapiResult;
  parent?: string[];
}): XapiStatement {
  const v = VERBS[input.verb];
  const s: XapiStatement = {
    id: crypto.randomUUID(),
    actor: { objectType: 'Agent', account: { homePage: XAPI_BASE, name: input.learnerId } },
    verb: { id: v.id, display: { 'en-US': v.display } },
    object: {
      objectType: 'Activity',
      id: activityId(input.activityPath),
      definition: { name: { 'en-US': input.name } },
    },
    timestamp: new Date().toISOString(),
    version: XAPI_VERSION,
  };
  if (input.result) s.result = input.result;
  if (input.parent) {
    s.context = { contextActivities: { parent: [{ objectType: 'Activity', id: activityId(input.parent) }] } };
  }
  return s;
}

function isIri(v: unknown): boolean {
  if (typeof v !== 'string' || /\s/.test(v)) return false;
  return /^[a-zA-Z][a-zA-Z0-9+.-]*:[^\s]+$/.test(v);
}

const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);

export function validateStatement(s: unknown): string[] {
  if (!isObj(s)) return ['statement must be an object'];
  const e: string[] = [];
  if (typeof s.id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s.id)) {
    e.push('id must be a UUID');
  }
  const a = s.actor;
  if (!isObj(a) || !isObj(a.account) || !isIri(a.account.homePage) || typeof a.account.name !== 'string' || !a.account.name) {
    e.push('actor must be an Agent with an account (homePage IRI, name)');
  } else if ('mbox' in a || 'name' in a) e.push('actor must be anonymous (no mbox or name)');
  if (!isObj(s.verb) || !isIri(s.verb.id)) e.push('verb.id must be an IRI');
  if (!isObj(s.object) || !isIri(s.object.id)) e.push('object.id must be an IRI');
  if (typeof s.timestamp !== 'string' || Number.isNaN(Date.parse(s.timestamp))) e.push('timestamp must be an ISO 8601 date');
  if (typeof s.version !== 'string' || !/^(1|2)\.0\.\d+$/.test(s.version)) e.push('version must be 1.0.x or 2.0.x');
  if (s.result !== undefined && !isObj(s.result)) e.push('result must be an object');
  return e;
}
