// POST /api/agent/handoff { lessonId, files? } -> { handle, mcpUrl, prompt }
// "Continue in your agent": seeds an agent record at that lesson with the learner's files.
import type { Handler } from '../../_lib/env';
import { json } from '../../_lib/http';
import { HttpError, readJsonCapped } from '../../_lib/guards';
import { defaultCtx, newHandle } from '../../../vendor/learning-mcp/core/index.ts';
import { agentPrompt, MCP_URL } from '../../../src/shared/course-meta';
import { agentRoute, limit } from '../../_lib/mcp/agentApi';
import { getCourse } from '../../_lib/mcp/course';
import { MCP_CREATE_KEY, MCP_GLOBAL_KEY, MCP_LIMITS } from '../../_lib/mcp/gate';
import { D1RecordStore } from '../../_lib/mcp/recordStore';
import { seedRecord } from '../../_lib/mcp/seed';

export const HANDOFF_MAX_BYTES = 256_000;

export const POST: Handler = (req, { env }) =>
  agentRoute(env, async () => {
    const now = Date.now();
    const body = await readJsonCapped<{ lessonId?: unknown; files?: unknown }>(req, HANDOFF_MAX_BYTES);
    const seeded = seedRecord(getCourse(), body?.lessonId, body?.files, defaultCtx('learn-wp-reimagined site'));
    if (!seeded.ok) throw new HttpError(400, 'bad-request', seeded.error);
    await limit(env, MCP_GLOBAL_KEY, MCP_LIMITS.global, now);
    await limit(env, MCP_CREATE_KEY, MCP_LIMITS.create, now);
    const handle = newHandle();
    await new D1RecordStore(env.DB).put(handle, seeded.record);
    return json({ handle, mcpUrl: MCP_URL, prompt: agentPrompt(handle) });
  });
