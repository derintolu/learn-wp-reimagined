// POST /api/agent/delete { handle } -> { deleted }
// Deletes the relay's copy of the agent record. The learner's site record is not touched.
import type { Handler } from '../../_lib/env';
import { json } from '../../_lib/http';
import { agentRoute, readHandle } from '../../_lib/mcp/agentApi';
import { D1RecordStore } from '../../_lib/mcp/recordStore';

export const POST: Handler = (req, { env }) =>
  agentRoute(env, async () => {
    const handle = await readHandle(req, env, Date.now());
    return json({ deleted: await new D1RecordStore(env.DB).delete(handle) });
  });
