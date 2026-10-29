import { build } from 'esbuild';
import { beforeEach, describe, expect, it } from 'vitest';
import { createSqliteD1 } from '../../dev/sqliteD1';
import { handleMcp } from '../../functions/_lib/mcp/handler';
import { MCP_LIMITS, TOO_LARGE, TOO_MANY, gateMcp, inspectMcpBody, mcpTokenKey } from '../../functions/_lib/mcp/gate';
import { ensureSchema } from '../../functions/_lib/db';
import type { D1Like, Env } from '../../functions/_lib/env';
import { vendorShimsEsbuild } from '../../scripts/vendor-shims';

let db: D1Like;
let env: Env;
let t: number;

beforeEach(async () => {
  db = createSqliteD1();
  env = { DB: db } as Env;
  t = Date.parse('2026-10-20T12:00:00Z');
  // handleMcp ensures the schema; the gate alone expects it.
  await ensureSchema(db);
});

const HASH = 'a'.repeat(64);
const legacyHandle = () => 'lr_' + 'x'.repeat(32);
const practiceHandle = () => 'cxp_' + 'y'.repeat(32);

/** Sends one JSON-RPC body through /api/mcp and reads the whole response. */
async function rpc(body: unknown): Promise<{ status: number; json(): Promise<unknown> }> {
  const r = await handleMcp(
    new Request('http://localhost/api/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
    env,
    { now: () => t },
  );
  const text = await r.text();
  return { status: r.status, json: async () => JSON.parse(text) };
}
const toolCall = (id: number, name: string, args: Record<string, unknown>) => ({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } });
const gate = (body: unknown, tokenHash?: string) =>
  gateMcp(new Request('http://localhost/api/mcp', { method: 'POST', body: JSON.stringify(body) }), env, t, tokenHash ? { tokenHash } : {});

describe('MCP gate', () => {
  it('a body over 1 MiB gets 413 as a JSON-RPC error', async () => {
    const r = await rpc(toolCall(1, 'get_status', { note: 'x'.repeat(4_000_000) }));
    expect(r.status).toBe(413);
    expect(await r.json()).toEqual({ jsonrpc: '2.0', id: null, error: { code: -32600, message: TOO_LARGE } });
  });

  it('the global ceiling holds', async () => {
    await db.prepare('INSERT INTO hits (k, window_start, n) VALUES (?, ?, ?)').bind('mcp:g', t, MCP_LIMITS.global.limit).run();
    const r = await rpc(toolCall(7, 'get_status', {}));
    expect(r.status).toBe(429);
    expect(await r.json()).toEqual({ jsonrpc: '2.0', id: 7, error: { code: -32000, message: TOO_MANY } });
  });

  it('a batch is charged per call to the token: the 121st call in 10 minutes gets 429', async () => {
    const batch = (n: number) => Array.from({ length: n }, (_, i) => toolCall(i, 'get_status', {}));
    expect((await gate(batch(100), HASH)).ok).toBe(true);
    expect((await gate(batch(20), HASH)).ok).toBe(true);
    expect((await gate(batch(1), HASH)).ok).toBe(false);
    const g = await db.prepare("SELECT n FROM hits WHERE k = 'mcp:g'").first<{ n: number }>();
    expect(Number(g!.n)).toBe(121);
    t += MCP_LIMITS.perToken.windowMs;
    expect((await gate(batch(1), HASH)).ok).toBe(true);
  });

  it('without a token only the global bucket is charged, and MCP traffic never touches the AI buckets', async () => {
    for (let i = 0; i < 5; i++) await gate(toolCall(i, 'start_placement', { handle: legacyHandle() }));
    await gate(toolCall(9, 'get_status', {}), HASH);
    const keys = (await db.prepare('SELECT k FROM hits ORDER BY k').all<{ k: string }>()).results.map((r) => r.k);
    expect(keys).toEqual(['mcp:g', mcpTokenKey(HASH)]);
  });

  it('inspectMcpBody finds the record handles of the retired connector in a batch and ignores invalid JSON', () => {
    const a = legacyHandle();
    const b = practiceHandle();
    expect(
      inspectMcpBody(
        JSON.stringify([
          toolCall(1, 'next_beat', { handle: a }),
          toolCall(2, 'get_record', { handle: b }),
          toolCall(3, 'start_placement', {}),
          { jsonrpc: '2.0', method: 'notifications/initialized' },
        ]),
      ),
    ).toEqual({ messages: 4, handles: [a, b], ids: [1, 2, 3] });
    expect(inspectMcpBody('{nope')).toEqual({ messages: 1, handles: [], ids: [] });
    expect(inspectMcpBody(JSON.stringify(toolCall(1, 'get_record', { handle: 'not-a-handle' }))).handles).toEqual([]);
  });
});

describe('no AI on the MCP path', () => {
  it('bundles no AI, budget, prompt or provider module, and no learning-mcp server', async () => {
    const r = await build({
      entryPoints: ['functions/api/mcp.ts'],
      bundle: true,
      write: false,
      metafile: true,
      format: 'esm',
      platform: 'neutral',
      mainFields: ['module', 'main'],
      conditions: ['workerd', 'worker', 'browser'],
      outdir: 'out',
      logLevel: 'silent',
      plugins: [vendorShimsEsbuild()],
    });
    const inputs = Object.keys(r.metafile!.inputs);
    expect(inputs.some((i) => i.includes('vendor/course-xapi-mcp/server/server.ts'))).toBe(true);
    expect(inputs.some((i) => i.includes('vendor/learning-mcp/'))).toBe(false);
    expect(inputs.filter((i) => /functions\/_lib\/(ai|budget|prompts)\.ts|functions\/_lib\/providers\//.test(i))).toEqual([]);
  });
});
