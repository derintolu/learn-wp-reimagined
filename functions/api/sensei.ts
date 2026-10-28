import type { Handler } from '../_lib/env';
import { error, json } from '../_lib/http';
import { guarded } from '../_lib/ai';
import { SERVER_FLAGS } from '../_lib/config';
import { ConnectorClient, ConnectorError, ConnectorUnavailable } from '../_lib/ledger/connector';
import { lessonKeyBySenseiId } from '../_lib/ledger/lesson-ids';
import { readSession } from '../_lib/session/session';

/** What Sensei holds for this session's learner, lessons named by studio id. Answers only with senseiLearners on. */
export const GET: Handler = (req, { env }) =>
  guarded(async () => {
    if (!SERVER_FLAGS.senseiLearners) return error(404, 'not-found', 'Not found.');
    const session = await readSession(req, env, Date.now());
    if (!session || session.wpUserId == null) return error(401, 'no-session', 'No Sensei learner for this session.');
    if (!env.LEDGER_PROGRAM_ID) return error(503, 'disabled', 'Sensei progress is not configured.');
    try {
      const p = await new ConnectorClient(env).progress(session.wpUserId, env.LEDGER_PROGRAM_ID);
      const names = lessonKeyBySenseiId(env);
      const studio = (ids: string[]) => ids.flatMap((id) => (names[id] ? [names[id]] : []));
      return json({
        ...p,
        completedLessons: studio(p.completedLessons),
        testedOutLessons: studio(p.testedOutLessons),
        certificateDownload: SERVER_FLAGS.senseiCertificates,
      });
    } catch (e) {
      if (e instanceof ConnectorUnavailable || e instanceof ConnectorError)
        return error(503, 'connector-unavailable', 'Sensei is not answering right now.');
      throw e;
    }
  });
