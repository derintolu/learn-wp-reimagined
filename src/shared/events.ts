import type { Placement } from './engine';
import type { Outcome } from './types';
import type { XapiStatement } from './xapi';

export type ServerEvent =
  | { eventId: string; type: 'placed'; placement: Placement }
  | { eventId: string; type: 'beatViewed'; lessonId: string; beatIndex: number }
  | { eventId: string; type: 'checkpointAnswered'; lessonId: string; response: string; outcome: Outcome; decisionId?: string; files?: Record<string, string> }
  | { eventId: string; type: 'codeSubmitted'; lessonId: string; target: 'checkpoint' | 'bug'; file: string; files: Record<string, string> }
  | { eventId: string; type: 'lessonCompleted'; lessonId: string }
  /** Opening and leaving a lesson start and end its cmi5 AU session; they have no phase 1 statements. */
  | { eventId: string; type: 'lessonOpened'; lessonId: string }
  | { eventId: string; type: 'lessonLeft'; lessonId: string };

export type EventResult =
  | { eventId: string; ok: true; statements: XapiStatement[]; passed?: boolean; outcome?: Outcome; to?: string; chosenBy?: 'judge' | 'learner' }
  | { eventId: string; ok: false; error: 'unknown-lesson' | 'invalid' | 'not-allowed' };

export const EVENTS_MAX = 50;
export const EVENTS_MAX_BYTES = 256_000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EVENT_ID = /^[A-Za-z0-9-]{8,64}$/;
const OUTCOMES = ['advance', 'review', 'skip'];
const MAX_RESPONSE = 1500;
const MAX_FILES = 20;

const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const isStr = (v: unknown, max = 200): v is string => typeof v === 'string' && v.length > 0 && v.length <= max;

function parseFiles(v: unknown): Record<string, string> | null {
  if (!isObj(v)) return null;
  const keys = Object.keys(v);
  if (keys.length > MAX_FILES) return null;
  const out: Record<string, string> = {};
  for (const k of keys) {
    if (k.length === 0 || k.length > 200 || typeof v[k] !== 'string') return null;
    out[k] = v[k] as string;
  }
  return out;
}

function parseEvent(raw: unknown): ServerEvent | null {
  if (!isObj(raw) || typeof raw.eventId !== 'string' || !EVENT_ID.test(raw.eventId)) return null;
  const eventId = raw.eventId;
  switch (raw.type) {
    case 'placed':
      return isObj(raw.placement) ? { eventId, type: 'placed', placement: raw.placement as unknown as Placement } : null;
    case 'beatViewed':
      return isStr(raw.lessonId) && Number.isInteger(raw.beatIndex) && (raw.beatIndex as number) >= 0
        ? { eventId, type: 'beatViewed', lessonId: raw.lessonId, beatIndex: raw.beatIndex as number }
        : null;
    case 'checkpointAnswered': {
      if (!isStr(raw.lessonId) || typeof raw.response !== 'string' || raw.response.length > MAX_RESPONSE) return null;
      if (typeof raw.outcome !== 'string' || !OUTCOMES.includes(raw.outcome)) return null;
      const ev: ServerEvent = { eventId, type: 'checkpointAnswered', lessonId: raw.lessonId, response: raw.response, outcome: raw.outcome as Outcome };
      if (raw.decisionId !== undefined) {
        if (!isStr(raw.decisionId, 40)) return null;
        ev.decisionId = raw.decisionId;
      }
      if (raw.files !== undefined) {
        const files = parseFiles(raw.files);
        if (!files) return null;
        ev.files = files;
      }
      return ev;
    }
    case 'codeSubmitted': {
      if (!isStr(raw.lessonId) || !isStr(raw.file) || (raw.target !== 'checkpoint' && raw.target !== 'bug')) return null;
      const files = parseFiles(raw.files);
      return files ? { eventId, type: 'codeSubmitted', lessonId: raw.lessonId, target: raw.target, file: raw.file, files } : null;
    }
    case 'lessonCompleted':
    case 'lessonOpened':
    case 'lessonLeft':
      return isStr(raw.lessonId) ? { eventId, type: raw.type, lessonId: raw.lessonId } : null;
    default:
      return null;
  }
}

export function parseEvents(raw: unknown): { ok: true; learnerId: string; events: ServerEvent[] } | { ok: false; error: string } {
  if (!isObj(raw)) return { ok: false, error: 'body must be an object' };
  if (typeof raw.learnerId !== 'string' || !UUID.test(raw.learnerId)) return { ok: false, error: 'learnerId must be a UUID' };
  if (!Array.isArray(raw.events)) return { ok: false, error: 'events must be a list' };
  if (raw.events.length > EVENTS_MAX) return { ok: false, error: `at most ${EVENTS_MAX} events per request` };
  const events: ServerEvent[] = [];
  for (const e of raw.events) {
    const parsed = parseEvent(e);
    if (!parsed) return { ok: false, error: 'invalid event' };
    events.push(parsed);
  }
  return { ok: true, learnerId: raw.learnerId, events };
}
