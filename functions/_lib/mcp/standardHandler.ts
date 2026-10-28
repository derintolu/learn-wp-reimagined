// /api/mcp on the course-xapi-mcp reference server (SERVER_FLAGS.mcpOnStandard): its createCourseServer with
// practice custody (option 4) whose PracticeStore is the D1 relay. The reference server owns the tools, the
// teaching rules and every statement; this file supplies the course, the store, the gate and the origin rule.
// No AI runs here, and nothing here fetches anything: the learner's own agent does the thinking.
import { createCourseServer } from '../../../vendor/course-xapi-mcp/server/server.ts';
import { LEGACY_XAPI_BASES, XAPI_BASE } from '../../../src/shared/xapi';
import type { Env } from '../env';
import { gateMcp } from './gate';
import { withPracticeHandles } from './handles';
import { practiceCustody, type PracticeDeps } from './practiceStore';
import { getStandardCourse } from './standardCourse';

/** Browser origins allowed to call the connector: the site, at both its addresses (ruling R11). */
export const MCP_ORIGINS: readonly string[] = [XAPI_BASE, ...LEGACY_XAPI_BASES];

const forbidden = () => new Response('Forbidden origin', { status: 403, headers: { 'content-type': 'text/plain; charset=utf-8' } });

/** Serves one MCP request. Schema setup is the caller's (handler.ts). */
export async function handleMcpStandard(req: Request, env: Env, deps: PracticeDeps = {}): Promise<Response> {
  const now = deps.now ?? Date.now;
  const gate = await gateMcp(req, env, now());
  if (!gate.ok) return gate.res;
  // A page on another site (or a sandboxed one, `Origin: null`) may not drive a learner's record.
  const origin = req.headers.get('origin');
  if (origin !== null && !MCP_ORIGINS.includes(origin)) return forbidden();
  let mcpReq = gate.req;
  if (req.method === 'POST') {
    const rewritten = withPracticeHandles(await gate.req.clone().text());
    if (rewritten !== null) mcpReq = new Request(gate.req.url, { method: 'POST', headers: gate.req.headers, body: rewritten });
  }
  const course = getStandardCourse();
  const server = createCourseServer({ course, custody: practiceCustody(env.DB, deps), publicUrl: XAPI_BASE });
  return server.mcp(mcpReq, '/mcp');
}
