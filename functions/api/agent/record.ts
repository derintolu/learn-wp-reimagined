// POST /api/agent/record { handle } -> { record }
// "Bring back your agent's progress": the agent's learning-mcp record, for the site to import.
// POST, not GET, so the handle never appears in a URL or an access log.
import type { Handler } from '../../_lib/env';
import { json } from '../../_lib/http';
import { HttpError } from '../../_lib/guards';
import { NO_RECORD, agentRoute, readHandle } from '../../_lib/mcp/agentApi';
import { D1RecordStore } from '../../_lib/mcp/recordStore';

export const POST: Handler = (req, { env }) =>
  agentRoute(env, async () => {
    const handle = await readHandle(req, env, Date.now());
    const record = await new D1RecordStore(env.DB).get(handle);
    if (!record) throw new HttpError(404, 'no-record', NO_RECORD);
    return json({ record });
  });
