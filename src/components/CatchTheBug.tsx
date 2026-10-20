import { useEffect, useRef, useState } from 'preact/hooks';
import { codeFeedback } from '../ai/client';
import type { AiState } from '../ai/useAiStatus';
import { getRecordManager } from '../record/useRecord';
import { runChecks } from '../shared/checks';
import type { Lesson } from '../shared/types';
import { CodeEditor } from './LazyCodeEditor';
import { Markdown } from './Markdown';
import { tidy } from './PlacementChat';
import { SketchIcon } from './SketchIcon';

export const BUG_LABEL = 'AI-written code. We planted one bug. Find it.';
/** After this many misses, show the failing checks as a hint. */
const MISSES_BEFORE_HINT = 2;

/** "Catch the AI": an AI-written snippet with one planted bug. Only the authored fix checks can pass it. */
export function CatchTheBug({
  lesson,
  ai,
  saved,
  onEdit,
  flush,
  onSolved,
}: {
  lesson: Lesson;
  ai: AiState;
  saved?: string;
  onEdit: (file: string, content: string) => void;
  flush: () => void;
  onSolved: () => void;
}) {
  const bug = lesson.bug!;
  const [code, setCode] = useState(saved ?? bug.code);
  const [misses, setMisses] = useState(0);
  const [failed, setFailed] = useState<string[] | null>(null);
  const [solved, setSolved] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [noteBusy, setNoteBusy] = useState(false);
  const seq = useRef(0);
  const ctl = useRef(new AbortController());
  useEffect(() => () => ctl.current.abort(), []);

  function check() {
    if (solved) return;
    flush();
    const run = runChecks(bug.fixChecks, { [bug.file]: code });
    const failedMessages = run.results.filter((r) => !r.passed).map((r) => r.check.message);
    getRecordManager()
      .dispatch({ type: 'codeChecked', lessonId: lesson.id, file: bug.file, passed: run.passed })
      .catch(() => {});
    const mine = ++seq.current;
    setNote(null);
    // Only a fixed bug gets an AI note. On a miss the model could name the bug (the server refuses too).
    if (ai === 'on' && run.passed) {
      setNoteBusy(true);
      codeFeedback({ lessonId: lesson.id, file: bug.file, code, passed: run.passed, failedMessages }, ctl.current.signal).then((res) => {
        if (mine !== seq.current || ctl.current.signal.aborted) return;
        setNoteBusy(false);
        setNote(res.ok && typeof res.data.feedback === 'string' && res.data.feedback.trim() ? res.data.feedback : null);
      });
    }
    if (run.passed) {
      setSolved(true);
      setFailed(null);
      onSolved();
      return;
    }
    setMisses((n) => n + 1);
    setFailed(failedMessages);
  }

  return (
    <section class={`bug${solved ? ' is-solved' : ''}`} aria-labelledby={`bug-title-${lesson.id}`}>
      <div class="bug__head">
        <span class="bug__stamp" aria-hidden="true">
          <svg viewBox="0 0 32 32" class="sketch">
            <path d="M16 9.5c3.6 0 6 2.8 6 6.8v3.4c0 3.8-2.6 6.6-6 6.6s-6-2.8-6-6.6v-3.4c0-4 2.4-6.8 6-6.8Z" />
            <path d="M16 12v14M10.2 17H6.5M25.5 17h-3.7M10.6 22.4l-3.4 2.2M21.4 22.4l3.4 2.2M11.2 12.2 8.6 9.6M20.8 12.2l2.6-2.6M13 9.8c0-2 1.3-3.3 3-3.3s3 1.3 3 3.3" />
          </svg>
        </span>
        <div>
          <h2 class="bug__title" id={`bug-title-${lesson.id}`}>
            Catch the bug
          </h2>
          <p class="bug__label">{BUG_LABEL}</p>
        </div>
      </div>
      <CodeEditor
        file={bug.file}
        value={code}
        label={`Code editor for ${bug.file}, with one planted bug`}
        onChange={(v) => {
          setCode(v);
          onEdit(bug.file, v);
        }}
      />
      {!solved && (
        <div class="checkpoint__row">
          <button type="button" class="button" onClick={check}>
            Check my fix
          </button>
          <span class="checkpoint__hint">Fix it by hand. The check looks for the real fix, not just a change.</span>
        </div>
      )}
      <div aria-live="polite" class="bug__live">
        {failed && !solved && (
          <div class="bug__miss">
            <p class="checkpoint__verdict">Not yet. The bug is still in there.</p>
            {misses >= MISSES_BEFORE_HINT && (
              <p class="bug__hint">
                <span class="bug__hint-label">Hint</span> {failed.join(' ')}
              </p>
            )}
          </div>
        )}
        {solved && (
          <div class="bug__win">
            <p class="bug__win-title">
              <span aria-hidden="true">✓</span> You caught it.
            </p>
            <p>{bug.explanation}</p>
          </div>
        )}
        {(note || noteBusy) && (
          <div class="checkpoint__note-ai">
            <SketchIcon name="tutor" class="moment__avatar" />
            {note ? <Markdown text={tidy(note)} /> : <span class="moment__thinking">The tutor is reading your fix…</span>}
          </div>
        )}
      </div>
    </section>
  );
}
