import { useEffect, useRef, useState } from 'preact/hooks';
import { tutorStream } from '../ai/client';
import type { AiState } from '../ai/useAiStatus';
import type { Lesson } from '../shared/types';
import { Markdown } from './Markdown';
import { tidy } from './PlacementChat';
import { SketchIcon } from './SketchIcon';

/** Deliveries already streamed this session, so revisiting a beat never pays for it twice. */
const delivered = new Map<string, string>();
const keyOf = (lessonId: string, i: number) => `${lessonId}#${i}`;

/** For tests: forget cached deliveries. */
export function clearDeliveries() {
  delivered.clear();
}

type Voice = 'waiting' | 'streaming' | 'tutor' | 'authored';

export function BeatView({
  lesson,
  index,
  active,
  done,
  ai,
  nextLabel,
  onNext,
  headingRef,
}: {
  lesson: Lesson;
  index: number;
  active: boolean;
  done: boolean;
  ai: AiState;
  nextLabel: string;
  onNext: () => void;
  headingRef?: { current: HTMLHeadingElement | null };
}) {
  const beat = lesson.beats[index];
  const key = keyOf(lesson.id, index);
  const cached = delivered.get(key);
  const [text, setText] = useState(cached ?? '');
  const [voice, setVoice] = useState<Voice>(cached ? 'tutor' : active && ai !== 'off' && ai !== 'capped' ? 'waiting' : 'authored');
  const started = useRef(Boolean(cached));
  const [failed, setFailed] = useState(false);

  const ctl = useRef<AbortController | null>(null);
  // Paid streams never pile up: stop this one when the beat goes away.
  useEffect(
    () => () => {
      ctl.current?.abort();
    },
    [],
  );

  useEffect(() => {
    // The learner moved on mid-stream: stop paying for it and show the authored beat instead.
    if (!active && ctl.current && !ctl.current.signal.aborted && !delivered.has(key)) {
      ctl.current.abort();
      setText('');
      setVoice('authored');
      return;
    }
    if (started.current || ai === 'loading') return;
    if (ai !== 'on' || !active) {
      setVoice('authored');
      return;
    }
    started.current = true;
    const c = new AbortController();
    ctl.current = c;
    let acc = '';
    setVoice('waiting');
    tutorStream(
      { lessonId: lesson.id, beatIndex: index, mode: 'deliver', messages: [] },
      (t) => {
        acc += t;
        setText(acc);
        setVoice('streaming');
      },
      c.signal,
    ).then(
      () => {
        if (c.signal.aborted) return;
        if (!acc.trim()) {
          setVoice('authored');
          return;
        }
        delivered.set(key, acc);
        setVoice('tutor');
      },
      () => {
        if (c.signal.aborted) return;
        setText('');
        setFailed(true);
        setVoice('authored');
      },
    );
  }, [ai, active]);

  const hid = `beat-${lesson.id}-${index}`;
  const fromTutor = voice === 'streaming' || voice === 'tutor';

  return (
    <article
      class={`beat${active ? ' beat--active' : ''}${done ? ' beat--done' : ''}`}
      data-beat={index}
      aria-current={active ? 'step' : undefined}
      aria-labelledby={hid}
    >
      <p class="beat__step">
        <span>
          Step {index + 1} of {lesson.beats.length}
        </span>
        {done && (
          <span class="beat__done">
            <span aria-hidden="true">✓</span> Done
          </span>
        )}
      </p>
      <h2 class="beat__goal" id={hid} tabIndex={-1} ref={headingRef as never}>
        {beat.goal}
      </h2>

      {voice === 'waiting' && (
        <div class="beat__tutor" role="status">
          <SketchIcon name="tutor" class="beat__avatar" />
          <span class="visually-hidden">The tutor is preparing this step…</span>
          <span class="beat__lines" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
        </div>
      )}

      {fromTutor && (
        <>
          <div class="beat__tutor">
            <SketchIcon name="tutor" class="beat__avatar" />
            <div class="beat__voice" aria-live="polite" aria-busy={voice === 'streaming'}>
              <Markdown text={tidy(text)} />
              {voice === 'streaming' && <span class="beat__caret" aria-hidden="true" />}
            </div>
          </div>
          {voice === 'tutor' && (
            <details class="beat__source">
              <summary>Read the lesson text</summary>
              <Markdown text={beat.content} />
              {beat.question && <p class="beat__question-plain">{beat.question}</p>}
            </details>
          )}
        </>
      )}

      {voice === 'authored' && (
        <div class="beat__authored">
          {failed && <p class="beat__note">The tutor dropped out for a moment, so here's the lesson text.</p>}
          <Markdown text={beat.content} />
          {beat.question && (
            <p class="beat__question">
              <span class="beat__question-label">Think about it</span>
              {beat.question}
            </p>
          )}
        </div>
      )}

      {active && (
        <div class="beat__actions">
          <button type="button" class="button beat__next" onClick={onNext}>
            {nextLabel}
            <span aria-hidden="true">→</span>
          </button>
          {beat.question && fromTutor && <span class="beat__hint">Want to answer? Tell the tutor.</span>}
        </div>
      )}
    </article>
  );
}
