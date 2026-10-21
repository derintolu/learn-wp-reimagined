import { Fragment, type ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { tutorStream, type ChatMessage } from '../ai/client';
import { reportAiError, useAiStatus } from '../ai/useAiStatus';
import { content } from '../content';
import type { Lesson } from '../shared/types';
import { Markdown } from '../components/Markdown';
import { tidy } from '../components/PlacementChat';
import { SketchIcon } from '../components/SketchIcon';
import { Composer, MAX_CHARS } from './Composer';
import { NARROW, scrollBehavior, useMedia } from './media';
import { SectionCard } from './SectionCard';

/** Server limit for /api/tutor: 12 messages. */
const MAX_MESSAGES = 12;
const WELCOME =
  "Hi. On the right is a real WordPress running your theme, and the files that make it. Everything we talk about, you'll see and change there.";
/** Phones show one pane at a time, so there is no "right". */
const WELCOME_NARROW =
  "Hi. Your theme runs in a real WordPress in the Workspace tab, next to the files that make it. Everything we talk about, you'll see and change there.";
export const REVIEW_DISCLAIMER = 'Adapted from Learn WordPress, not reviewed by the Training Team';
const FAILURE = "I couldn't answer that just now. Try again in a moment, or check the sources under each section.";

/** One message in the conversation, shown under the beat it was sent in. Not persisted. */
export interface Turn {
  role: 'user' | 'assistant';
  content: string;
  beatIndex: number;
  failed?: boolean;
}

function TutorMsg({ children }: { children: ComponentChildren }) {
  return (
    <div class="msg msg--tutor">
      <SketchIcon name="tutor" class="msg__avatar" />
      <div class="msg__body">
        <p class="msg__who">Tutor</p>
        <div class="msg__text">{children}</div>
      </div>
    </div>
  );
}

function LearnerMsg({ text }: { text: string }) {
  return (
    <div class="msg msg--learner">
      <span class="visually-hidden">You: </span>
      <p class="msg__bubble">{text}</p>
    </div>
  );
}

/**
 * The conversation at the centre of the studio: a welcome, one section card per reached beat with
 * its question, the learner's turns with the tutor under the beat they were sent in, and the
 * composer fixed underneath. Children (the post-beat cards) follow the last section.
 */
export function Feed({
  lesson,
  step,
  readOnly,
  nextLabel,
  onNext,
  children,
}: {
  lesson: Lesson;
  step: number;
  readOnly: boolean;
  nextLabel: string;
  onNext: () => void;
  children?: ComponentChildren;
}) {
  const { ai } = useAiStatus();
  const n = lesson.beats.length;
  const lessonNumber = content.paths[lesson.pathId].lessons.indexOf(lesson.id) + 1;
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  /** Beats whose question the learner has answered (a send that got a reply). */
  const [answered, setAnswered] = useState<ReadonlySet<number>>(new Set());
  /** What each learner turn actually sent, when it differs from what its bubble shows. */
  const sent = useRef(new WeakMap<Turn, string>());
  const ctl = useRef<AbortController | null>(null);
  const feedRef = useRef<HTMLDivElement>(null);
  const activeHeading = useRef<HTMLHeadingElement>(null);
  const shownStep = useRef(step);

  useEffect(() => () => ctl.current?.abort(), []);

  // Keyboard and screen-reader users land on each new section.
  useEffect(() => {
    if (step === shownStep.current) return;
    shownStep.current = step;
    if (step >= n) return;
    const el = activeHeading.current;
    el?.focus({ preventScroll: true });
    el?.scrollIntoView?.({ block: 'start', behavior: scrollBehavior() });
  }, [step]);

  const turnCount = useRef(0);
  useEffect(() => {
    if (turns.length === turnCount.current) return;
    turnCount.current = turns.length;
    const feed = feedRef.current;
    if (feed) feed.scrollTop = feed.scrollHeight;
  }, [turns]);

  async function send(text: string) {
    if (busy || ai !== 'on') return;
    const question = lesson.beats[step]?.question;
    const answering = Boolean(question) && !answered.has(step);
    const wire = (answering ? `Answering your question "${question}": ${text}` : text).slice(0, MAX_CHARS);
    // Only answered pairs go back to the server, newest last, within its message cap.
    const history: ChatMessage[] = turns
      .filter((t) => !t.failed)
      .map((t) => ({ role: t.role, content: (sent.current.get(t) ?? t.content).slice(0, MAX_CHARS) }));
    const messages = [...history, { role: 'user' as const, content: wire }].slice(-(MAX_MESSAGES - 1));
    if (messages[0]?.role === 'assistant') messages.shift();
    const mine: Turn = { role: 'user', content: text, beatIndex: step };
    sent.current.set(mine, wire);
    const base = [...turns, mine];
    setTurns(base);
    setBusy(true);
    const c = new AbortController();
    ctl.current = c;
    let acc = '';
    const at = (t: Omit<Turn, 'beatIndex'>): Turn => ({ ...t, beatIndex: step });
    try {
      // The server only knows the lesson's beats, so a question asked after the last one is about it.
      await tutorStream(
        { lessonId: lesson.id, beatIndex: Math.min(step, n - 1), mode: 'ask', messages },
        (t) => {
          acc += t;
          setTurns([...base, at({ role: 'assistant', content: acc })]);
        },
        c.signal,
      );
      if (c.signal.aborted) return;
      if (!acc.trim()) throw new Error('empty');
      setTurns([...base, at({ role: 'assistant', content: acc })]);
      if (answering) setAnswered((s) => new Set(s).add(step));
    } catch (e) {
      if (c.signal.aborted) return;
      reportAiError(e);
      setTurns([...turns, { ...mine, failed: true }, at({ role: 'assistant', content: FAILURE, failed: true })]);
    } finally {
      if (!c.signal.aborted) setBusy(false);
    }
  }

  const thinking = busy && turns[turns.length - 1]?.role === 'user';
  const turnsAt = (i: number) =>
    turns
      .map((t, k) => [t, k] as const)
      .filter(([t]) => (i < n ? t.beatIndex === i : t.beatIndex >= n))
      .map(([t, k]) =>
        t.role === 'user' ? (
          <LearnerMsg key={k} text={t.content} />
        ) : (
          <TutorMsg key={k}>{t.failed ? <p>{t.content}</p> : <Markdown text={tidy(t.content)} />}</TutorMsg>
        ),
      );
  const typing = (
    <TutorMsg>
      <span class="visually-hidden">The tutor is thinking…</span>
      <span class="typing" aria-hidden="true">
        <span />
        <span />
        <span />
      </span>
    </TutorMsg>
  );
  const shown = readOnly ? n : Math.min(step + 1, n);
  const narrow = useMedia(NARROW);

  return (
    <div class="stage">
      <div class="feed" id="feed" tabIndex={-1} role="log" aria-live="polite" aria-label="Lesson conversation" ref={feedRef}>
        <div class="feed__inner">
          <div class="feed-head">
            <p class="feed-head__eyebrow">
              Lesson {lessonNumber} · {lesson.minutes} min
            </p>
            <h1 class="feed-head__title">{lesson.title}</h1>
            <p class="feed-head__note">{REVIEW_DISCLAIMER}</p>
          </div>
          <TutorMsg>
            <p>{narrow ? WELCOME_NARROW : WELCOME}</p>
          </TutorMsg>
          {lesson.beats.slice(0, shown).map((beat, i) => (
            <Fragment key={i}>
              <SectionCard
                lesson={lesson}
                index={i}
                number={`${lessonNumber}.${i + 1}`}
                active={!readOnly && i === step}
                headingRef={i === step ? activeHeading : undefined}
              />
              {beat.question && (
                <TutorMsg>
                  <p>{beat.question}</p>
                </TutorMsg>
              )}
              {turnsAt(i)}
              {thinking && i === step && typing}
              {!readOnly && i === step && (
                <div class="feed__continue">
                  <button type="button" class="button" onClick={onNext}>
                    {nextLabel}
                    <span aria-hidden="true">→</span>
                  </button>
                </div>
              )}
            </Fragment>
          ))}
          {children}
          {turnsAt(n)}
          {thinking && step >= n && typing}
        </div>
      </div>
      {!readOnly && <Composer ai={ai} busy={busy} onSend={send} />}
    </div>
  );
}
