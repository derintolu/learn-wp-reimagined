import { useEffect, useRef, useState } from 'preact/hooks';
import { useLocation } from 'preact-iso';
import { getStatus, placement as askPlacement, type ChatMessage } from '../ai/client';
import { content } from '../content';
import { getRecordManager } from '../record/useRecord';
import type { Placement } from '../shared/engine';
import type { PathId } from '../shared/types';
import { Bubble } from './Bubble';
import { CapNotice } from './CapNotice';
import { PATH_ORDER } from './PathCards';
import { SketchIcon } from './SketchIcon';
import { Swipe } from './Swipe';

/** Server limits for /api/placement: 4 learner turns, 600 characters a message. */
export const MAX_TURNS = 4;
export const MAX_CHARS = 600;

const PLACEHOLDER = "Not sure where to start? Tell me what you're building.";
const GREETING = "Hi, I'm your tutor. Tell me a little about you, and I'll point you at the right first lesson.";

type AiState = 'loading' | 'on' | 'capped' | 'off';
type Mode = 'chat' | 'placed' | 'choose';

const anyLive = () => PATH_ORDER.some((id) => content.paths[id].status === 'live');
/** Models sometimes emit odd Unicode spaces; show them as plain spaces. */
const tidy = (t: string) => t.replace(/[\u00A0\u2000-\u200B\u202F\u205F\u3000]/g, ' ');
const lessonTitle = (id: string) => content.lessons[id]?.title ?? id;

