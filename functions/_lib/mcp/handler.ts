// The course as a remote MCP server (Streamable HTTP, stateless). With SERVER_FLAGS.agentOnStandard it is the
// reference server with record option 2 and OAuth sign-in (agentHandler.ts). Otherwise, with SERVER_FLAGS.mcpOnStandard it is the
// course-xapi-mcp reference server (standardHandler.ts); off, today's learning-mcp server below, unchanged:
// learning-mcp builds every statement and owns the teaching rules; this file only supplies the course, the
// durable store and the gate. No AI runs here, and nothing here fetches anything.
import { createCourseServer } from '../../../vendor/learning-mcp/server/server.ts';
import type { RecordStore } from '../../../vendor/learning-mcp/core/index.ts';
import { LEGACY_XAPI_BASES, XAPI_BASE } from '../../../src/shared/xapi';
import type { D1Like, Env } from '../env';
import { SERVER_FLAGS } from '../config';
import { ensureSchema } from '../db';
import { getCourse } from './course';
import { gateMcp } from './gate';
import { D1RecordStore, ensureMcpSchema } from './recordStore';
import type { PracticeDeps } from './practiceStore';
import { handleMcpStandard } from './standardHandler';
import { handleMcpAgent } from './agentHandler';
import { loadCurrentCourse } from '../course/cache';

export const MCP_ENDPOINT = '/api/mcp';

export interface McpDeps extends PracticeDeps {
  makeStore?: (db: D1Like) => RecordStore;
  now?: () => number;
}

export async function handleMcp(req: Request, env: Env, deps: McpDeps = {}, handlerCtx?: unknown): Promise<Response> {
  await ensureSchema(env.DB);
  await ensureMcpSchema(env.DB);
  await loadCurrentCourse(env);
  // Signed in, record option 2 (Task 45b); off, the practice connector below, unchanged.
  if (SERVER_FLAGS.agentOnStandard) return handleMcpAgent(req, env, deps, handlerCtx);
  if (SERVER_FLAGS.mcpOnStandard) return handleMcpStandard(req, env, deps);
  const now = deps.now ?? Date.now;
  const gate = await gateMcp(req, env, now());
  if (!gate.ok) return gate.res;
  const store = deps.makeStore ? deps.makeStore(env.DB) : new D1RecordStore(env.DB, now);
  const app = createCourseServer({ course: getCourse(), store, endpoint: MCP_ENDPOINT, allowedOrigins: [XAPI_BASE, ...LEGACY_XAPI_BASES] });
  return app.fetch(gate.req);
}
