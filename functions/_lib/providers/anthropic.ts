// Anthropic Claude adapter (off unless ANTHROPIC_API_KEY is set; see providers/index.ts).
//
// Docs checked 2026-10-19:
//  - Messages API: https://platform.claude.com/docs/en/api/messages (docs.claude.com redirects here)
//      POST https://api.anthropic.com/v1/messages, headers `x-api-key`, `anthropic-version: 2023-06-01`;
//      system prompt is a top-level `system` string, not a message role.
//  - Streaming: https://platform.claude.com/docs/en/build-with-claude/streaming
//      events: message_start (usage.input_tokens), content_block_delta ({delta:{type:"text_delta",text}}),
//      message_delta (usage.output_tokens, cumulative), message_stop.
//  - Structured outputs: https://platform.claude.com/docs/en/build-with-claude/structured-outputs
//      GA, no beta header: `output_config: { format: { type: "json_schema", schema } }`.
//  - Models/pricing: https://platform.claude.com/docs/en/about-claude/models/overview and
//      https://platform.claude.com/docs/en/about-claude/pricing
import {
  estimateInputTokens,
  estimateTokens,
  sseData,
  type ChatMessage,
  type ChatOptions,
  type Provider,
  type StreamOptions,
  type Usage,
} from './types';

const URL = 'https://api.anthropic.com/v1/messages';
const VERSION = '2023-06-01';

function payload(o: { model: string; messages: ChatMessage[]; maxTokens: number }) {
  const system = o.messages
    .filter((m) => m.role === 'system')
    .map((m) => m.content)
    .join('\n\n');
  const body: Record<string, unknown> = {
    model: o.model,
    max_tokens: o.maxTokens,
    messages: o.messages.filter((m) => m.role !== 'system'),
  };
  if (system) body.system = system;
  return body;
}

export function createAnthropic(apiKey: string): Provider {
  const headers = {
    'x-api-key': apiKey,
    'anthropic-version': VERSION,
    'content-type': 'application/json',
  };
  async function call(body: object, signal?: AbortSignal): Promise<Response> {
    const res = await fetch(URL, { method: 'POST', headers, body: JSON.stringify(body), signal });
    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      throw new Error(`anthropic request failed: ${res.status}`);
    }
    return res;
  }

  return {
    id: 'anthropic',
    async chat(o: ChatOptions) {
      const body = payload(o);
      if (o.json) body.output_config = { format: { type: 'json_schema', schema: o.json } };
      const data = (await (await call(body, o.signal)).json()) as {
        content?: { type: string; text?: string }[];
        usage?: { input_tokens?: number; output_tokens?: number };
      };
      const text = (data.content ?? [])
        .filter((b) => b.type === 'text')
        .map((b) => b.text ?? '')
        .join('');
      return {
        text,
        usage: {
          inputTokens: data.usage?.input_tokens ?? estimateInputTokens(o.messages),
          outputTokens: data.usage?.output_tokens ?? estimateTokens(text),
        },
      };
    },
    async stream(o: StreamOptions) {
      const res = await call({ ...payload(o), stream: true }, o.signal);
      const events = sseData(res).getReader();
      let text = '';
      let inTok: number | undefined;
      let outTok: number | undefined;
      let finalOut = false; // message_delta carries the cumulative output count
      let resolveUsage!: (u: Usage) => void;
      const usage = new Promise<Usage>((r) => (resolveUsage = r));
      const settle = () =>
        resolveUsage({
          inputTokens: inTok ?? estimateInputTokens(o.messages),
          // Without the final message_delta usage, settle at the reserved worst case (maxTokens).
          outputTokens: finalOut ? outTok! : Math.max(o.maxTokens, estimateTokens(text)),
        });
      const body = new ReadableStream<string>({
        async pull(ctl) {
          try {
            for (;;) {
              const { done, value } = await events.read();
              if (done) {
                settle();
                ctl.close();
                return;
              }
              let j: {
                type?: string;
                message?: { usage?: { input_tokens?: number; output_tokens?: number } };
                delta?: { type?: string; text?: string };
                usage?: { input_tokens?: number; output_tokens?: number };
                error?: { type?: string };
              };
              try {
                j = JSON.parse(value);
              } catch {
                continue;
              }
              if (j.type === 'error') {
                throw new Error(`anthropic stream error: ${j.error?.type ?? 'unknown'}`);
              } else if (j.type === 'message_start') {
                inTok = j.message?.usage?.input_tokens ?? inTok;
                outTok = j.message?.usage?.output_tokens ?? outTok;
              } else if (j.type === 'message_delta') {
                inTok = j.usage?.input_tokens ?? inTok;
                if (j.usage?.output_tokens !== undefined) {
                  outTok = j.usage.output_tokens; // cumulative
                  finalOut = true;
                }
              } else if (j.type === 'content_block_delta' && j.delta?.type === 'text_delta' && j.delta.text) {
                text += j.delta.text;
                ctl.enqueue(j.delta.text);
                return;
              }
            }
          } catch (e) {
            settle();
            ctl.error(e);
          }
        },
        cancel() {
          settle();
          return events.cancel();
        },
      });
      return { body, usage };
    },
  };
}
