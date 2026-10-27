export const XAPI_BASE = 'https://learn-wp-reimagined.space.fast';

// Target: IEEE 9274.1.1-2023 (xAPI 2.0). Statements omit `version`; see docs/record-format.md.

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

export const EXT_OUTCOME = `${XAPI_BASE}/xapi/extensions/outcome`;
export const EXT_FROM_LESSON = `${XAPI_BASE}/xapi/extensions/from-lesson`;
export const EXT_CHOSEN_BY = `${XAPI_BASE}/xapi/extensions/chosen-by`;

interface XapiActivityRef { objectType: 'Activity'; id: string; definition?: { name: Record<string, string> } }

export interface XapiStatement {
  id: string;
  actor: { objectType: 'Agent'; account: { homePage: string; name: string } };
  verb: { id: string; display: Record<string, string> };
  object: XapiActivityRef;
  result?: XapiResult;
  context?: { contextActivities?: { parent?: XapiActivityRef[] } };
  timestamp: string;
}

export const activityId = (segments: string[]) => `${XAPI_BASE}/activities/${segments.map(encodeURIComponent).join('/')}`;

export function buildStatement(input: {
  learnerId: string;
  verb: VerbKey;
  activityPath: string[];
  name: string;
  result?: XapiResult;
  parent?: string[];
  id?: string;
  timestamp?: string;
}): XapiStatement {
  const v = VERBS[input.verb];
  const s: XapiStatement = {
    id: input.id ?? crypto.randomUUID(),
    actor: { objectType: 'Agent', account: { homePage: XAPI_BASE, name: input.learnerId } },
    verb: { id: v.id, display: { 'en-US': v.display } },
    object: {
      objectType: 'Activity',
      id: activityId(input.activityPath),
      definition: { name: { 'en-US': input.name } },
    },
    timestamp: input.timestamp ?? new Date().toISOString(),
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

const TOP_KEYS = new Set(['id', 'actor', 'verb', 'object', 'result', 'context', 'timestamp']);
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

function checkExtensions(ext: unknown, where: string, e: string[]) {
  if (ext === undefined) return;
  if (!isObj(ext)) return void e.push(`${where}.extensions must be an object`);
  for (const k of Object.keys(ext)) if (!isIri(k)) e.push(`${where}.extensions key "${k}" must be an IRI`);
}

export function validateStatement(s: unknown): string[] {
  if (!isObj(s)) return ['statement must be an object'];
  const e: string[] = [];
  for (const k of Object.keys(s)) if (!TOP_KEYS.has(k)) e.push(`unknown property "${k}"`);
  if (typeof s.id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s.id)) {
    e.push('id must be a UUID');
  }
  const a = s.actor;
  if (!isObj(a) || a.objectType !== 'Agent' || !isObj(a.account) || !isIri(a.account.homePage) || typeof a.account.name !== 'string' || !a.account.name) {
    e.push('actor must be an Agent with an account (homePage IRI, name)');
  } else if ('mbox' in a || 'name' in a) e.push('actor must be anonymous (no mbox or name)');
  if (!isObj(s.verb) || !isIri(s.verb.id)) e.push('verb.id must be an IRI');
  else if (s.verb.display !== undefined) {
    const d = s.verb.display;
    if (!isObj(d) || !Object.entries(d).every(([k, v]) => k.length > 0 && typeof v === 'string')) {
      e.push('verb.display must be a language map of strings');
    }
  }
  if (!isObj(s.object) || !isIri(s.object.id)) e.push('object.id must be an IRI');
  else if (s.object.objectType !== undefined && s.object.objectType !== 'Activity') e.push('object.objectType must be Activity');
  if (typeof s.timestamp !== 'string' || !TIMESTAMP.test(s.timestamp) || Number.isNaN(Date.parse(s.timestamp))) {
    e.push('timestamp must be ISO 8601 with a timezone');
  }
  if (s.result !== undefined) {
    if (!isObj(s.result)) e.push('result must be an object');
    else {
      const r = s.result;
      if (r.success !== undefined && typeof r.success !== 'boolean') e.push('result.success must be a boolean');
      if (r.completion !== undefined && typeof r.completion !== 'boolean') e.push('result.completion must be a boolean');
      if (r.response !== undefined && typeof r.response !== 'string') e.push('result.response must be a string');
      checkExtensions(r.extensions, 'result', e);
    }
  }
  if (s.context !== undefined) {
    if (!isObj(s.context)) e.push('context must be an object');
    else {
      checkExtensions(s.context.extensions, 'context', e);
      const ca = s.context.contextActivities;
      if (ca !== undefined) {
        const parent = isObj(ca) ? ca.parent : undefined;
        if (!isObj(ca)) e.push('context.contextActivities must be an object');
        else if (parent !== undefined) {
          if (!Array.isArray(parent)) e.push('context.contextActivities.parent must be an array');
          else {
            for (const p of parent) {
              if (!isObj(p) || !isIri(p.id) || (p.objectType !== undefined && p.objectType !== 'Activity')) {
                e.push('context parent entries must be { objectType?: Activity, id: IRI }');
              }
            }
          }
        }
      }
    }
  }
  return e;
}
