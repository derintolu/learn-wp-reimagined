import { JSON_TIMEOUT_MS } from '../ai/client';

export type AgentResult<T> = { ok: true; data: T } | { ok: false; message: string };

export const NO_ANSWER = "The connector didn't answer. Try again in a moment.";
const GENERIC = 'Something went wrong. Try again in a moment.';

/** POSTs JSON to /api/agent/* and /api/oauth/revoke-all; any handle travels in the body, never in a URL. */
async function post<T>(path: string, body: unknown): Promise<AgentResult<T>> {
  const ctl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    ctl.abort();
  }, JSON_TIMEOUT_MS);
  try {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctl.signal,
    });
    if (!res.ok) {
      let message = GENERIC;
      try {
        const j = await res.json();
        if (typeof j?.error?.message === 'string') message = j.error.message;
      } catch {
        // keep the generic message
      }
      return { ok: false, message };
    }
    return { ok: true, data: (await res.json()) as T };
  } catch {
    return { ok: false, message: timedOut ? NO_ANSWER : GENERIC };
  } finally {
    clearTimeout(timer);
  }
}

export const startHandoff = (lessonId: string, files: Record<string, string>) =>
  post<{ handle: string; mcpUrl: string; prompt: string }>('/api/agent/handoff', { lessonId, files });

export const fetchAgentRecord = (handle: string) => post<{ record: unknown }>('/api/agent/record', { handle });

export const deleteAgentRecord = (handle: string) => post<{ deleted: boolean }>('/api/agent/delete', { handle });

/** "Disconnect agents": ends every agent sign-in of this learner. JSON only, with the session cookie. */
export const revokeAllAgents = () => post<{ revoked: number }>('/api/oauth/revoke-all', {});
