// Cloudflare Workers AI adapter.
//
// Docs checked 2026-10-19:
//  - https://developers.cloudflare.com/workers-ai/configuration/open-ai-compatibility/
//      endpoint: https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/v1/chat/completions
//      auth: `Authorization: Bearer <api token>`
//  - https://developers.cloudflare.com/workers-ai/features/json-mode/
//      `response_format: { type: "json_schema", json_schema: ... }`; JSON mode does not stream.
//  - https://developers.cloudflare.com/workers-ai/models/gpt-oss-120b/  (`@cf/openai/gpt-oss-120b`)
//
// Endpoint choice: the OpenAI-compatible /ai/v1/chat/completions rather than /ai/run/{model}.
// It returns the stable OpenAI shape (choices[].message.content, usage.prompt_tokens /
// completion_tokens, streaming `choices[].delta.content` chunks ending in `data: [DONE]`), the same
// shape for every model, and accepts `stream_options.include_usage` so a streamed reply can still
// report usage. /ai/run wraps output per-model (`result.response`). The docs pages above do not
// spell out the streaming chunk or usage fields, so this follows the OpenAI contract they declare
// compatibility with, and falls back to ceil(chars/4) estimates whenever usage is absent.
import {
  estimateInputTokens,
  estimateTokens,
  sseData,
  type ChatOptions,
  type Provider,
  type StreamOptions,
  type Usage,
} from './types';

interface OaiUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
}

function usageOf(u: OaiUsage | undefined, inputText: number, out: string): Usage {
  return {
    inputTokens: u?.prompt_tokens ?? inputText,
    outputTokens: u?.completion_tokens ?? estimateTokens(out),
  };
}

/**
 * The live stream sends tokens that look like JSON scalars as JSON values: `"content":3`, `"content":0`,
 * `"content":true`, `"content":false` (captured 2026-10-19, see the Task 13 report). Chunks with no text
 * omit `content` entirely, so a present `null` is the literal token "null". Everything becomes text.
 */
export function tokenText(delta: { content?: unknown } | undefined): string {
  if (!delta || !Object.prototype.hasOwnProperty.call(delta, 'content')) return '';
  const c = delta.content;
  if (typeof c === 'string') return c;
  if (c === null) return 'null';
  if (typeof c === 'number' || typeof c === 'boolean') return String(c);
  return '';
}

export function createWorkersAi(accountId: string, token: string): Provider {
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/v1/chat/completions`;
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  async function call(body: object, signal?: AbortSignal): Promise<Response> {
    const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal });
    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      throw new Error(`workers-ai request failed: ${res.status}`);
    }
    return res;
  }

  return {
    id: 'workers-ai',
    async chat(o: ChatOptions) {
      const body: Record<string, unknown> = {
        model: o.model,
        messages: o.messages,
        max_tokens: o.maxTokens,
      };
      if (o.json) {
        body.response_format = {
          type: 'json_schema',
          json_schema: { name: 'reply', schema: o.json },
        };
      }
      const data = (await (await call(body, o.signal)).json()) as {
        choices?: { message?: { content?: unknown } }[];
        usage?: OaiUsage;
      };
      const content = data.choices?.[0]?.message?.content;
      // A reply that is only a number or a boolean can come back as a JSON scalar.
      const text = content === undefined || content === null ? '' : String(content);
      return { text, usage: usageOf(data.usage, estimateInputTokens(o.messages), text) };
    },
    async stream(o: StreamOptions) {
      const res = await call({
        model: o.model,
        messages: o.messages,
        max_tokens: o.maxTokens,
        stream: true,
        stream_options: { include_usage: true },
      }, o.signal);
      const events = sseData(res).getReader();
      const inputEst = estimateInputTokens(o.messages);
      let text = '';
      let reported: OaiUsage | undefined; // per-field max over all chunks (prompt count comes from the first)
      let finalUsage: OaiUsage | undefined; // the cumulative usage chunk, if one arrived
      // Spend is never under-counted: unless the final cumulative usage chunk arrived, the output is
      // settled at the reserved worst case (maxTokens). Reasoning models stream `delta.reasoning`, which
      // is not delivered, so counting delivered text would under-count them badly.
      const settleUsage = (): Usage =>
        finalUsage
          ? usageOf(finalUsage, inputEst, text)
          : { inputTokens: reported?.prompt_tokens || inputEst, outputTokens: Math.max(o.maxTokens, estimateTokens(text)) };
      let resolveUsage!: (u: Usage) => void;
      const usage = new Promise<Usage>((r) => (resolveUsage = r));
      const body = new ReadableStream<string>({
        async pull(ctl) {
          try {
            for (;;) {
              const { done, value } = await events.read();
              if (done) {
                resolveUsage(settleUsage());
                ctl.close();
                return;
              }
              if (value === '[DONE]') continue;
              let j: {
                choices?: { delta?: { content?: unknown } }[];
                usage?: OaiUsage;
                error?: { type?: string; code?: string | number };
              };
              try {
                j = JSON.parse(value);
              } catch {
                continue;
              }
              if (j.error) {
                const kind = String(j.error.type ?? j.error.code ?? 'unknown');
                throw new Error(`workers-ai stream error: ${kind}`);
              }
              // Live API: every chunk carries `usage`; only the first (prompt) and last (cumulative) are
              // meaningful, the rest are per-chunk deltas. Keep the per-field maximum for the prompt count
              // and remember the cumulative chunk.
              if (j.usage) {
                reported = {
                  prompt_tokens: Math.max(reported?.prompt_tokens ?? 0, j.usage.prompt_tokens ?? 0),
                  completion_tokens: Math.max(reported?.completion_tokens ?? 0, j.usage.completion_tokens ?? 0),
                };
                // Per-chunk deltas have prompt_tokens 0; the cumulative chunk has both counts.
                if ((j.usage.prompt_tokens ?? 0) > 0 && (j.usage.completion_tokens ?? 0) > 0) finalUsage = j.usage;
              }
              const d = tokenText(j.choices?.[0]?.delta);
              if (d) {
                text += d;
                ctl.enqueue(d);
                return;
              }
            }
          } catch (e) {
            resolveUsage(settleUsage());
            ctl.error(e);
          }
        },
        cancel() {
          resolveUsage(settleUsage());
          return events.cancel();
        },
      });
      return { body, usage };
    },
  };
}
