// /api/mcp: the course-xapi-mcp reference server with record option 2, signed in
// through MCP authorization. The learner is the actor their OAuth access token (Task 43) stands for; without a live
// token the answer is 401 naming the protected-resource metadata of the host the request came to (ruling R19).
// The course is the full package of the course the server serves now (agentCourse.ts); the custody keeps the record
// in the LRS through the studio's decide-and-record path (agentCustody.ts). No practice endpoint, no handles, no
// link_record. No AI runs here: the learner's own agent does the thinking.
import { createCourseServer } from '../../../vendor/course-xapi-mcp/server/server.ts';
import type { LearnerRef } from '../../../vendor/course-xapi-mcp/core/index.ts';
import type { XapiAgent } from '../../../vendor/course-xapi-mcp/core/xapi/types.ts';
import { LEGACY_XAPI_BASES, XAPI_BASE } from '../../../src/shared/xapi';
import type { Env } from '../env';
import { refreshContent } from '../course/cache';
import { issuerFor, resolveToken, sha256Hex } from '../oauth/store';
import { getAgentCourse } from './agentCourse';
import { agentCustody, sessionForActor } from './agentCustody';
import { gateMcp, inspectMcpBody } from './gate';

/** Browser origins allowed to call the connector: the site, at both its addresses (ruling R11). */
export const MCP_ORIGINS: readonly string[] = [XAPI_BASE, ...LEGACY_XAPI_BASES];

const BEARER = /^Bearer ([A-Za-z0-9_-]{43})$/i;

export const SIGN_IN = 'This course server now keeps your record under your sign-in. Reconnect the connector and sign in when your agent asks.';
export const NO_HANDLES =
  'Practice handles are no longer used: you are signed in, and your record is kept under your sign-in. Call the tool again without handle.';

const rpcError = (status: number, message: string, headers: Record<string, string> = {}, id: string | number | null = null) =>
  new Response(JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32001, message } }), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

/** RFC 9728 section 5.1: where the agent finds how to sign in, on the host it used. */
export const challenge = (req: Request) => `Bearer resource_metadata="${issuerFor(req)}/.well-known/oauth-protected-resource"`;

const forbidden = () => new Response('Forbidden origin', { status: 403, headers: { 'content-type': 'text/plain; charset=utf-8' } });

export interface AgentDeps {
  now?: () => number;
}

/** Serves one MCP request. Schema setup is the caller's (handler.ts). */
export async function handleMcpAgent(req: Request, env: Env, deps: AgentDeps = {}, handlerCtx?: unknown): Promise<Response> {
  const now = deps.now ?? Date.now;
  const presented = BEARER.exec((req.headers.get('authorization') ?? '').trim())?.[1];
  const gate = await gateMcp(req, env, now(), { tokenHash: presented ? await sha256Hex(presented) : undefined });
  if (!gate.ok) return gate.res;
  const origin = req.headers.get('origin');
  if (origin !== null && !MCP_ORIGINS.includes(origin)) return forbidden();

  // A record handle in a tool call: the agent was set up for the practice connector this server no longer runs.
  const info = req.method === 'POST' ? inspectMcpBody(await gate.req.clone().text()) : undefined;
  const carriesHandle = (info?.handles.length ?? 0) > 0;
  const grant = await resolveToken(env, gate.req, now());
  if (!grant) return rpcError(401, carriesHandle ? SIGN_IN : 'Sign in to continue: this course server needs an access token.', { 'www-authenticate': challenge(req) });
  if (carriesHandle) return rpcError(200, NO_HANDLES, {}, info?.ids[0] ?? null);

  await refreshContent(env);
  const course = getAgentCourse();
  const actorName = grant.actor.account.name;
  const session = await sessionForActor(env, actorName);
  const learner: LearnerRef = { kind: 'official', subject: actorName, actor: grant.actor as XapiAgent };
  const server = createCourseServer({
    course,
    custody: agentCustody(env, { course, session, now, handlerCtx }),
    authenticate: async () => learner,
    // Erased after the token was issued: the session is gone, and official writes are refused.
    hasLearner: async () => session !== null,
    publicUrl: XAPI_BASE,
  });
  return server.mcp(gate.req, '/mcp');
}
