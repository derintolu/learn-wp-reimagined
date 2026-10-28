import type { Handler } from '../../_lib/env';
import { error } from '../../_lib/http';
import { guarded } from '../../_lib/ai';
import { SERVER_FLAGS } from '../../_lib/config';
import { ConnectorClient, ConnectorError, ConnectorUnavailable } from '../../_lib/ledger/connector';
import { readSession } from '../../_lib/session/session';
import type { PathId } from '../../../src/shared/types';

/** The learner's Sensei certificate PDF for a completed path. Answers only with senseiCertificates on. */
export const GET: Handler = (req, { env }) =>
  guarded(async () => {
    if (!SERVER_FLAGS.senseiCertificates) return error(404, 'not-found', 'Not found.');
    const session = await readSession(req, env, Date.now());
    if (!session || session.wpUserId == null) return error(401, 'no-session', 'No Sensei learner for this session.');
    if (!env.LEDGER_PROGRAM_ID) return error(503, 'disabled', 'Sensei progress is not configured.');
    const path = new URL(req.url).searchParams.get('path') ?? '';
    try {
      const client = new ConnectorClient(env);
      const p = await client.progress(session.wpUserId, env.LEDGER_PROGRAM_ID);
      if (!p.completedCourses.includes(path)) return error(404, 'not-complete', 'This course is not complete.');
      const res = await client.certificate(session.wpUserId, path as PathId);
      return new Response(res.body, {
        status: 200,
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="${path.replace(/[^\w-]/g, '')}-certificate.pdf"`,
          'Cache-Control': 'private, no-store',
        },
      });
    } catch (e) {
      if (e instanceof ConnectorError && e.status === 404) return error(404, 'no-certificate', 'No certificate for this course.');
      if (e instanceof ConnectorUnavailable || e instanceof ConnectorError)
        return error(503, 'connector-unavailable', 'Sensei is not answering right now.');
      throw e;
    }
  });
