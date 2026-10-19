import { describe, it, expect, vi, afterEach } from 'vitest';
import { createWorkersAi } from '../../functions/_lib/providers/workersAi';
import { createAnthropic } from '../../functions/_lib/providers/anthropic';
import { routeFor } from '../../functions/_lib/providers';
import { PRICES } from '../../functions/_lib/config';
import type { Env } from '../../functions/_lib/env';

const enc = new TextEncoder();
function sse(chunks: string[]): Response {
  return new Response(
    new ReadableStream({
      start(c) {
        for (const s of chunks) c.enqueue(enc.encode(s));
        c.close();
      },
    }),
    { headers: { 'content-type': 'text/event-stream' } },
  );
}
async function drain(rs: ReadableStream<string>) {
  const r = rs.getReader();
  const out: string[] = [];
  for (;;) {
    const { done, value } = await r.read();
    if (done) return out;
    out.push(value);
  }
}
function mockFetch(res: Response) {
  const f = vi.fn(async () => res);
  vi.stubGlobal('fetch', f);
  return f;
}
const msgs = [
  { role: 'system' as const, content: 'sys' },
  { role: 'user' as const, content: 'hello world!' },
];
afterEach(() => vi.unstubAllGlobals());

describe('workers-ai adapter', () => {
  const cf = () => createWorkersAi('acct1', 'tok1');
  it('chat sends URL, bearer auth, json schema; returns text+usage', async () => {
    const f = mockFetch(
      Response.json({
        choices: [{ message: { content: '{"a":1}' } }],
        usage: { prompt_tokens: 11, completion_tokens: 5 },
      }),
    );
    const schema = { type: 'object' };
    const r = await cf().chat({ model: '@cf/openai/gpt-oss-120b', messages: msgs, maxTokens: 50, json: schema });
    expect(r).toEqual({ text: '{"a":1}', usage: { inputTokens: 11, outputTokens: 5 } });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.cloudflare.com/client/v4/accounts/acct1/ai/v1/chat/completions');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok1');
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe('@cf/openai/gpt-oss-120b');
    expect(body.max_tokens).toBe(50);
    expect(body.response_format.type).toBe('json_schema');
    expect(body.response_format.json_schema.schema).toEqual(schema);
  });
  it('estimates usage as ceil(chars/4) when missing', async () => {
    mockFetch(Response.json({ choices: [{ message: { content: 'abcdefghi' } }] }));
    const r = await cf().chat({ model: 'm', messages: msgs, maxTokens: 5 });
    expect(r.usage).toEqual({ inputTokens: Math.ceil(('sys' + 'hello world!').length / 4), outputTokens: 3 });
  });
  it('throws on HTTP error without leaking the token', async () => {
    mockFetch(new Response('nope', { status: 500 }));
    await expect(cf().chat({ model: 'm', messages: msgs, maxTokens: 5 })).rejects.toThrow(/500/);
  });
  it('stream yields deltas across split chunks and resolves usage', async () => {
    const f = mockFetch(
      sse([
        'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\ndata: {"choices":[{"delta":{"con',
        'tent":"lo"}}]}\n\n',
        'data: {"choices":[],"usage":{"prompt_tokens":7,"completion_tokens":2}}\n\ndata: [DONE]\n\n',
      ]),
    );
    const s = await cf().stream({ model: 'm', messages: msgs, maxTokens: 9 });
    expect(await drain(s.body)).toEqual(['Hel', 'lo']);
    expect(await s.usage).toEqual({ inputTokens: 7, outputTokens: 2 });
    const body = JSON.parse((f.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.stream).toBe(true);
    expect(body.stream_options).toEqual({ include_usage: true });
  });
  it('stream estimates usage when absent', async () => {
    mockFetch(sse(['data: {"choices":[{"delta":{"content":"12345678"}}]}\n\ndata: [DONE]\n\n']));
    const s = await cf().stream({ model: 'm', messages: msgs, maxTokens: 9 });
    await drain(s.body);
    expect((await s.usage).outputTokens).toBe(2);
  });
});

