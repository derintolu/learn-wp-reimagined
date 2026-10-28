// POST /api/agent/record { handle } -> { record }
// "Bring back your agent's progress": the agent's record, for the site to import. On the standard
// (SERVER_FLAGS.mcpOnStandard) that is the practice copy, or a record today's server wrote and the agent has
// not continued since, as it was kept; off, today's learning-mcp record.
// POST, not GET, so the handle never appears in a URL or an access log.
import type { Handler } from '../../_lib/env';
import { json } from '../../_lib/http';
import { HttpError } from '../../_lib/guards';
import { SERVER_FLAGS } from '../../_lib/config';
import { NO_RECORD, agentRoute, readHandle } from '../../_lib/mcp/agentApi';
import { practiceForm } from '../../_lib/mcp/handles';
import { D1RecordStore } from '../../_lib/mcp/recordStore';
import { D1PracticeStore } from '../../_lib/mcp/practiceStore';
import { getStandardCourse } from '../../_lib/mcp/standardCourse';

export const POST: Handler = (req, { env }) =>
  agentRoute(env, async () => {
    const handle = await readHandle(req, env, Date.now());
    const record = SERVER_FLAGS.mcpOnStandard ? await new D1PracticeStore(env.DB, getStandardCourse).stored(practiceForm(handle)) : await new D1RecordStore(env.DB).get(handle);
    if (!record) throw new HttpError(404, 'no-record', NO_RECORD);
    return json({ record });
  });
