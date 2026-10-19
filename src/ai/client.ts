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

async function call<T>(url: string, body: unknown): Promise<AiResult<T>> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) return await failure(res);
    return { ok: true, data: (await res.json()) as T };
  } catch {
    return { ok: false, fallback: true };
  }
}

export async function getStatus(): Promise<{ ai: 'on' | 'capped' | 'off'; reason?: string }> {
  try {
    const res = await fetch('/api/status');
    if (!res.ok) throw new Error('status');
    return await res.json();
  } catch {
    return { ai: 'off', reason: 'not-configured' };
  }
}

export const placement = (messages: ChatMessage[]) =>
  call<{ reply: string; placement?: Placement }>('/api/placement', { messages });

export const judge = (lessonId: string, answer: string) =>
  call<{ outcome: Outcome; to: string; message: string; feedback: string }>('/api/checkpoint', { lessonId, answer });

export const codeFeedback = (req: { lessonId: string; file: string; code: string; passed: boolean; failedMessages: string[] }) =>
  call<{ feedback: string }>('/api/code-feedback', req);

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
