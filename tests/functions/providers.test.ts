import { describe, it, expect, vi, afterEach } from 'vitest';
import { createWorkersAi, tokenText } from '../../functions/_lib/providers/workersAi';
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

/** SSE response that emits `chunks` then errors the body. */
function sseThenError(chunks: string[]): Response {
  return new Response(
    new ReadableStream({
      start(c) {
        for (const s of chunks) c.enqueue(enc.encode(s));
      },
      pull(c) {
        c.error(new Error('boom'));
      },
    }),
  );
}
const cfDelta = (t: string) => `data: {"choices":[{"delta":{"content":"${t}"}}]}\n\n`;
const anDelta = (t: string) =>
  `event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"${t}"}}\n\n`;

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
  it('chat turns a scalar-only reply (a number or boolean) into text, so .trim() never breaks', async () => {
    mockFetch(Response.json({ choices: [{ message: { content: 42 } }] }));
    expect((await cf().chat({ model: 'm', messages: msgs, maxTokens: 5 })).text).toBe('42');
    mockFetch(Response.json({ choices: [{ message: { content: true } }] }));
    expect((await cf().chat({ model: 'm', messages: msgs, maxTokens: 5 })).text).toBe('true');
    mockFetch(Response.json({ choices: [{ message: { content: null } }] }));
    expect((await cf().chat({ model: 'm', messages: msgs, maxTokens: 5 })).text).toBe('');
  });
  it('estimates usage as ceil(chars/4) when missing', async () => {
    mockFetch(Response.json({ choices: [{ message: { content: 'abcdefghi' } }] }));
    const r = await cf().chat({ model: 'm', messages: msgs, maxTokens: 5 });
    expect(r.usage).toEqual({ inputTokens: Math.ceil(('sys' + 'hello world!').length / 4), outputTokens: 3 });
  });
  it('throws on HTTP error without leaking the token', async () => {
    mockFetch(new Response('nope', { status: 500 }));
    const err = await cf().chat({ model: 'm', messages: msgs, maxTokens: 5 }).catch((e) => e);
    expect(err.message).toMatch(/500/);
    expect(err.message).not.toContain('tok1');
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
    // No usage chunk at all: settle the reserved worst case, never the (smaller) delivered text.
    expect((await s.usage).outputTokens).toBe(9);
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

describe('stream robustness', () => {
  const cf = () => createWorkersAi('a', 'tok1');
  const an = () => createAnthropic('sk-test');
  const args = { model: 'm', messages: msgs, maxTokens: 9 };

  it('workers-ai: upstream error mid-stream settles usage and errors the body', async () => {
    mockFetch(sseThenError([cfDelta('abcd')]));
    const s = await cf().stream(args);
    await expect(drain(s.body)).rejects.toThrow();
    expect((await s.usage).outputTokens).toBe(9);
  });
  it('anthropic: upstream error mid-stream settles usage and errors the body', async () => {
    mockFetch(sseThenError([anDelta('abcdefgh')]));
    const s = await an().stream(args);
    await expect(drain(s.body)).rejects.toThrow();
    expect((await s.usage).outputTokens).toBe(9);
  });
  it('workers-ai: error chunk errors the body without echoing the message', async () => {
    mockFetch(sse([cfDelta('hi'), 'data: {"error":{"type":"overloaded","message":"SECRET-DETAIL"}}\n\n']));
    const s = await cf().stream(args);
    const err = await drain(s.body).catch((e) => e);
    expect(err.message).toBe('workers-ai stream error: overloaded');
    expect(err.message).not.toContain('SECRET');
    await s.usage;
  });
  it('anthropic: error event errors the body without echoing the message', async () => {
    mockFetch(
      sse([
        anDelta('hi'),
        'event: error\ndata: {"type":"error","error":{"type":"overloaded_error","message":"SECRET-DETAIL"}}\n\n',
      ]),
    );
    const s = await an().stream(args);
    const err = await drain(s.body).catch((e) => e);
    expect(err.message).toBe('anthropic stream error: overloaded_error');
    expect(err.message).not.toContain('SECRET');
    await s.usage;
  });
  it('handles CRLF line endings and explicit [DONE]', async () => {
    mockFetch(sse(['data: {"choices":[{"delta":{"content":"A"}}]}\r\n\r\ndata: {"choices":[{"delta":{"content":"B"}}]}\r\n\r\ndata: [DONE]\r\n\r\n']));
    const s = await cf().stream(args);
    expect(await drain(s.body)).toEqual(['A', 'B']);
    await s.usage;
  });
  it('workers-ai: numeric content tokens (live API sends digits as JSON numbers, including 0) arrive as strings', async () => {
    mockFetch(
      sse([
        'data: {"choices":[{"delta":{"content":"version "}}]}\n\n',
        'data: {"choices":[{"delta":{"content":3}}]}\n\n',
        'data: {"choices":[{"delta":{"content":", #"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":1}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"e"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":0}}]}\n\n',
        'data: [DONE]\n\n',
      ]),
    );
    const s = await cf().stream(args);
    const out = await drain(s.body);
    expect(out.every((t) => typeof t === 'string')).toBe(true);
    expect(out.join('')).toBe('version 3, #1e0');
    await s.usage;
  });
  it('workers-ai: boolean and null tokens (live shape, captured 2026-10-19) arrive as text; chunks without content add nothing', async () => {
    mockFetch(
      sse([
        'data: {"choices":[{"delta":{"role":"assistant","content":""}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"\\"appearanceTools\\": "}}]}\n\n',
        'data: {"choices":[{"delta":{"content":true}}]}\n\n',
        'data: {"choices":[{"delta":{"content":", \\"defaultPalette\\": "}}]}\n\n',
        'data: {"choices":[{"delta":{"content":false}}]}\n\n',
        'data: {"choices":[{"delta":{"content":", x: "}}]}\n\n',
        'data: {"choices":[{"delta":{"content":null}}]}\n\n',
        'data: {"choices":[{"delta":{}}]}\n\n',
        'data: {"choices":[],"usage":{"prompt_tokens":5,"completion_tokens":7}}\n\n',
        'data: [DONE]\n\n',
      ]),
    );
    const s = await cf().stream(args);
    expect((await drain(s.body)).join('')).toBe('"appearanceTools": true, "defaultPalette": false, x: null');
    await s.usage;
  });
  it('tokenText maps every scalar shape to text', () => {
    expect(tokenText({ content: 'a' })).toBe('a');
    expect(tokenText({ content: 0 })).toBe('0');
    expect(tokenText({ content: 3 })).toBe('3');
    expect(tokenText({ content: true })).toBe('true');
    expect(tokenText({ content: false })).toBe('false');
    expect(tokenText({ content: null })).toBe('null');
    expect(tokenText({})).toBe('');
    expect(tokenText(undefined)).toBe('');
    expect(tokenText({ content: { x: 1 } })).toBe('');
  });
  it('anthropic: split mid-JSON and CRLF', async () => {
    const full = anDelta('Hello').replace(/\n/g, '\r\n');
    const cut = full.indexOf('text_delta') + 3;
    mockFetch(sse([full.slice(0, cut), full.slice(cut)]));
    const s = await an().stream(args);
    expect(await drain(s.body)).toEqual(['Hello']);
  });
  it('consumer cancel resolves usage', async () => {
    mockFetch(sse([cfDelta('abcdefgh'), cfDelta('more')]));
    const s = await cf().stream(args);
    const r = s.body.getReader();
    await r.read();
    await r.cancel();
    expect((await s.usage).outputTokens).toBe(9);
  });
  it('workers-ai: live usage shape (first chunk has the prompt, later chunks are per-chunk deltas) settles prompt from the first chunk and output at maxTokens when cut short', async () => {
    // Observed on the live API: every chunk carries `usage`; only the final chunk is cumulative.
    mockFetch(
      sse([
        'data: {"choices":[{"delta":{"content":""}}],"usage":{"prompt_tokens":74,"completion_tokens":0}}\n\n',
        'data: {"choices":[{"delta":{"content":"abcdefgh"}}],"usage":{"prompt_tokens":0,"completion_tokens":1}}\n\n',
        'data: {"choices":[{"delta":{"content":"abcdefgh"}}],"usage":{"prompt_tokens":0,"completion_tokens":1}}\n\n',
      ]),
    );
    const s = await cf().stream(args);
    const r = s.body.getReader();
    await r.read();
    await r.read();
    await r.cancel();
    expect(await s.usage).toEqual({ inputTokens: 74, outputTokens: 9 });
  });
  it('workers-ai: the final cumulative usage chunk wins after per-chunk deltas', async () => {
    mockFetch(
      sse([
        'data: {"choices":[{"delta":{"content":"hi"}}],"usage":{"prompt_tokens":74,"completion_tokens":0}}\n\n',
        'data: {"choices":[{"delta":{"content":"yo"}}],"usage":{"prompt_tokens":0,"completion_tokens":1}}\n\n',
        'data: {"choices":[],"usage":{"prompt_tokens":74,"completion_tokens":112}}\n\ndata: [DONE]\n\n',
      ]),
    );
    const s = await cf().stream(args);
    await drain(s.body);
    expect(await s.usage).toEqual({ inputTokens: 74, outputTokens: 112 });
  });
  it('anthropic: consumer cancel resolves usage', async () => {
    mockFetch(sse([anDelta('abcd'), anDelta('more')]));
    const s = await an().stream(args);
    const r = s.body.getReader();
    await r.read();
    await r.cancel();
    expect((await s.usage).outputTokens).toBe(9);
  });
  it('workers-ai: a reasoning stream cut short (no content, per-chunk usage of 1) settles at maxTokens', async () => {
    const reasoning = 'data: {"choices":[{"delta":{"reasoning":"hmm"}}],"usage":{"prompt_tokens":0,"completion_tokens":1}}\n\n';
    mockFetch(sse([cfDelta('x'), reasoning, reasoning]));
    const s = await cf().stream(args);
    const r = s.body.getReader();
    await r.read();
    await r.cancel();
    expect((await s.usage).outputTokens).toBe(9);
  });
  it('workers-ai: a stream that ends normally without a final usage chunk settles at maxTokens', async () => {
    mockFetch(sse([cfDelta('ab'), 'data: [DONE]\n\n']));
    const s = await cf().stream(args);
    await drain(s.body);
    expect((await s.usage).outputTokens).toBe(9);
  });
  it('workers-ai: a usage chunk with prompt_tokens 0 and nothing else settles input from the estimate', async () => {
    mockFetch(sse(['data: {"choices":[{"delta":{"content":"hi"}}],"usage":{"prompt_tokens":0}}\n\n']));
    const s = await cf().stream(args);
    await drain(s.body);
    expect(await s.usage).toEqual({ inputTokens: Math.ceil(('sys' + 'hello world!').length / 4), outputTokens: 9 });
  });
  it('workers-ai: the precise figure is kept when the final usage chunk arrives, even if smaller than maxTokens', async () => {
    mockFetch(sse([cfDelta('ab'), 'data: {"choices":[],"usage":{"prompt_tokens":5,"completion_tokens":2}}\n\n']));
    const s = await cf().stream(args);
    await drain(s.body);
    expect(await s.usage).toEqual({ inputTokens: 5, outputTokens: 2 });
  });
  it('anthropic: a stream that ends normally without message_delta usage settles at maxTokens', async () => {
    mockFetch(sse([anDelta('ab')]));
    const s = await an().stream(args);
    await drain(s.body);
    expect((await s.usage).outputTokens).toBe(9);
  });
  it('non-200 rejects stream() and anthropic chat, without leaking keys', async () => {
    mockFetch(new Response('no', { status: 429 }));
    await expect(cf().stream(args)).rejects.toThrow(/429/);
    mockFetch(new Response('no', { status: 401 }));
    const e1 = await an().stream(args).catch((e) => e);
    expect(e1.message).toMatch(/401/);
    mockFetch(new Response('no', { status: 529 }));
    const e2 = await an().chat(args).catch((e) => e);
    expect(e2.message).toMatch(/529/);
    expect(e2.message).not.toContain('sk-test');
  });
  it('passes the abort signal to fetch', async () => {
    const f = mockFetch(Response.json({ choices: [{ message: { content: 'x' } }] }));
    const ac = new AbortController();
    await cf().chat({ ...args, signal: ac.signal });
    expect((f.mock.calls[0] as unknown as [string, RequestInit])[1].signal).toBe(ac.signal);
    const f2 = mockFetch(Response.json({ content: [] }));
    await an().chat({ ...args, signal: ac.signal });
    expect((f2.mock.calls[0] as unknown as [string, RequestInit])[1].signal).toBe(ac.signal);
  });
});

describe('AI_ROUTES validation', () => {
  const env = (r: unknown): Env => ({
    DB: {} as Env['DB'],
    CF_ACCOUNT_ID: 'a',
    CF_AI_TOKEN: 't',
    ANTHROPIC_API_KEY: 'k',
    AI_ROUTES: JSON.stringify({ tutor: r }),
  });
  const bad: [string, unknown][] = [
    ['unknown provider', { provider: 'openai' }],
    ['model not in PRICES', { model: 'gpt-unpriced' }],
    ['empty model', { model: '' }],
    ['non-string model', { model: 5 }],
    ['maxTokens zero', { maxTokens: 0 }],
    ['maxTokens too big', { maxTokens: 4001 }],
    ['maxTokens fractional', { maxTokens: 10.5 }],
    ['maxTokens string', { maxTokens: '500' }],
    ['non-object', 'oops'],
  ];
  for (const [name, r] of bad) {
    it(`ignores and warns: ${name}`, () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const rt = routeFor('tutor', env(r))!;
      expect(rt.model).toBe('@cf/meta/llama-4-scout-17b-16e-instruct');
      expect(rt.maxTokens).toBe(700);
      expect(rt.provider.id).toBe('workers-ai');
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0][0])).toContain('tutor');
      expect(String(warn.mock.calls[0][0])).not.toMatch(/\bt\b.*k/);
      warn.mockRestore();
    });
  }
  it('accepts a valid override', () => {
    const rt = routeFor('tutor', env({ model: 'claude-sonnet-5-5', maxTokens: 4000, provider: 'anthropic' }))!;
    expect(rt).toMatchObject({ model: 'claude-sonnet-5-5', maxTokens: 4000 });
    expect(rt.provider.id).toBe('anthropic');
  });
  it('warns when override provider key is missing', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const e = env({ provider: 'anthropic', model: 'claude-haiku-5-5', maxTokens: 5 });
    delete e.ANTHROPIC_API_KEY;
    expect(routeFor('tutor', e)!.provider.id).toBe('workers-ai');
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
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
      AI_ROUTES: JSON.stringify({ tutor: { provider: 'anthropic', model: 'claude-haiku-5-5', maxTokens: 5 } }),
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
