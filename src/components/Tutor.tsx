import { useEffect, useRef, useState } from 'preact/hooks';
import { tutorStream, type ChatMessage } from '../ai/client';
import type { AiState } from '../ai/useAiStatus';
import type { Lesson } from '../shared/types';
import { Bubble } from './Bubble';
import { CapNotice } from './CapNotice';
import { Markdown } from './Markdown';
import { tidy } from './PlacementChat';
import { SketchIcon } from './SketchIcon';

/** Server limits for /api/tutor: 12 messages, 1500 characters each. */
const MAX_MESSAGES = 12;
const MAX_CHARS = 1500;
const MOBILE = '(max-width: 767.98px)';

function useMedia(query: string): boolean {
  const get = () => typeof matchMedia === 'function' && matchMedia(query).matches;
  const [matches, setMatches] = useState(get);
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const mq = matchMedia(query);
    const on = () => setMatches(mq.matches);
    on();
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, [query]);
  return matches;
}

interface Turn extends ChatMessage {
  failed?: boolean;
}

/** The lesson tutor: docked beside the lesson, a bottom sheet on phones. */
export function Tutor({ lesson, beatIndex, ai }: { lesson: Lesson; beatIndex: number; ai: AiState }) {
  const mobile = useMedia(MOBILE);
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const ctl = useRef<AbortController | null>(null);

  useEffect(() => () => ctl.current?.abort(), []);
  useEffect(() => {
    const log = logRef.current;
    if (log) log.scrollTop = log.scrollHeight;
  }, [turns, pending]);
  const returnFocus = useRef(false);
  useEffect(() => {
    if (mobile && open) inputRef.current?.focus();
    // The toggle is hidden while the sheet is open, so hand focus back once it shows again.
    if (!open && returnFocus.current) toggleRef.current?.focus();
    returnFocus.current = false;
  }, [open, mobile]);
  const panelRef = useRef<HTMLDivElement>(null);
  // An open sheet is modal: the page behind goes inert and Tab stays inside the sheet.
  useEffect(() => {
    if (!mobile || !open) return;
    const behind = [...document.querySelectorAll<HTMLElement>('.site-header, .site-footer, .lesson-head, .lesson__read')];
    const was = behind.map((el) => el.inert);
    behind.forEach((el) => (el.inert = true));
    if (!inputRef.current) panelRef.current?.querySelector<HTMLElement>('button')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        close();
        return;
      }
      if (e.key !== 'Tab' || !panelRef.current) return;
      const items = [
        ...panelRef.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), textarea, input, [tabindex]:not([tabindex="-1"])'),
      ].filter((el) => !el.hasAttribute('inert') && el.offsetParent !== null);
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      const at = document.activeElement;
      if (e.shiftKey && (at === first || !panelRef.current.contains(at))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (at === last || !panelRef.current.contains(at))) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      behind.forEach((el, i) => (el.inert = was[i]));
    };
  }, [mobile, open]);

  function close() {
    returnFocus.current = true;
    setOpen(false);
  }

  async function ask(e: Event) {
    e.preventDefault();
    const q = draft.trim().slice(0, MAX_CHARS);
    if (!q || pending || ai !== 'on') return;
    // Only answered pairs go back to the server, newest last, within its message cap.
    const history: ChatMessage[] = turns
      .filter((t) => !t.failed)
      .map(({ role, content }) => ({ role, content: content.slice(0, MAX_CHARS) }));
    const messages = [...history, { role: 'user' as const, content: q }].slice(-(MAX_MESSAGES - 1));
    if (messages[0]?.role === 'assistant') messages.shift();
    const base: Turn[] = [...turns, { role: 'user', content: q }];
    setTurns(base);
    setDraft('');
    setPending(true);
    inputRef.current?.focus();
    const c = new AbortController();
    ctl.current = c;
    let acc = '';
    try {
      await tutorStream(
        { lessonId: lesson.id, beatIndex, mode: 'ask', messages },
        (t) => {
          acc += t;
          setPending(false);
          setTurns([...base, { role: 'assistant', content: acc }]);
        },
        c.signal,
      );
      if (c.signal.aborted) return;
      if (!acc.trim()) throw new Error('empty');
      setTurns([...base, { role: 'assistant', content: acc }]);
    } catch {
      if (c.signal.aborted) return;
      setTurns([
        ...base.slice(0, -1),
        { role: 'user', content: q, failed: true },
        {
          role: 'assistant',
          failed: true,
          content: "I couldn't answer that just now. Try again in a moment, or check the sources linked at the top of the lesson.",
        },
      ]);
    } finally {
      if (!c.signal.aborted) setPending(false);
    }
  }

  const sheetHidden = mobile && !open;

  return (
    <aside class={`tutor${open ? ' is-open' : ''}`} aria-label="Lesson tutor">
      {mobile && (
        <button
          type="button"
          class="tutor__toggle"
          ref={toggleRef}
          aria-expanded={open}
          aria-controls="tutor-panel"
          onClick={() => (open ? close() : setOpen(true))}
        >
          <SketchIcon name="tutor" class="tutor__toggle-icon" />
          <span>{open ? 'Hide the tutor' : 'Ask the tutor'}</span>
          {ai === 'on' && <span class="placement__live-dot" aria-hidden="true" />}
        </button>
      )}
      {mobile && open && <div class="tutor__scrim" onClick={close} aria-hidden="true" />}
      <div
        class="tutor__panel"
        id="tutor-panel"
        ref={panelRef}
        inert={sheetHidden || undefined}
        {...(mobile && open ? { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Lesson tutor' } : {})}
      >
        <div class="tutor__head hero__chat-head">
          <SketchIcon name="tutor" class="hero__avatar" />
          <span>
            <strong>Your tutor</strong>, grounded in this lesson
          </span>
          {ai === 'on' && (
            <span class="placement__live">
              <span class="placement__live-dot" aria-hidden="true" />
              Live
            </span>
          )}
          {mobile && (
            <button type="button" class="tutor__close" onClick={close}>
              <span class="visually-hidden">Close the tutor</span>
              <span aria-hidden="true">×</span>
            </button>
          )}
        </div>

        <div class="chat tutor__log" role="log" aria-live="polite" aria-label="Conversation with the tutor" ref={logRef}>
          {(ai === 'on' || ai === 'loading') && (
            <Bubble from="tutor">
              Stuck on something? Ask me about “{lesson.title}”. I'll stick to this lesson and point you to the sources
              when I'm unsure.
            </Bubble>
          )}
          {turns.map((t, i) => (
            <Bubble from={t.role === 'user' ? 'learner' : 'tutor'} key={i}>
              {t.role === 'assistant' && !t.failed ? <Markdown text={tidy(t.content)} /> : t.content}
            </Bubble>
          ))}
          {pending && (
            <div class="bubble bubble--tutor bubble--thinking">
              <span class="visually-hidden">The tutor is thinking…</span>
              <span class="thinking" aria-hidden="true">
                <span />
                <span />
                <span />
              </span>
            </div>
          )}
        </div>

        {ai === 'on' && (
          <form class="tutor__form" onSubmit={ask}>
            <label class="placement__label" for="tutor-input">
              Ask the tutor
            </label>
            <div class="placement__field">
              <textarea
                ref={inputRef}
                id="tutor-input"
                class="placement__input"
                rows={2}
                maxLength={MAX_CHARS}
                placeholder="Ask about this lesson"
                value={draft}
                onInput={(e) => setDraft((e.currentTarget as HTMLTextAreaElement).value.slice(0, MAX_CHARS))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) ask(e);
                }}
              />
              <button class="button placement__send" type="submit" disabled={pending || !draft.trim()}>
                Ask
              </button>
            </div>
          </form>
        )}
        {ai === 'loading' && (
          <div class="tutor__loading" role="status">
            <span class="visually-hidden">Connecting to the tutor…</span>
            <span class="placement__skeleton placement__skeleton--field" aria-hidden="true" />
          </div>
        )}
        {(ai === 'capped' || ai === 'off') && (
          <div class="tutor__cap">
            <CapNotice state={ai} />
          </div>
        )}
      </div>
    </aside>
  );
}
