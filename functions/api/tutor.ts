import type { Handler } from '../_lib/env';
import { HttpError, readJsonCapped } from '../_lib/guards';
import { checkMessages, fallback, guarded, inputBound, lessonOf, preflight, STREAM_TIMEOUT_MS } from '../_lib/ai';
import { reserve, settle } from '../_lib/budget';
import { askPrompt, deliverPrompt, wrapLearner } from '../_lib/prompts';
import type { Usage } from '../_lib/providers/types';

const enc = new TextEncoder();
const sse = (s: string) => enc.encode(`data: ${s}\n\n`);

export const POST: Handler = (req, { env }) =>
  guarded(async () => {
    const pre = await preflight(req, env, 'tutor');
    if (pre instanceof Response) return pre;
    const { db, route } = pre;
    const b = await readJsonCapped<Record<string, unknown>>(req, 64_000);
    const lesson = lessonOf(b?.lessonId);
    const mode = b?.mode;
    if (mode !== 'deliver' && mode !== 'ask') throw new HttpError(400, 'bad-request', 'mode must be deliver or ask.');
    const beatIndex = b.beatIndex;
    if (typeof beatIndex !== 'number' || !Number.isInteger(beatIndex) || beatIndex < 0 || beatIndex >= lesson.beats.length) {
      throw new HttpError(400, 'bad-request', 'Unknown beat.');
    }
    const history = checkMessages(b.messages, { maxMessages: 12, maxChars: 1500 });
    if (mode === 'ask' && history.length === 0) throw new HttpError(400, 'bad-request', 'Ask a question first.');

    const system = mode === 'deliver' ? deliverPrompt(lesson, lesson.beats[beatIndex]) : askPrompt(lesson);
    const messages = [
      { role: 'system' as const, content: system },
      ...history.map((m) => ({ role: m.role, content: m.role === 'user' ? wrapLearner(m.content) : m.content })),
    ];
    if (mode === 'deliver' && history.length === 0) {
      messages.push({ role: 'user', content: 'Please teach this beat now.' });
    }

    const maxIn = inputBound(messages);
    const r = await reserve(db, route.model, maxIn, route.maxTokens, new Date());
    if (!r.ok) return fallback(r.reason);

    let settled = false;
    const settleOnce = async (usage: Usage) => {
      if (settled) return;
      settled = true;
      await settle(db, r.reservation, route.model, usage).catch((e) => console.error('settle failed', (e as Error)?.message));
    };

    let started: Awaited<ReturnType<typeof route.provider.stream>>;
    try {
      started = await route.provider.stream({
        model: route.model,
        messages,
        maxTokens: route.maxTokens,
        signal: AbortSignal.timeout(STREAM_TIMEOUT_MS),
      });
    } catch {
      await settleOnce({ inputTokens: maxIn, outputTokens: 0 });
      return fallback('provider-error');
    }

    const reader = started.body.getReader();
    const finish = async () => settleOnce(await started.usage.catch(() => ({ inputTokens: maxIn, outputTokens: 0 })));
    const body = new ReadableStream<Uint8Array>({
      async pull(ctl) {
        try {
          const { done, value } = await reader.read();
          if (done) {
            await finish();
            ctl.enqueue(sse('[DONE]'));
            ctl.close();
            return;
          }
          ctl.enqueue(sse(JSON.stringify({ t: value })));
        } catch {
          await finish();
          ctl.enqueue(sse(JSON.stringify({ error: 'provider-error' })));
          ctl.close();
        }
      },
      async cancel(reason) {
        await reader.cancel(reason).catch(() => {});
        await finish();
      },
    });
    return new Response(body, {
      headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', 'x-accel-buffering': 'no' },
    });
  });
