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

    // Settles exactly once. On the cancel and error paths it is fired without awaiting (R28): a
    // client that went away must not keep the worker waiting on the database, which on Spacefast
    // showed up as a hung worker and a 30s transport timeout.
    let settled = false;
    const settleOnce = (usage: Usage): Promise<void> => {
      if (settled) return Promise.resolve();
      settled = true;
      return settle(db, r.reservation, route.model, usage).catch((e) => console.error('settle failed', (e as Error)?.message));
    };
    const worstCase = (): Usage => ({ inputTokens: maxIn, outputTokens: route.maxTokens });

    let started: Awaited<ReturnType<typeof route.provider.stream>>;
    try {
      started = await route.provider.stream({
        model: route.model,
        messages,
        maxTokens: route.maxTokens,
        // The request's own signal stops the provider call when the client goes away.
        signal: AbortSignal.any([req.signal, AbortSignal.timeout(STREAM_TIMEOUT_MS)]),
      });
    } catch {
      void settleOnce({ inputTokens: maxIn, outputTokens: 0 });
      return fallback('provider-error');
    }

    const reader = started.body.getReader();
    // Never waits forever on usage: a provider that never resolves it settles at the worst case.
    const usageNow = () =>
      Promise.race([
        started.usage.catch(worstCase),
        new Promise<Usage>((res) => setTimeout(() => res(worstCase()), 1000)),
      ]);
    // Enqueue/close throw once the consumer has cancelled; that must not surface as an exception.
    const safe = (f: () => void) => {
      try {
        f();
      } catch {
        /* stream already cancelled */
      }
    };
    const body = new ReadableStream<Uint8Array>({
      async pull(ctl) {
        let chunk: ReadableStreamReadResult<string>;
        try {
          chunk = await reader.read();
        } catch {
          void usageNow().then(settleOnce);
          safe(() => {
            ctl.enqueue(sse(JSON.stringify({ error: 'provider-error' })));
            ctl.close();
          });
          return;
        }
        if (chunk.done) {
          await settleOnce(await usageNow());
          safe(() => {
            ctl.enqueue(sse('[DONE]'));
            ctl.close();
          });
          return;
        }
        safe(() => ctl.enqueue(sse(JSON.stringify({ t: chunk.value }))));
      },
      cancel(reason) {
        void reader.cancel(reason).catch(() => {});
        void usageNow().then(settleOnce);
      },
    });
    return new Response(body, {
      headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', 'x-accel-buffering': 'no' },
    });
  });
