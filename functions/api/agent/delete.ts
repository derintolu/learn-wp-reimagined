// POST /api/agent/delete { handle } -> { deleted }
// Deletes the relay's copy of the agent record (on the standard, with the legacy record it came from).
// The learner's site record is not touched.
import type { Handler } from '../../_lib/env';
import { json } from '../../_lib/http';
import { SERVER_FLAGS } from '../../_lib/config';
import { agentRoute, readHandle } from '../../_lib/mcp/agentApi';
import { practiceForm } from '../../_lib/mcp/handles';
import { D1RecordStore } from '../../_lib/mcp/recordStore';
import { practiceCustody } from '../../_lib/mcp/practiceStore';

export const POST: Handler = (req, { env }) =>
  agentRoute(env, async () => {
    const handle = await readHandle(req, env, Date.now());
    const deleted = SERVER_FLAGS.mcpOnStandard ? await practiceCustody(env.DB).deletePractice(practiceForm(handle)) : await new D1RecordStore(env.DB).delete(handle);
    return json({ deleted });
  });
