import type { Handler } from '../_lib/env';
import { error, json } from '../_lib/http';
import { guarded } from '../_lib/ai';
import { ensureEnrolmentSchema } from '../_lib/db';
import { ConnectorClient, ConnectorError, ConnectorUnavailable } from '../_lib/ledger/connector';
import { lessonKeyBySenseiId } from '../_lib/ledger/lesson-ids';
import { readSession } from '../_lib/session/session';

/** What Sensei holds for this session's learner, lessons named by studio id. */
export const GET: Handler = (req, { env }) =>
  guarded(async () => {
    const session = await readSession(req, env, Date.now());
    if (!session || session.wpUserId == null) return error(401, 'no-session', 'No Sensei learner for this session.');
    if (!env.LEDGER_PROGRAM_ID) return error(503, 'disabled', 'Sensei progress is not configured.');
    try {
      const p = await new ConnectorClient(env).progress(session.wpUserId, env.LEDGER_PROGRAM_ID);
      // The ledger's progress lists every course in the program, enrolled or not; the enrolments this
      // server made are the ones Sensei holds.
      await ensureEnrolmentSchema(env.DB);
      const rows = await env.DB.prepare('SELECT course_key FROM enrolments WHERE wp_user_id = ?').bind(session.wpUserId).all<{ course_key: string }>();
      const enrolled = new Set((rows.results ?? []).map((r) => r.course_key));
      const names = lessonKeyBySenseiId(env);
      const studio = (ids: string[]) => ids.flatMap((id) => (names[id] ? [names[id]] : []));
      return json({
        ...p,
        enrolled: p.enrolled.filter((k) => enrolled.has(k)),
        completedLessons: studio(p.completedLessons),
        testedOutLessons: studio(p.testedOutLessons),
      });
    } catch (e) {
      if (e instanceof ConnectorUnavailable || e instanceof ConnectorError)
        return error(503, 'connector-unavailable', 'Sensei is not answering right now.');
      throw e;
    }
  });
