import { useRef, useState } from 'preact/hooks';
import type { AiState } from '../ai/useAiStatus';
import { CapNotice } from '../components/CapNotice';

/** Server limit for /api/tutor: 1500 characters a message. */
export const MAX_CHARS = 1500;

/** The message box fixed under the feed. Capped or off, it is the cap notice instead. */
export function Composer({ ai, busy, onSend }: { ai: AiState; busy: boolean; onSend: (text: string) => void }) {
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);

  function submit(e: Event) {
    e.preventDefault();
    const text = draft.trim().slice(0, MAX_CHARS);
    if (!text || busy) return;
    setDraft('');
    onSend(text);
    inputRef.current?.focus();
  }

  return (
    <div class="composer">
      {ai === 'on' && (
        <form class="composer__form" onSubmit={submit}>
          <label class="visually-hidden" for="composer-input">
            Message the tutor
          </label>
          <textarea
            ref={inputRef}
            id="composer-input"
            class="composer__input"
            rows={1}
            maxLength={MAX_CHARS}
            placeholder="Answer, or ask the tutor anything"
            value={draft}
            onInput={(e) => setDraft((e.currentTarget as HTMLTextAreaElement).value.slice(0, MAX_CHARS))}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) submit(e);
            }}
          />
          <button class="button composer__send" type="submit" disabled={busy || !draft.trim()}>
            Send
          </button>
        </form>
      )}
      {ai === 'loading' && (
        <div class="composer__loading" role="status">
          <span class="visually-hidden">Connecting to the tutor…</span>
          <span class="composer__skeleton" aria-hidden="true" />
        </div>
      )}
      {(ai === 'capped' || ai === 'off') && <CapNotice />}
    </div>
  );
}
