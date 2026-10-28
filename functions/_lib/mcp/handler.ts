// The course as a remote MCP server (Streamable HTTP, stateless). learning-mcp builds every statement and
// owns the teaching rules; this file only supplies the course, the durable store and the gate.
// No AI runs here, and nothing here fetches anything: the learner's own agent does the thinking.
import { createCourseServer } from '../../../vendor/learning-mcp/server/server.ts';
import type { RecordStore } from '../../../vendor/learning-mcp/core/index.ts';
import { LEGACY_XAPI_BASES, XAPI_BASE } from '../../../src/shared/xapi';
import type { D1Like, Env } from '../env';
import { ensureSchema } from '../db';
import { getCourse } from './course';
import { gateMcp } from './gate';
import { D1RecordStore, ensureMcpSchema } from './recordStore';

export const MCP_ENDPOINT = '/api/mcp';

export interface McpDeps {
  makeStore?: (db: D1Like) => RecordStore;
  now?: () => number;
}

export async function handleMcp(req: Request, env: Env, deps: McpDeps = {}): Promise<Response> {
  await ensureSchema(env.DB);
  await ensureMcpSchema(env.DB);
  const now = deps.now ?? Date.now;
  const gate = await gateMcp(req, env, now());
  if (!gate.ok) return gate.res;
  const store = deps.makeStore ? deps.makeStore(env.DB) : new D1RecordStore(env.DB, now);
  const app = createCourseServer({ course: getCourse(), store, endpoint: MCP_ENDPOINT, allowedOrigins: [XAPI_BASE, ...LEGACY_XAPI_BASES] });
  return app.fetch(gate.req);
}
