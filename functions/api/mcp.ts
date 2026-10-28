// /api/mcp: the remote MCP connector learners add to Claude, ChatGPT, Claude Code or Cursor.
import type { Handler } from '../_lib/env';
import { handleMcp } from '../_lib/mcp/handler';

// The handler context goes along so an agent's recorded events drain the LRS outbox as the studio's do (option 2).
export const POST: Handler = (req, ctx) => handleMcp(req, ctx.env, {}, ctx);
export const GET: Handler = (req, ctx) => handleMcp(req, ctx.env, {}, ctx);
export const DELETE: Handler = (req, ctx) => handleMcp(req, ctx.env, {}, ctx);