export function PlacementChat() {
  const { route } = useLocation();
  const [ai, setAi] = useState<AiState>('loading');
  const [mode, setMode] = useState<Mode>(anyLive() ? 'chat' : 'choose');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<Placement | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  const focusRef = useRef<HTMLElement>(null);
  const alive = useRef(true);
  const moveFocus = useRef(false);
  const inFlight = useRef(false);

  useEffect(() => {
    alive.current = true;
    getStatus().then((s) => {
      if (!alive.current) return;
      setAi(s.ai);
      // Only swap an untouched chat; never pull a card or chooser out from under the learner.
      if (s.ai !== 'on') setMode((m) => (m === 'chat' ? 'choose' : m));
    });
    return () => {
      alive.current = false;
    };
  }, []);

  // Keep the newest message in view inside the log.
  useEffect(() => {
    const log = logRef.current;
    if (log) log.scrollTop = log.scrollHeight;
  }, [messages, pending]);

  // Move focus to the card or chooser when it replaces the input, so keyboard users land on it.
  useEffect(() => {
    if (mode !== 'chat' && moveFocus.current) focusRef.current?.focus();
    moveFocus.current = false;
  }, [mode]);

  const turns = messages.filter((m) => m.role === 'user').length;

  async function send(e: Event) {
    e.preventDefault();
    const text = draft.trim().slice(0, MAX_CHARS);
    if (!text || inFlight.current || mode !== 'chat') return;
    inFlight.current = true;
    const history: ChatMessage[] = [...messages, { role: 'user', content: text }];
    setMessages(history);
    setDraft('');
    setPending(true);
    // Tutor replies can run to 800 characters; the server takes 600 a message.
    const res = await askPlacement(history.map((m) => ({ role: m.role, content: m.content.slice(0, MAX_CHARS) })));
    inFlight.current = false;
    if (!alive.current) return;
    setPending(false);
    moveFocus.current = true;
    if (!res.ok || typeof res.data?.reply !== 'string' || !res.data.reply.trim()) {
      setNote("The tutor can't answer right now, so let's do this the quick way. Pick the path that sounds most like you.");
      setMode('choose');
      return;
    }
    setMessages([...history, { role: 'assistant', content: tidy(res.data.reply) }]);
    moveFocus.current = Boolean(res.data.placement) || history.filter((m) => m.role === 'user').length >= MAX_TURNS;
    if (res.data.placement) {
      setResult({ ...res.data.placement, reason: tidy(res.data.placement.reason) });
      setMode('placed');
    } else if (history.filter((m) => m.role === 'user').length >= MAX_TURNS) {
      setNote("That's enough questions from me. Pick whichever path sounds closest. You can always switch later.");
      setMode('choose');
    }
  }

  async function accept(p: Placement) {
    if (leaving) return;
    setLeaving(true);
    try {
      await getRecordManager().dispatch({ type: 'placed', placement: p });
    } catch {
      // A failed save must not strand the learner on the home page; take them to the lesson anyway.
    }
    route(`/learn/${p.startLessonId}`);
    document.getElementById('main')?.focus();
  }

  function choose(id: PathId) {
    const first = content.paths[id].lessons[0];
    if (!first) return;
    accept({ pathId: id, startLessonId: first, skip: [], reason: 'You chose this path.' });
  }

  function chooseMyself() {
    moveFocus.current = true;
    setNote(null);
    setMode('choose');
  }

  const capped = ai === 'capped' || ai === 'off';

  return (
    <div class="placement">
      <div class="hero__chat-head">
        <SketchIcon name="tutor" class="hero__avatar" />
        <span>
          <strong>Your tutor</strong>, running on open models
        </span>
        {ai === 'on' && mode !== 'choose' && (
          <span class="placement__live">
            <span class="placement__live-dot" aria-hidden="true" />
            Live
          </span>
        )}
      </div>

      <div class="chat placement__log" role="log" aria-live="polite" aria-label="Conversation with the tutor" ref={logRef}>
        {!capped && <Bubble from="tutor">{GREETING}</Bubble>}
        {messages.map((m, i) => (
          <Bubble from={m.role === 'user' ? 'learner' : 'tutor'} key={i}>
            {m.content}
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

      {mode === 'chat' && (
        <form class="placement__form" onSubmit={send}>
          <label class="placement__label" for="placement-input">
            Your message
          </label>
          <div class="placement__field">
            <textarea
              id="placement-input"
              class="placement__input"
              rows={2}
              maxLength={MAX_CHARS}
              placeholder={PLACEHOLDER}
              value={draft}
              aria-describedby="placement-count placement-hint"
              onInput={(e) => setDraft((e.currentTarget as HTMLTextAreaElement).value.slice(0, MAX_CHARS))}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) send(e);
              }}
            />
            <button class="button placement__send" type="submit" disabled={pending || !draft.trim()}>
              Send
            </button>
          </div>
          <div class="placement__meta">
            <span id="placement-hint">
              {turns === 0
                ? 'Press Enter to send, Shift+Enter for a new line.'
                : `${MAX_TURNS - turns} more ${MAX_TURNS - turns === 1 ? 'message' : 'messages'} at most.`}
            </span>
            <span id="placement-count" class={draft.length > MAX_CHARS - 60 ? 'placement__count is-near' : 'placement__count'}>
              {draft.length} / {MAX_CHARS}
            </span>
          </div>
          <button type="button" class="placement__skip" onClick={chooseMyself}>
            Skip the chat and choose a path
          </button>
        </form>
      )}

      {mode === 'placed' && result && (
        <PlacementCard
          placement={result}
          headingRef={focusRef}
          busy={leaving}
          onAccept={() => accept(result)}
          onChooseOther={() => {
            moveFocus.current = true;
            setNote(null);
            setMode('choose');
          }}
        />
      )}

      {mode === 'choose' && (
        <div class="placement__choose">
          {capped && <CapNotice state={ai === 'capped' ? 'capped' : 'off'} />}
          {note && <p class="placement__note">{note}</p>}
          <div class="choices" role="group" aria-labelledby="choose-title">
            <h3 id="choose-title" class="choices__title" tabIndex={-1} ref={focusRef as never}>
              Choose your path
            </h3>
            {PATH_ORDER.map((id) => {
              const p = content.paths[id];
              const live = p.status === 'live' && p.lessons.length > 0;
              return (
                <button type="button" class="choice" key={id} disabled={!live || leaving} onClick={() => choose(id)}>
                  <SketchIcon name={id} class="choice__icon" />
                  <span class="choice__text">
                    <span class="choice__title">{p.title}</span>
                    <span class="choice__meta">{live ? `Start at “${lessonTitle(p.lessons[0])}”` : 'Coming soon'}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function PlacementCard({
  placement: p,
  headingRef,
  busy,
  onAccept,
  onChooseOther,
}: {
  placement: Placement;
  headingRef: { current: HTMLElement | null };
  busy: boolean;
  onAccept: () => void;
  onChooseOther: () => void;
}) {
  const path = content.paths[p.pathId];
  return (
    <section class="placement-card" aria-labelledby="placement-card-kicker">
      <p class="placement-card__kicker" id="placement-card-kicker">
        <SketchIcon name={p.pathId} class="placement-card__icon" />
        Your path
      </p>
      <h3 class="placement-card__title" tabIndex={-1} ref={headingRef as never}>
        <Swipe>{path.title}</Swipe>
      </h3>
      <blockquote class="placement-card__reason">
        <p>{p.reason}</p>
      </blockquote>
      <dl class="placement-card__plan">
        <div>
          <dt>Starting at</dt>
          <dd>{lessonTitle(p.startLessonId)}</dd>
        </div>
        {p.skip.length > 0 && (
          <div>
            <dt>Skipping</dt>
            <dd>{p.skip.map(lessonTitle).join(', ')}</dd>
          </div>
        )}
      </dl>
      <div class="placement-card__actions">
        <button type="button" class="button" onClick={onAccept} disabled={busy}>
          Start here
        </button>
        <button type="button" class="button button--quiet" onClick={onChooseOther} disabled={busy}>
          Choose a different path
        </button>
      </div>
    </section>
  );
}
