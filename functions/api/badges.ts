// GET /api/badges: the learner's path badges from the LRS (Task 49).
// Each badge carries how many lessons the learner tested out of on its path, from the waived outcomes kept per learner.
import type { Handler } from '../_lib/env';
import { error, json } from '../_lib/http';
import { guarded } from '../_lib/ai';
import { getContent } from '../_lib/content';
import { loadCurrentCourse } from '../_lib/course/cache';
import { ensureRecordSchema } from '../_lib/db';
import { LrsClient, LrsError, LrsUnavailable } from '../_lib/lrs/client';
import { auIdOf } from '../_lib/record/official';
import { getRegistration } from '../_lib/record/registration';
import { rateLimit } from '../_lib/ratelimit';
import { readSession } from '../_lib/session/session';
import { activityIds } from '../../vendor/course-xapi-mcp/core/constants';
import { XAPI_BASE } from '../../src/shared/xapi';
import type { PathId } from '../../src/shared/types';

export interface BadgeSummary {
  id: string;
  pathId: PathId;
  name: string;
  status: 'pending' | 'claimed';
  testedOut: number;
}

export const needSession = () => error(401, 'no-session', 'Start a session first.');
export const lrsDown = () => error(503, 'lrs-unavailable', 'Badges are unavailable right now. Please try again shortly.');

const BADGE_PREFIX = `${XAPI_BASE}/badges/`;
/** GET /api/badges reads the LRS, whose rate bucket every learner shares; keyed per learner, not per address. */
export const BADGES_PER_10_MIN = 30;

export const GET: Handler = (req, { env }) =>
  guarded(async () => {
    await loadCurrentCourse(env);
    const now = Date.now();
    const session = await readSession(req, env, now);
    if (!session) return needSession();
    if (!(await rateLimit(env.DB, `badges:${session.actorName}`, now, BADGES_PER_10_MIN, 600_000))) {
      return error(429, 'rate-limited', 'You are going a little fast. Please wait a few minutes and try again.');
    }
    try {
      const content = getContent();
      const registration = await getRegistration(env, session);
      const badges = await new LrsClient(env).listBadges(registration);
      await ensureRecordSchema(env.DB);
      const { results } = await env.DB
        .prepare('SELECT activity_id FROM official_outcomes WHERE actor_name = ? AND registration = ? AND verb = ?')
        .bind(session.actorName, registration, 'waived')
        .all<{ activity_id: string }>();
      const waived = new Set(results.map((r) => r.activity_id));
      const out: BadgeSummary[] = [];
      for (const b of badges) {
        const aid = b.achievement.id ?? '';
        const pathId = aid.startsWith(BADGE_PREFIX) ? aid.slice(BADGE_PREFIX.length) : '';
        if (!Object.prototype.hasOwnProperty.call(content.paths, pathId)) continue;
        if (b.status !== 'pending' && b.status !== 'claimed') continue;
        const path = content.paths[pathId as PathId];
        out.push({
          id: b.id,
          pathId: pathId as PathId,
          name: b.achievement.name ?? path.title,
          status: b.status,
          testedOut: path.lessons.filter((l) => waived.has(activityIds.au(auIdOf(l)))).length,
        });
      }
      const res = json(out);
      res.headers.set('cache-control', 'no-store');
      return res;
    } catch (e) {
      if (e instanceof LrsUnavailable || e instanceof LrsError) return lrsDown();
      throw e;
    }
  });
