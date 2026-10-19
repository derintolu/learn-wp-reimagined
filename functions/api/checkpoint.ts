import type { Handler } from '../_lib/env';
import { json, error } from '../_lib/http';
import { readJsonCapped } from '../_lib/guards';
import { callChat, checkText, fallback, guarded, lessonOf, parseObject, preflight } from '../_lib/ai';
import { getContent } from '../_lib/content';
import { judgePrompt, wrapLearner } from '../_lib/prompts';
import { resolveBranch } from '../../src/shared/engine';
import type { Outcome } from '../../src/shared/types';

const SCHEMA = {
  type: 'object',
  properties: { outcome: { type: 'string' }, feedback: { type: 'string' } },
  required: ['outcome', 'feedback'],
};

export const POST: Handler = (req, { env }) =>
  guarded(async () => {
    const pre = await preflight(req, env, 'judge');
    if (pre instanceof Response) return pre;
    const body = await readJsonCapped<{ lessonId?: unknown; answer?: unknown }>(req, 16_000);
    const lesson = lessonOf(body?.lessonId);
    const answer = checkText(body?.answer, 1500, 'answer');
    const cp = lesson.checkpoint;
    if (!cp) return error(404, 'no-checkpoint', 'That lesson has no checkpoint.');
    if (cp.kind !== 'free-text') return error(400, 'not-free-text', 'This checkpoint is checked by its code tests, not by AI.');

    const out = await callChat(
      pre,
      [
        { role: 'system', content: judgePrompt(lesson) },
        { role: 'user', content: wrapLearner(answer) },
      ],
      SCHEMA,
    );
    if (out instanceof Response) return out;
    const parsed = parseObject(out.text);
    const outcome = parsed?.outcome;
    // Only an authored outcome is ever accepted; everything else falls back to the authored options.
    if (typeof outcome !== 'string' || !cp.branches.some((b) => b.outcome === outcome)) return fallback('invalid-response');
    if (typeof parsed?.feedback !== 'string') return fallback('invalid-response');
    const branch = resolveBranch(getContent(), lesson.id, outcome as Outcome);
    return json({ outcome: branch.outcome, to: branch.to, message: branch.message, feedback: parsed.feedback.slice(0, 600) });
  });
