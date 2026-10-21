import { build } from 'esbuild';
import { beforeEach, describe, expect, it } from 'vitest';
import { createSqliteD1 } from '../../dev/sqliteD1';
import { handleMcp } from '../../functions/_lib/mcp/handler';
import { MCP_LIMITS, TOO_LARGE, TOO_MANY, inspectMcpBody } from '../../functions/_lib/mcp/gate';
import type { D1Like, Env } from '../../functions/_lib/env';
import { newHandle } from '../../vendor/learning-mcp/core/index.ts';

let db: D1Like;
let env: Env;
let t: number;

beforeEach(() => {
  db = createSqliteD1();
  env = { DB: db } as Env;
  t = Date.parse('2026-10-20T12:00:00Z');
});

/** Sends one JSON-RPC body and reads the whole response (the SDK streams it, so the tool runs while it is read). */
async function rpc(body: unknown): Promise<{ status: number; json(): Promise<unknown>; text: string }> {
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
  return { status: r.status, text, json: async () => JSON.parse(text) };
}
const toolCall = (id: number, name: string, args: Record<string, unknown>) => ({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } });

describe('MCP gate', () => {
  it('a body over 1 MiB gets 413 as a JSON-RPC error', async () => {
    const r = await rpc(toolCall(1, 'link_record', { record: 'x'.repeat(4_000_000) }));
    expect(r.status).toBe(413);
    expect(await r.json()).toEqual({ jsonrpc: '2.0', id: null, error: { code: -32600, message: TOO_LARGE } });
  });

  it('the 121st call on one handle in 10 minutes gets 429; another handle still works', async () => {
    const h = newHandle();
    for (let i = 0; i < MCP_LIMITS.perHandle.limit; i++) expect((await rpc(toolCall(i, 'get_record', { handle: h }))).status).toBe(200);
    const r = await rpc(toolCall(999, 'get_record', { handle: h }));
    expect(r.status).toBe(429);
    expect(await r.json()).toEqual({ jsonrpc: '2.0', id: 999, error: { code: -32000, message: TOO_MANY } });
    expect((await rpc(toolCall(1, 'get_record', { handle: newHandle() }))).status).toBe(200);
    t += MCP_LIMITS.perHandle.windowMs;
    expect((await rpc(toolCall(1, 'get_record', { handle: h }))).status).toBe(200);
  });

  it('the 61st record creation gets 429', async () => {
    for (let i = 0; i < MCP_LIMITS.create.limit; i++) expect((await rpc(toolCall(i, 'start_placement', {}))).status).toBe(200);
    expect((await rpc(toolCall(61, 'start_placement', {}))).status).toBe(429);
    expect((await rpc(toolCall(62, 'link_record', { record: '{}' }))).status).toBe(429);
    const rows = await db.prepare('SELECT COUNT(*) AS n FROM mcp_records').first<{ n: number }>();
    expect(Number(rows!.n)).toBe(MCP_LIMITS.create.limit);
  });

  it('the global ceiling holds', async () => {
    await db.prepare('CREATE TABLE IF NOT EXISTS hits (k VARCHAR(80) PRIMARY KEY, window_start BIGINT, n INT)').run();
    await db.prepare('INSERT INTO hits (k, window_start, n) VALUES (?, ?, ?)').bind('mcp:g', t, MCP_LIMITS.global.limit).run();
    expect((await rpc(toolCall(1, 'list_paths', {}))).status).toBe(429);
  });

  it('MCP traffic never touches the AI buckets', async () => {
    for (let i = 0; i < 50; i++) await rpc(toolCall(i, i % 2 ? 'list_paths' : 'get_record', { handle: newHandle() }));
    const { results } = await db.prepare('SELECT k FROM hits').all<{ k: string }>();
    expect(results.length).toBeGreaterThan(1);
    for (const { k } of results) expect(k.startsWith('mcp:')).toBe(true);
  });

  it('inspectMcpBody finds handles and creations in a batch and ignores invalid JSON', () => {
    const a = newHandle();
    const b = newHandle();
    expect(
      inspectMcpBody(
        JSON.stringify([
          toolCall(1, 'next_beat', { handle: a }),
          toolCall(2, 'get_record', { handle: a }),
          toolCall(3, 'start_placement', {}),
          toolCall(4, 'start_placement', { handle: b }),
          toolCall(5, 'link_record', { record: '{}' }),
          { jsonrpc: '2.0', method: 'notifications/initialized' },
        ]),
      ),
    ).toEqual({ messages: 6, handles: [a, a, b], creates: 2, ids: [1, 2, 3, 4, 5] });
    expect(inspectMcpBody('{nope')).toEqual({ messages: 1, handles: [], creates: 0, ids: [] });
    expect(inspectMcpBody(JSON.stringify(toolCall(1, 'get_record', { handle: 'not-a-handle' }))).handles).toEqual([]);
  });

  it('a batch is charged per call: 121 calls on one handle in batches get 429', async () => {
    const h = newHandle();
    const batch = (n: number) => Array.from({ length: n }, (_, i) => toolCall(i, 'get_record', { handle: h }));
    expect((await rpc(batch(100))).status).toBe(200);
    expect((await rpc(batch(20))).status).toBe(200);
    expect((await rpc(batch(1))).status).toBe(429);
    const g = await db.prepare("SELECT n FROM hits WHERE k = 'mcp:g'").first<{ n: number }>();
    expect(Number(g!.n)).toBe(121);
  });
});

describe('no AI on the MCP path', () => {
  it('bundles no AI, budget, prompt or provider module', async () => {
    const r = await build({
      entryPoints: ['functions/api/mcp.ts', 'functions/api/mcp-sweep.ts', 'functions/api/agent/handoff.ts', 'functions/api/agent/record.ts', 'functions/api/agent/delete.ts'],
      bundle: true,
      write: false,
      metafile: true,
      format: 'esm',
      platform: 'neutral',
      mainFields: ['module', 'main'],
      conditions: ['workerd', 'worker', 'browser'],
      outdir: 'out',
      logLevel: 'silent',
    });
    const inputs = Object.keys(r.metafile!.inputs);
    expect(inputs.some((i) => i.includes('vendor/learning-mcp/server/server.ts'))).toBe(true);
    expect(inputs.filter((i) => /functions\/_lib\/(ai|budget|prompts)\.ts|functions\/_lib\/providers\//.test(i))).toEqual([]);
  });
});
