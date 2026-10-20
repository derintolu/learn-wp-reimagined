import { useEffect, useState } from 'preact/hooks';
import { getStatus } from './client';

export type AiState = 'loading' | 'on' | 'capped' | 'off';

/**
 * The page's AI status, shared by every component on it. `reason` says why it is capped or off
 * (`day-cap`, `month-cap`, `rate-limited`, `not-configured`, `timeout`); `message` is the server's
 * friendly text for a 429.
 */
export interface AiStatus {
  ai: AiState;
  reason?: string;
  message?: string;
}

const LOADING: AiStatus = { ai: 'loading' };
let state: AiStatus = LOADING;
const listeners = new Set<(s: AiStatus) => void>();
/** Components that own the status (a page). The first one to mount fetches /api/status afresh. */
let owners = 0;
let fetching: AbortController | null = null;

function set(next: AiStatus) {
  state = next;
  for (const l of listeners) l(state);
}

function useSubscribe(): AiStatus {
  const [s, setS] = useState<AiStatus>(() => (owners === 0 ? LOADING : state));
  useEffect(() => {
    listeners.add(setS);
    setS(state);
    return () => {
      listeners.delete(setS);
    };
  }, []);
  return s;
}

/**
 * The AI status for this page: 'loading' until /api/status answers (or times out to 'off').
 * Use once per page; pass `ai` down, or read it with `useAiStatusValue`. Any AI call that comes
 * back capped or rate-limited updates it through `reportAiFailure`, so the whole page shows it.
 */
export function useAiStatus(): AiStatus {
  const s = useSubscribe();
  useEffect(() => {
    owners++;
    if (owners === 1) {
      set(LOADING);
      const ctl = new AbortController();
      fetching = ctl;
      getStatus(ctl.signal).then((r) => {
        if (ctl.signal.aborted || fetching !== ctl) return;
        fetching = null;
        // A call that already reported a cap while the status was in flight wins.
        if (state.ai === 'loading') set({ ai: r.ai, reason: r.reason });
      });
    }
    return () => {
      owners--;
      if (owners === 0) {
        fetching?.abort();
        fetching = null;
      }
    };
  }, []);
  return s;
}

/** Reads the shared status without fetching it (for notices inside a page that owns it). */
export function useAiStatusValue(): AiStatus {
  return useSubscribe();
}

const CAP_REASONS = new Set(['day-cap', 'month-cap']);

/**
 * Call with the failure of any AI call. A spending cap, a rate limit or a switched-off AI turns the
 * shared status to capped or off, so CapNotice shows everywhere on the page. Other failures (a
 * timeout, a provider error) are one-off and leave it alone.
 */
export function reportAiFailure(f: { reason?: string; message?: string }): void {
  const reason = f.reason;
  if (!reason) return;
  if (CAP_REASONS.has(reason)) set({ ai: 'capped', reason });
  else if (reason === 'rate-limited') set({ ai: 'capped', reason, message: f.message });
  else if (reason === 'off' || reason === 'not-configured') set({ ai: 'off', reason });
}

/** The same, for a thrown tutorStream AiFallbackError (read by shape, so mocks of the client still work). */
export function reportAiError(e: unknown): void {
  if (!e || typeof e !== 'object') return;
  const { reason, serverMessage } = e as { reason?: unknown; serverMessage?: unknown };
  if (typeof reason === 'string') reportAiFailure({ reason, message: typeof serverMessage === 'string' ? serverMessage : undefined });
}

/** For tests: forget the shared status (call after unmounting everything). */
export function resetAiStatusForTests(): void {
  state = LOADING;
}
