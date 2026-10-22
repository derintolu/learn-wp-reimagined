import type { Env, D1Like } from './env';
import { error, json } from './http';
import { ANON_LIMIT, CLIENT_LIMIT, GLOBAL_KEY, GLOBAL_LIMIT, HttpError, RATE_WINDOW_MS, clientKey } from './guards';
import { ensureSchema } from './db';
import { rateLimit } from './ratelimit';
import { reserve, settle } from './budget';
import { routeFor } from './providers';
import { ProviderHttpError, type ChatMessage, type Task, type Usage } from './providers/types';
import { getContent } from './content';
import type { Lesson } from '../../src/shared/types';

export type Route = NonNullable<ReturnType<typeof routeFor>>;
/** Server provider timeout for JSON calls; below the client's 20s (R27) so the server answers first. */
export const CHAT_TIMEOUT_MS = 15_000;
export const STREAM_TIMEOUT_MS = 60_000;

export const fallback = (reason: string) => json({ fallback: true, reason }, 503);

/** Characters are a safe upper bound on tokens, so this bounds the input cost of one request. */
export const inputBound = (messages: ChatMessage[]) => messages.reduce((n, m) => n + m.content.length, 0);

/** Runs a handler, mapping HttpError and unexpected failures to JSON error responses. */
export async function guarded(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof HttpError) return error(e.status, e.code, e.message);
    return error(500, 'server-error', 'Something went wrong.');
  }
}

/** ensureSchema, then rate limit, then route lookup. Returns a Response when the request must stop. */
export async function preflight(req: Request, env: Env, task: Task): Promise<{ db: D1Like; route: Route } | Response> {
  await ensureSchema(env.DB);
  const key = clientKey(req, env);
  const now = Date.now();
  // Per client first, so a client that is already blocked never uses up the global ceiling.
  const allowed =
    (await rateLimit(env.DB, key, now, key === 'anon' ? ANON_LIMIT : CLIENT_LIMIT, RATE_WINDOW_MS)) &&
    (await rateLimit(env.DB, GLOBAL_KEY, now, GLOBAL_LIMIT, RATE_WINDOW_MS));
  if (!allowed) {
    return error(429, 'rate-limited', 'You are going a little fast. Please wait a few minutes and try again.');
  }
  const route = routeFor(task, env);
  if (!route) return fallback('not-configured');
  return { db: env.DB, route };
}

export function checkText(value: unknown, max: number, what: string): string {
  if (typeof value !== 'string') throw new HttpError(400, 'bad-request', `${what} must be text.`);
  if (value.length > max) throw new HttpError(413, 'too-large', `That ${what} is too long (limit ${max} characters). Please shorten it.`);
  return value;
}

/** Validates user/assistant turns: roles, per-message length, counts. */
export function checkMessages(
  raw: unknown,
  o: { maxMessages: number; maxChars: number; maxUser?: number },
): { role: 'user' | 'assistant'; content: string }[] {
  if (!Array.isArray(raw)) throw new HttpError(400, 'bad-request', 'messages must be a list.');
  if (raw.length > o.maxMessages) throw new HttpError(400, 'too-many-messages', 'That conversation is too long.');
  const out = raw.map((m): { role: 'user' | 'assistant'; content: string } => {
    const r = m as { role?: unknown; content?: unknown } | null;
    if (!r || (r.role !== 'user' && r.role !== 'assistant')) throw new HttpError(400, 'bad-request', 'Bad message role.');
    return { role: r.role, content: checkText(r.content, o.maxChars, 'message') };
  });
  if (o.maxUser !== undefined && out.filter((m) => m.role === 'user').length > o.maxUser) {
    throw new HttpError(400, 'too-many-turns', 'That conversation is too long.');
  }
  return out;
}

export function lessonOf(lessonId: unknown): Lesson {
  const c = getContent();
  if (typeof lessonId !== 'string' || !Object.prototype.hasOwnProperty.call(c.lessons, lessonId)) {
    throw new HttpError(404, 'no-lesson', 'No such lesson.');
  }
  return c.lessons[lessonId];
}

/** reserve, chat (with timeout), settle exactly once. A refusal or provider failure is a fallback Response. */
export async function callChat(
  { db, route }: { db: D1Like; route: Route },
  messages: ChatMessage[],
  schema?: object,
): Promise<{ text: string } | Response> {
  const maxIn = inputBound(messages);
  const r = await reserve(db, route.model, maxIn, route.maxTokens, new Date());
  if (!r.ok) return fallback(r.reason);
  // Until the provider answers, assume the worst case: an aborted or timed-out call may still be billed.
  let usage: Usage = { inputTokens: maxIn, outputTokens: route.maxTokens };
  try {
    const res = await route.provider.chat({
      model: route.model,
      messages,
      maxTokens: route.maxTokens,
      json: schema,
      ...(route.reasoningEffort ? { reasoningEffort: route.reasoningEffort } : {}),
      signal: AbortSignal.timeout(CHAT_TIMEOUT_MS),
    });
    usage = res.usage;
    return { text: res.text };
  } catch (e) {
    // Refund the output only when the provider definitely refused the request.
    if (e instanceof ProviderHttpError) usage = { inputTokens: maxIn, outputTokens: 0 };
    return fallback('provider-error');
  } finally {
    await settle(db, r.reservation, route.model, usage).catch((e) => console.error('settle failed', (e as Error)?.message));
  }
}

/** Parses a JSON object from model text; null if it is not a plain object. */
export function parseObject(text: string): Record<string, unknown> | null {
  const t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    const v = JSON.parse(t);
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
