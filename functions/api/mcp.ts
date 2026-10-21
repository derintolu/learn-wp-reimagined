// /api/mcp: the remote MCP connector learners add to Claude, ChatGPT, Claude Code or Cursor.
import type { Handler } from '../_lib/env';
import { handleMcp } from '../_lib/mcp/handler';

export const POST: Handler = (req, { env }) => handleMcp(req, env);
export const GET: Handler = (req, { env }) => handleMcp(req, env);
export const DELETE: Handler = (req, { env }) => handleMcp(req, env);
