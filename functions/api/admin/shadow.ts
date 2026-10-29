// Shadow comparison report: for one day, the learning facts the course server recorded it sent to the LRS
// (shadow_facts) against the facts the LRS actually holds for the same learners. Admin only.
import type { Handler } from '../../_lib/env';
import { error, json } from '../../_lib/http';
import { getContent } from '../../_lib/content';
import { loadCurrentCourse } from '../../_lib/course/cache';
import { LrsClient, LrsError, LrsUnavailable, type Actor } from '../../_lib/lrs/client';
import { officialActor } from '../../_lib/record/official';
import { factsOf, listShadowFacts, type LearningFact } from '../../_lib/record/shadow';
import type { XapiStatement } from '../../../vendor/course-xapi-mcp/core/xapi/types.ts';

function safeEqual(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  const n = Math.max(x.length, y.length);
  for (let i = 0; i < n; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

const PAGE_LIMIT = 500;
const key = (f: LearningFact) => `${f.kind}\u0000${f.lessonId}`;

/** The learning facts a set of official statements state, as the course server records them. */
export function factsFromStatements(s: XapiStatement[]): LearningFact[] {
  return factsOf(s as never, getContent());
}

const unique = (facts: LearningFact[]) => [...new Map(facts.map((f) => [key(f), f])).values()];
const minus = (a: LearningFact[], b: LearningFact[]) => {
  const have = new Set(b.map(key));
  return a.filter((f) => !have.has(key(f)));
};

export const GET: Handler = async (req, { env }) => {
  const token = env.ADMIN_TOKEN;
  const header = req.headers.get('authorization') ?? '';
  const given = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token || !given || !safeEqual(given, token)) return error(401, 'unauthorized', 'Unauthorized.');

  const day = new URL(req.url).searchParams.get('day') ?? '';
  const start = /^\d{4}-\d{2}-\d{2}$/.test(day) ? Date.parse(`${day}T00:00:00.000Z`) : NaN;
  if (Number.isNaN(start) || new Date(start).toISOString().slice(0, 10) !== day) {
    return error(400, 'bad_day', 'Pass ?day=YYYY-MM-DD.');
  }
  const since = new Date(start).toISOString();
  const until = new Date(start + 86_400_000).toISOString();

  await loadCurrentCourse(env);
  const lrs = new LrsClient(env);
  const recorded = await listShadowFacts(env, day);
  const diffs: { actor: string; missingInLrs: LearningFact[]; extraInLrs: LearningFact[] }[] = [];
  let truncated = false;
  try {
    for (const { actor, facts } of recorded) {
      const page = await lrs.getStatements({ agent: officialActor(actor) as Actor, since, limit: PAGE_LIMIT });
      if (page.more) truncated = true;
      const inDay = page.statements.filter((s) => !s.timestamp || (s.timestamp >= since && s.timestamp < until));
      const held = unique(factsFromStatements(inDay));
      const missingInLrs = minus(facts, held);
      const extraInLrs = minus(held, facts);
      if (missingInLrs.length || extraInLrs.length) diffs.push({ actor, missingInLrs, extraInLrs });
    }
  } catch (e) {
    if (e instanceof LrsUnavailable || e instanceof LrsError) return error(502, 'lrs_unavailable', e.message);
    throw e;
  }
  return json({ day, actors: recorded.length, diffs, ...(truncated ? { truncated: true } : {}) });
};
