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

function usageOf(u: OaiUsage | undefined, inputText: number, out: string, streamed = false): Usage {
  const est = estimateTokens(out);
  return {
    inputTokens: u?.prompt_tokens ?? inputText,
    // A cut-short stream may report fewer completion tokens than were already delivered.
    outputTokens: streamed ? Math.max(u?.completion_tokens ?? 0, est) : (u?.completion_tokens ?? est),
  };
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
        choices?: { message?: { content?: string | null } }[];
        usage?: OaiUsage;
      };
      const text = data.choices?.[0]?.message?.content ?? '';
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
      let reported: OaiUsage | undefined;
      let resolveUsage!: (u: Usage) => void;
      const usage = new Promise<Usage>((r) => (resolveUsage = r));
      const body = new ReadableStream<string>({
        async pull(ctl) {
          try {
            for (;;) {
              const { done, value } = await events.read();
              if (done) {
                resolveUsage(usageOf(reported, inputEst, text, true));
                ctl.close();
                return;
              }
              if (value === '[DONE]') continue;
              let j: {
                choices?: { delta?: { content?: string | null } }[];
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
              // meaningful, the rest are per-chunk deltas. Keep the per-field maximum so a stream that
              // is cut short is never settled at 0 input tokens.
              if (j.usage) {
                reported = {
                  prompt_tokens: Math.max(reported?.prompt_tokens ?? 0, j.usage.prompt_tokens ?? 0),
                  completion_tokens: Math.max(reported?.completion_tokens ?? 0, j.usage.completion_tokens ?? 0),
                };
              }
              const d = j.choices?.[0]?.delta?.content;
              if (d) {
                text += d;
                ctl.enqueue(d);
                return;
              }
            }
          } catch (e) {
            resolveUsage(usageOf(reported, inputEst, text, true));
            ctl.error(e);
          }
        },
        cancel() {
          resolveUsage(usageOf(reported, inputEst, text, true));
          return events.cancel();
        },
      });
      return { body, usage };
    },
  };
}
