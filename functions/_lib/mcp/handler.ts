// The course as a remote MCP server (Streamable HTTP, stateless): the course-xapi-mcp reference server with record
// option 2 and OAuth sign-in (agentHandler.ts). This file sets up the schema and the course the server serves now.
// No AI runs here: the learner's own agent does the thinking.
import type { Env } from '../env';
import { ensureSchema } from '../db';
import { handleMcpAgent, type AgentDeps } from './agentHandler';
import { loadCurrentCourse } from '../course/cache';

export async function handleMcp(req: Request, env: Env, deps: AgentDeps = {}, handlerCtx?: unknown): Promise<Response> {
  await ensureSchema(env.DB);
  await loadCurrentCourse(env);
  return handleMcpAgent(req, env, deps, handlerCtx);
}
