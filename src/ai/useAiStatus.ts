import { useEffect, useState } from 'preact/hooks';
import { getStatus } from './client';

export type AiState = 'loading' | 'on' | 'capped' | 'off';

/** The AI status for this page: 'loading' until /api/status answers (or times out to 'off'). */
export function useAiStatus(): AiState {
  const [ai, setAi] = useState<AiState>('loading');
  useEffect(() => {
    const ctl = new AbortController();
    getStatus(ctl.signal).then((s) => {
      if (!ctl.signal.aborted) setAi(s.ai);
    });
    return () => ctl.abort();
  }, []);
  return ai;
}
