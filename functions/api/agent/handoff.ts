// POST /api/agent/handoff { lessonId, files? } -> { handle, mcpUrl, prompt }
// "Continue in your agent": seeds an agent record at that lesson with the learner's files. On the standard
// (SERVER_FLAGS.mcpOnStandard) a practice copy under a new practice handle; off, today's learning-mcp record.
import type { Handler } from '../../_lib/env';
import { json } from '../../_lib/http';
import { HttpError, readJsonCapped } from '../../_lib/guards';
import { SERVER_FLAGS } from '../../_lib/config';
import { defaultCtx, newHandle } from '../../../vendor/learning-mcp/core/index.ts';
import { newPracticeHandle } from '../../../vendor/course-xapi-mcp/core/practice-record.ts';
import { agentHandlePrompt, MCP_URL } from '../../../src/shared/course-meta';
import { agentRoute, limit } from '../../_lib/mcp/agentApi';
import { getCourse } from '../../_lib/mcp/course';
import { MCP_CREATE_KEY, MCP_GLOBAL_KEY, MCP_LIMITS } from '../../_lib/mcp/gate';
import { D1RecordStore } from '../../_lib/mcp/recordStore';
import { seedRecord } from '../../_lib/mcp/seed';
import { getStandardCourse } from '../../_lib/mcp/standardCourse';
import { practiceCustody } from '../../_lib/mcp/practiceStore';
import { seedPractice } from '../../_lib/mcp/standardSeed';

export const HANDOFF_MAX_BYTES = 256_000;
const PLATFORM = 'learn-wp-reimagined site';

export const POST: Handler = (req, { env }) =>
  agentRoute(env, async () => {
    const now = Date.now();
    const body = await readJsonCapped<{ lessonId?: unknown; files?: unknown }>(req, HANDOFF_MAX_BYTES);
    const limits = async () => {
      await limit(env, MCP_GLOBAL_KEY, MCP_LIMITS.global, now);
      await limit(env, MCP_CREATE_KEY, MCP_LIMITS.create, now);
    };
    let handle: string;
    if (SERVER_FLAGS.mcpOnStandard) {
      const ctx = { now: () => new Date().toISOString(), uuid: () => crypto.randomUUID(), platform: PLATFORM };
      const seeded = seedPractice(getStandardCourse(), body?.lessonId, body?.files, ctx);
      if (!seeded.ok) throw new HttpError(400, 'bad-request', seeded.error);
      await limits();
      handle = newPracticeHandle();
      await practiceCustody(env.DB).importCopy(handle, seeded.record);
    } else {
      const seeded = seedRecord(getCourse(), body?.lessonId, body?.files, defaultCtx(PLATFORM));
      if (!seeded.ok) throw new HttpError(400, 'bad-request', seeded.error);
      await limits();
      handle = newHandle();
      await new D1RecordStore(env.DB).put(handle, seeded.record);
    }
    return json({ handle, mcpUrl: MCP_URL, prompt: agentHandlePrompt(handle) });
  });
