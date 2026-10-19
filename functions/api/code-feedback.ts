import type { Handler } from '../_lib/env';
import { json } from '../_lib/http';
import { HttpError, readJsonCapped } from '../_lib/guards';
import { callChat, checkText, guarded, lessonOf, preflight } from '../_lib/ai';
import { feedbackPrompt, wrapLearner } from '../_lib/prompts';

export const POST: Handler = (req, { env }) =>
  guarded(async () => {
    const pre = await preflight(req, env, 'feedback');
    if (pre instanceof Response) return pre;
    const b = await readJsonCapped<Record<string, unknown>>(req, 64_000);
    const lesson = lessonOf(b?.lessonId);
    const file = checkText(b?.file, 200, 'file name');
    const code = checkText(b?.code, 8000, 'code');
    if (typeof b?.passed !== 'boolean') throw new HttpError(400, 'bad-request', 'passed must be true or false.');
    if (!Array.isArray(b.failedMessages) || b.failedMessages.length > 20) {
      throw new HttpError(400, 'bad-request', 'failedMessages must be a short list.');
    }
    const failed = b.failedMessages.map((m) => checkText(m, 300, 'message'));
    const out = await callChat(pre, [
      { role: 'system', content: feedbackPrompt(lesson, file) },
      {
        role: 'user',
        content: `Checks ${b.passed ? 'all passed' : 'failed'}.\nFailed check messages:\n${failed.map((m) => `- ${m}`).join('\n') || '(none)'}\n\n${wrapLearner(code)}`,
      },
    ]);
    if (out instanceof Response) return out;
    return json({ feedback: out.text.trim().slice(0, 1200) });
  });
