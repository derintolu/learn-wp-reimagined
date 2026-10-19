import type { Handler } from '../_lib/env';
import { json } from '../_lib/http';
import { readJsonCapped } from '../_lib/guards';
import { callChat, checkMessages, fallback, guarded, parseObject, preflight } from '../_lib/ai';
import { getContent } from '../_lib/content';
import { placementPrompt, wrapLearner } from '../_lib/prompts';
import { validatePlacement } from '../../src/shared/engine';

const SCHEMA = {
  type: 'object',
  properties: { reply: { type: 'string' }, done: { type: 'boolean' }, placement: { type: 'object' } },
  required: ['reply', 'done'],
};

export const POST: Handler = (req, { env }) =>
  guarded(async () => {
    const pre = await preflight(req, env, 'placement');
    if (pre instanceof Response) return pre;
    const body = await readJsonCapped<{ messages?: unknown }>(req, 16_000);
    const history = checkMessages(body?.messages, { maxMessages: 9, maxChars: 600, maxUser: 4 });
    const c = getContent();
    const messages = [
      { role: 'system' as const, content: placementPrompt(c) },
      ...history.map((m) => ({ role: m.role, content: m.role === 'user' ? wrapLearner(m.content) : m.content })),
    ];
    const out = await callChat(pre, messages, SCHEMA);
    if (out instanceof Response) return out;
    const parsed = parseObject(out.text);
    if (!parsed || typeof parsed.reply !== 'string' || !parsed.reply) return fallback('invalid-response');
    const result: { reply: string; placement?: unknown } = { reply: parsed.reply.slice(0, 800) };
    if (parsed.done === true && parsed.placement !== undefined) {
      const v = validatePlacement(c, parsed.placement);
      if (v.ok) result.placement = v.placement;
    }
    return json(result);
  });