describe('anthropic adapter', () => {
  const an = () => createAnthropic('sk-test');
  it('chat sends x-api-key + anthropic-version, system split out, json schema', async () => {
    const f = mockFetch(
      Response.json({ content: [{ type: 'text', text: 'hi' }], usage: { input_tokens: 9, output_tokens: 3 } }),
    );
    const r = await an().chat({ model: 'claude-haiku-5-5', messages: msgs, maxTokens: 20, json: { type: 'object' } });
    expect(r).toEqual({ text: 'hi', usage: { inputTokens: 9, outputTokens: 3 } });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    const h = init.headers as Record<string, string>;
    expect(h['x-api-key']).toBe('sk-test');
    expect(h['anthropic-version']).toBe('2023-06-01');
    const body = JSON.parse(init.body as string);
    expect(body.system).toBe('sys');
    expect(body.messages).toEqual([{ role: 'user', content: 'hello world!' }]);
    expect(body.max_tokens).toBe(20);
    expect(body.output_config.format).toEqual({ type: 'json_schema', schema: { type: 'object' } });
  });
  it('estimates usage when missing', async () => {
    mockFetch(Response.json({ content: [{ type: 'text', text: 'abcd' }] }));
    const r = await an().chat({ model: 'm', messages: msgs, maxTokens: 5 });
    expect(r.usage.outputTokens).toBe(1);
  });
  it('stream yields text deltas and combines message_start + message_delta usage', async () => {
    mockFetch(
      sse([
        'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":25,"output_tokens":1}}}\n\n',
        'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hi"}}\n\n',
        'event: ping\ndata: {"type":"ping"}\n\n',
        'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":" there"}}\n\n',
        'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":15}}\n\n',
        'event: message_stop\ndata: {"type":"message_stop"}\n\n',
      ]),
    );
    const s = await an().stream({ model: 'm', messages: msgs, maxTokens: 9 });
    expect(await drain(s.body)).toEqual(['Hi', ' there']);
    expect(await s.usage).toEqual({ inputTokens: 25, outputTokens: 15 });
  });
});

describe('routeFor', () => {
  const base = { DB: {} as Env['DB'] };
  it('returns null with nothing configured', () => {
    expect(routeFor('tutor', base)).toBeNull();
  });
  it('defaults to workers-ai with config maxTokens', () => {
    const r = routeFor('placement', { ...base, CF_ACCOUNT_ID: 'a', CF_AI_TOKEN: 't' })!;
    expect(r.provider.id).toBe('workers-ai');
    expect(r.model).toBe('@cf/openai/gpt-oss-120b');
    expect(r.maxTokens).toBe(400);
    expect(routeFor('judge', { ...base, CF_ACCOUNT_ID: 'a', CF_AI_TOKEN: 't' })!.maxTokens).toBe(300);
    expect(routeFor('tutor', { ...base, CF_ACCOUNT_ID: 'a', CF_AI_TOKEN: 't' })!.maxTokens).toBe(700);
    expect(routeFor('feedback', { ...base, CF_ACCOUNT_ID: 'a', CF_AI_TOKEN: 't' })!.maxTokens).toBe(300);
  });
  it('AI_ROUTES override wins, including anthropic when key set', () => {
    const env: Env = {
      ...base,
      CF_ACCOUNT_ID: 'a',
      CF_AI_TOKEN: 't',
      ANTHROPIC_API_KEY: 'k',
      AI_ROUTES: JSON.stringify({ tutor: { provider: 'anthropic', model: 'claude-haiku-5-5', maxTokens: 500 } }),
    };
    const r = routeFor('tutor', env)!;
    expect(r.provider.id).toBe('anthropic');
    expect(r.model).toBe('claude-haiku-5-5');
    expect(r.maxTokens).toBe(500);
    expect(routeFor('judge', env)!.provider.id).toBe('workers-ai');
  });
  it('ignores the anthropic route without a key', () => {
    const env: Env = {
      ...base,
      AI_ROUTES: JSON.stringify({ tutor: { provider: 'anthropic', model: 'x', maxTokens: 5 } }),
    };
    expect(routeFor('tutor', env)).toBeNull();
    expect(routeFor('tutor', { ...env, CF_ACCOUNT_ID: 'a', CF_AI_TOKEN: 't' })!.provider.id).toBe('workers-ai');
  });
  it('survives malformed AI_ROUTES', () => {
    const r = routeFor('tutor', { ...base, CF_ACCOUNT_ID: 'a', CF_AI_TOKEN: 't', AI_ROUTES: '{nope' });
    expect(r!.provider.id).toBe('workers-ai');
  });
});

describe('PRICES', () => {
  it('has default and anthropic models', () => {
    expect(PRICES['@cf/openai/gpt-oss-120b']).toEqual({ inPerM: 0.35, outPerM: 0.75 });
    expect(PRICES['claude-haiku-5-5']).toEqual({ inPerM: 0.1, outPerM: 0.5 });
  });
});
