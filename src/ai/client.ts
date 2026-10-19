import type { Outcome } from '../shared/types';
import type { Placement } from '../shared/engine';

export type AiResult<T> = { ok: true; data: T } | { ok: false; fallback: true; reason?: string; message?: string };
export interface ChatMessage { role: 'user' | 'assistant'; content: string }
export interface TutorRequest { lessonId: string; beatIndex: number; mode: 'deliver' | 'ask'; messages: ChatMessage[] }

/** Thrown by tutorStream when the AI is unavailable or fails; the UI shows its no-AI version. */
export class AiFallbackError extends Error {
  constructor(public reason?: string) {
    super(`AI unavailable${reason ? `: ${reason}` : ''}`);
    this.name = 'AiFallbackError';
  }
}

async function failure(res: Response): Promise<{ ok: false; fallback: true; reason?: string; message?: string }> {
  try {
    const j = await res.json();
    return { ok: false, fallback: true, reason: j?.reason ?? j?.error?.code, message: j?.error?.message };
  } catch {
    return { ok: false, fallback: true };
  }
}

/** How long a JSON call (or the status check) waits before falling back. */
export const JSON_TIMEOUT_MS = 8000;

/**
 * A signal that aborts after JSON_TIMEOUT_MS or when the caller's signal aborts.
 * Uses setTimeout rather than AbortSignal.timeout so it is cancellable and testable.
 */
function withTimeout(signal?: AbortSignal): { signal: AbortSignal; timedOut: () => boolean; done: () => void } {
  const ctl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    ctl.abort();
  }, JSON_TIMEOUT_MS);
  const onAbort = () => ctl.abort();
  if (signal?.aborted) ctl.abort();
  else signal?.addEventListener('abort', onAbort, { once: true });
  return {
    signal: ctl.signal,
    timedOut: () => timedOut,
    done: () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    },
  };
}

async function call<T>(url: string, body: unknown, signal?: AbortSignal): Promise<AiResult<T>> {
  const t = withTimeout(signal);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: t.signal,
    });
    if (!res.ok) return await failure(res);
    return { ok: true, data: (await res.json()) as T };
  } catch {
    return t.timedOut() ? { ok: false, fallback: true, reason: 'timeout' } : { ok: false, fallback: true };
  } finally {
    t.done();
  }
}

export async function getStatus(signal?: AbortSignal): Promise<{ ai: 'on' | 'capped' | 'off'; reason?: string }> {
  const t = withTimeout(signal);
  try {
    const res = await fetch('/api/status', { signal: t.signal });
    if (!res.ok) throw new Error('status');
    return await res.json();
  } catch {
    return { ai: 'off', reason: t.timedOut() ? 'timeout' : 'not-configured' };
  } finally {
    t.done();
  }
}

export const placement = (messages: ChatMessage[], signal?: AbortSignal) =>
  call<{ reply: string; placement?: Placement }>('/api/placement', { messages }, signal);

export const judge = (lessonId: string, answer: string, signal?: AbortSignal) =>
  call<{ outcome: Outcome; to: string; message: string; feedback: string }>('/api/checkpoint', { lessonId, answer }, signal);

export const codeFeedback = (
  req: { lessonId: string; file: string; code: string; passed: boolean; failedMessages: string[] },
  signal?: AbortSignal,
) => call<{ feedback: string }>('/api/code-feedback', req, signal);

/** Streams the tutor reply, calling onText for each chunk. Rejects with AiFallbackError on any failure. */
export async function tutorStream(req: TutorRequest, onText: (t: string) => void, signal?: AbortSignal): Promise<void> {
  let res: Response;
  try {
    res = await fetch('/api/tutor', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(req),
      signal,
    });
  } catch {
    throw new AiFallbackError('network');
  }
  if (!res.ok || !res.body) throw new AiFallbackError((await failure(res)).reason);

  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  const handle = (event: string): boolean => {
    const data = event
      .split(/\r?\n/)
      .filter((l) => l.startsWith('data:'))
      .map((l) => l.slice(5).replace(/^ /, ''))
      .join('\n');
    if (!data) return false;
    if (data === '[DONE]') return true;
    let j: { t?: unknown; error?: unknown };
    try {
      j = JSON.parse(data);
    } catch {
      return false;
    }
    if (typeof j.error === 'string') throw new AiFallbackError(j.error);
    if (typeof j.t === 'string') onText(j.t);
    return false;
  };
  try {
    for (;;) {
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await reader.read();
      } catch {
        throw new AiFallbackError('network');
      }
      buf += dec.decode(chunk.value, { stream: !chunk.done });
      const parts = buf.split(/\r?\n\r?\n/);
      buf = chunk.done ? '' : (parts.pop() ?? '');
      for (const p of parts) if (handle(p)) return;
      if (chunk.done) throw new AiFallbackError('truncated');
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
}
