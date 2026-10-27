import type { Outcome } from '../shared/types';
import type { Placement } from '../shared/engine';

export type AiResult<T> = { ok: true; data: T } | { ok: false; fallback: true; reason?: string; message?: string };
export interface ChatMessage { role: 'user' | 'assistant'; content: string }
export interface TutorRequest { lessonId: string; beatIndex: number; mode: 'deliver' | 'ask'; messages: ChatMessage[] }

/** Thrown by tutorStream when the AI is unavailable or fails; the UI shows its no-AI version. */
export class AiFallbackError extends Error {
  /** `serverMessage` is the server's friendly text, e.g. for a 429. */
  constructor(
    public reason?: string,
    public serverMessage?: string,
  ) {
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

/** How long the status check waits before reporting the AI off (R27). */
export const STATUS_TIMEOUT_MS = 5000;
/** How long a JSON AI call (placement, judge, code feedback) waits before falling back (R27). */
export const JSON_TIMEOUT_MS = 20_000;
/**
 * A tutor stream that sends nothing for this long falls back to the authored text (R28).
 * Spacefast buffers the response, so in practice this bounds the whole reply.
 */
export const STREAM_STALL_MS = 25_000;

const CLIENT_ID_KEY = 'lwr-client-id';
const CLIENT_ID_RE = /^[A-Za-z0-9-]{16,64}$/;
let memoryClientId: string | undefined;

function newClientId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

/**
 * A random id made once per browser and sent as `x-client-id`, so the server can rate-limit
 * per visitor where the platform gives it no visitor IP (R26). Not an identity or a secret.
 * Falls back to an in-memory id when localStorage is missing or throws.
 */
export function clientId(): string {
  try {
    const stored = localStorage.getItem(CLIENT_ID_KEY);
    if (stored && CLIENT_ID_RE.test(stored)) return stored;
    const id = memoryClientId ?? newClientId();
    localStorage.setItem(CLIENT_ID_KEY, id);
    memoryClientId = id;
    return id;
  } catch {
    return (memoryClientId ??= newClientId());
  }
}

/** For tests: forget the in-memory client id. */
export function resetClientIdForTests() {
  memoryClientId = undefined;
}

const apiHeaders = (json: boolean): Record<string, string> => ({
  ...(json ? { 'content-type': 'application/json' } : {}),
  'x-client-id': clientId(),
});

/**
 * A signal that aborts after `ms` or when the caller's signal aborts.
 * Uses setTimeout rather than AbortSignal.timeout so it is cancellable and testable.
 */
function withTimeout(ms: number, signal?: AbortSignal): { signal: AbortSignal; timedOut: () => boolean; done: () => void } {
  const ctl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    ctl.abort();
  }, ms);
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
  const t = withTimeout(JSON_TIMEOUT_MS, signal);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: apiHeaders(true),
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
  const t = withTimeout(STATUS_TIMEOUT_MS, signal);
  try {
    const res = await fetch('/api/status', { headers: apiHeaders(false), signal: t.signal });
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
  call<{ outcome: Outcome; to: string; message: string; feedback: string; decisionId?: string }>('/api/checkpoint', { lessonId, answer }, signal);

export const codeFeedback = (
  req: { lessonId: string; file: string; code: string; passed: boolean; failedMessages: string[] },
  signal?: AbortSignal,
) => call<{ feedback: string }>('/api/code-feedback', req, signal);

/**
 * Streams the tutor reply, calling onText for each chunk. Rejects with AiFallbackError on any
 * failure, including STREAM_STALL_MS with no bytes (reason 'timeout').
 */
export async function tutorStream(req: TutorRequest, onText: (t: string) => void, signal?: AbortSignal): Promise<void> {
  const ctl = new AbortController();
  let stalled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const arm = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      stalled = true;
      ctl.abort();
    }, STREAM_STALL_MS);
  };
  const onAbort = () => ctl.abort();
  if (signal?.aborted) ctl.abort();
  else signal?.addEventListener('abort', onAbort, { once: true });
  const fail = (reason: string) => new AiFallbackError(stalled ? 'timeout' : reason);
  arm();
  try {
    let res: Response;
    try {
      res = await fetch('/api/tutor', {
        method: 'POST',
        headers: apiHeaders(true),
        body: JSON.stringify(req),
        signal: ctl.signal,
      });
    } catch {
      throw fail('network');
    }
    if (!res.ok || !res.body) {
      const f = await failure(res);
      throw new AiFallbackError(f.reason, f.message);
    }

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
          throw fail('network');
        }
        if (stalled) throw fail('timeout');
        arm();
        buf += dec.decode(chunk.value, { stream: !chunk.done });
        const parts = buf.split(/\r?\n\r?\n/);
        buf = chunk.done ? '' : (parts.pop() ?? '');
        for (const p of parts) if (handle(p)) return;
        if (chunk.done) throw new AiFallbackError('truncated');
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}
