import { useEffect, useRef, useState } from 'preact/hooks';
import { codeFeedback, judge } from '../ai/client';
import type { AiState } from '../ai/useAiStatus';
import { content } from '../content';
import { getRecordManager } from '../record/useRecord';
import { runChecks } from '../shared/checks';
import { resolveBranch } from '../shared/engine';
import type { Branch, Check, Lesson, Outcome } from '../shared/types';
import { BranchMoment } from './BranchMoment';
import { CapNotice } from './CapNotice';
import { CodeEditor } from './LazyCodeEditor';
import { Markdown } from './Markdown';
import { tidy } from './PlacementChat';
import { SketchIcon } from './SketchIcon';

/** The judge accepts answers up to 1500 characters. */
const MAX_ANSWER = 1500;
/** R3: after this many failed code checks, offer the review branch and the authored options. */
export const CODE_ATTEMPTS_BEFORE_HELP = 2;
export const CODE_PASS_RESPONSE = 'code checks passed';

export interface Resolution {
  outcome: Outcome;
  branch: Branch;
  /** What goes in the record as the learner's response. */
  response: string;
}

function branchFor(lessonId: string, outcome: Outcome): Branch | null {
  try {
    return resolveBranch(content, lessonId, outcome);
  } catch {
    return null;
  }
}

/** The authored multiple-choice options, used whenever the AI can't judge. */
function FallbackOptions({
  lesson,
  onPick,
}: {
  lesson: Lesson;
  onPick: (r: Resolution) => void;
}) {
  const cp = lesson.checkpoint!;
  return (
    <div class="checkpoint__options" role="group" aria-label="Pick the closest answer">
      {cp.fallback.map((f) => {
        const branch = branchFor(lesson.id, f.outcome);
        if (!branch) return null;
        return (
          <button
            type="button"
            class="option"
            key={f.label}
            onClick={() => onPick({ outcome: f.outcome, branch, response: f.label })}
          >
            <span class="option__dot" aria-hidden="true" />
            {f.label}
          </button>
        );
      })}
    </div>
  );
}

function FreeText({ lesson, ai, onResolve }: { lesson: Lesson; ai: AiState; onResolve: (r: Resolution, feedback?: string) => void }) {
  const [answer, setAnswer] = useState('');
  const [busy, setBusy] = useState(false);
  const [fallback, setFallback] = useState(false);
  const busyRef = useRef(false);
  const aiReady = ai === 'on';
  const ctl = useRef(new AbortController());
  useEffect(() => () => ctl.current.abort(), []);

  async function submit(e: Event) {
    e.preventDefault();
    const text = answer.trim().slice(0, MAX_ANSWER);
    if (!text || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    const res = await judge(lesson.id, text, ctl.current.signal);
    if (ctl.current.signal.aborted) return;
    busyRef.current = false;
    setBusy(false);
    // Never trust the response's own "to" or message: look the outcome up in the authored branches.
    const branch = res.ok ? branchFor(lesson.id, res.data.outcome) : null;
    if (!res.ok || !branch) {
      setFallback(true);
      return;
    }
    onResolve({ outcome: res.data.outcome, branch, response: text }, typeof res.data.feedback === 'string' ? res.data.feedback : undefined);
  }

  if (ai === 'loading') {
    return (
      <div class="checkpoint__loading" role="status">
        <span class="visually-hidden">Getting the checkpoint ready…</span>
        <span class="placement__skeleton checkpoint__skeleton" aria-hidden="true" />
      </div>
    );
  }

  if (!aiReady || fallback) {
    return (
      <>
        {!aiReady && <CapNotice state={ai === 'capped' ? 'capped' : 'off'} />}
        <p class="checkpoint__note">
          {aiReady
            ? "The tutor couldn't read your answer just now. Pick the one closest to what you'd say."
            : "Pick the answer closest to what you'd say."}
        </p>
        <FallbackOptions lesson={lesson} onPick={(r) => onResolve(r)} />
      </>
    );
  }

  return (
    <form class="checkpoint__form" onSubmit={submit}>
      <label class="checkpoint__label" for={`answer-${lesson.id}`}>
        Your answer
      </label>
      <textarea
        id={`answer-${lesson.id}`}
        class="checkpoint__input"
        rows={4}
        maxLength={MAX_ANSWER}
        value={answer}
        placeholder="A sentence or two is plenty."
        disabled={busy}
        onInput={(e) => setAnswer((e.currentTarget as HTMLTextAreaElement).value.slice(0, MAX_ANSWER))}
      />
      <div class="checkpoint__row">
        <button type="submit" class="button" disabled={busy || !answer.trim()}>
          {busy ? 'Reading your answer…' : 'Check my answer'}
        </button>
        <span class="checkpoint__hint">The tutor picks one of three authored routes. It can't invent a new one.</span>
      </div>
    </form>
  );
}

type CheckResult = { check: Check; passed: boolean }[];

function CheckList({ results }: { results: CheckResult }) {
  return (
    <ul class="check-list">
      {results.map((r, i) => (
        <li key={i} class={r.passed ? 'check-list__item is-pass' : 'check-list__item is-fail'}>
          <span class="check-list__mark" aria-hidden="true">
            {r.passed ? '✓' : '×'}
          </span>
          <span class="visually-hidden">{r.passed ? 'Passed: ' : 'Not yet: '}</span>
          <span>{r.check.message}</span>
        </li>
      ))}
    </ul>
  );
}

function Code({
  lesson,
  ai,
  files,
  onEdit,
  flush,
  onResolve,
  onFeedback,
  locked,
}: {
  lesson: Lesson;
  ai: AiState;
  locked: boolean;
  files: Record<string, string>;
  onEdit: (file: string, content: string) => void;
  flush: () => void;
  onResolve: (r: Resolution) => void;
  onFeedback: (f: string | null, pending: boolean) => void;
}) {
  const cp = lesson.checkpoint!;
  const file = cp.file!;
  const [code, setCode] = useState(files[file] ?? '');
  const [results, setResults] = useState<CheckResult | null>(null);
  const [fails, setFails] = useState(0);
  const [note, setNote] = useState<string | null>(null);
  const [noteBusy, setNoteBusy] = useState(false);
  const [helpHidden, setHelpHidden] = useState(false);
  const seq = useRef(0);
  const ctl = useRef(new AbortController());
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => () => ctl.current.abort(), []);

  function keepTrying() {
    setHelpHidden(true);
    box.current?.querySelector<HTMLElement>('.cm-content, textarea')?.focus();
  }

  function check() {
    flush();
    const run = runChecks(cp.checks ?? [], { ...files, [file]: code });
    setResults(run.results);
    getRecordManager()
      .dispatch({ type: 'codeChecked', lessonId: lesson.id, file, passed: run.passed })
      .catch(() => {});
    const failedMessages = run.results.filter((r) => !r.passed).map((r) => r.check.message);
    setNote(null);
    const mine = ++seq.current;
    if (ai === 'on') {
      setNoteBusy(true);
      onFeedback(null, run.passed);
      codeFeedback({ lessonId: lesson.id, file, code, passed: run.passed, failedMessages }, ctl.current.signal).then((res) => {
        if (mine !== seq.current || ctl.current.signal.aborted) return;
        setNoteBusy(false);
        const text = res.ok && typeof res.data.feedback === 'string' && res.data.feedback.trim() ? res.data.feedback : null;
        setNote(text);
        onFeedback(text, false);
      });
    }
    if (run.passed) {
      // The checks decide; the AI only ever adds a note.
      const branch = branchFor(lesson.id, 'advance');
      if (branch) onResolve({ outcome: 'advance', branch, response: CODE_PASS_RESPONSE });
      return;
    }
    setFails((n) => n + 1);
    setHelpHidden(false);
  }

  const review = branchFor(lesson.id, 'review');
  const reviewTitle = review ? (content.lessons[review.to]?.title ?? review.to) : '';

  return (
    <div class="checkpoint__code" ref={box}>
      <CodeEditor
        file={file}
        value={code}
        describedBy={`cp-q-${lesson.id}`}
        onChange={(v) => {
          setCode(v);
          onEdit(file, v);
        }}
      />
      {!locked && (
        <div class="checkpoint__row">
          <button type="button" class="button" onClick={check}>
            Check my code
          </button>
          <span class="checkpoint__hint">Checks run right here in your browser. They decide pass or fail.</span>
        </div>
      )}
      {results && (
        <div class="checkpoint__results">
          <p class="checkpoint__verdict">
            {results.every((r) => r.passed) ? 'All checks pass.' : `Not yet. ${results.filter((r) => !r.passed).length} to fix:`}
          </p>
          <CheckList results={results} />
          {!locked && (note || noteBusy) && (
            <div class="checkpoint__note-ai">
              <SketchIcon name="tutor" class="moment__avatar" />
              {note ? <Markdown text={tidy(note)} /> : <span class="moment__thinking">The tutor is reading your code…</span>}
            </div>
          )}
        </div>
      )}
      {!locked && !helpHidden && fails >= CODE_ATTEMPTS_BEFORE_HELP && (
        <div class="checkpoint__help">
          <p class="checkpoint__help-title">Stuck? That's part of it.</p>
          <p class="checkpoint__note">
            The checks only pass on working code, so there's no skipping this one. Have another go, or step back and review.
          </p>
          {/* R21: no option here may record a pass the checks didn't give. */}
          <div class="checkpoint__options" role="group" aria-label="What next?">
            <button type="button" class="option" onClick={keepTrying}>
              <span class="option__dot" aria-hidden="true" />
              Keep trying
            </button>
            {review && (
              <button
                type="button"
                class="option"
                onClick={() => onResolve({ outcome: 'review', branch: review, response: `Chose to review ${reviewTitle}` })}
              >
                <span class="option__dot" aria-hidden="true" />
                Review “{reviewTitle}”
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** A branching checkpoint: free text judged by the AI, or code judged by deterministic checks. */
export function Checkpoint({
  lesson,
  ai,
  files,
  onEdit,
  flush,
  onResolved,
  onRestart,
}: {
  lesson: Lesson;
  ai: AiState;
  files: Record<string, string>;
  onEdit: (file: string, content: string) => void;
  flush: () => void;
  onResolved: (r: Resolution) => void;
  onRestart: () => void;
}) {
  const cp = lesson.checkpoint!;
  const [done, setDone] = useState<Resolution | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [feedbackPending, setFeedbackPending] = useState(false);
  const doneRef = useRef<Resolution | null>(null);

  function resolve(r: Resolution, fb?: string) {
    if (doneRef.current) return;
    doneRef.current = r;
    // A code note belongs with a pass; a picked option starts the moment clean.
    if (fb !== undefined) setFeedback(fb);
    else if (r.response !== CODE_PASS_RESPONSE) setFeedback(null);
    setDone(r);
    onResolved(r);
  }

  return (
    <section class="checkpoint" aria-labelledby={`cp-k-${lesson.id} cp-q-${lesson.id}`}>
      <p class="checkpoint__kicker" id={`cp-k-${lesson.id}`}>
        <SketchIcon name="branch" class="checkpoint__icon" />
        Checkpoint
      </p>
      <h2 class="checkpoint__question" id={`cp-q-${lesson.id}`}>
        {cp.question}
      </h2>
      {done && done.response !== CODE_PASS_RESPONSE && cp.kind === 'free-text' && (
        <blockquote class="checkpoint__echo">
          <span class="visually-hidden">You answered: </span>
          {done.response}
        </blockquote>
      )}
      {!done && cp.kind === 'free-text' && <FreeText lesson={lesson} ai={ai} onResolve={resolve} />}
      {cp.kind === 'code' && (
        <div>
          <Code
            lesson={lesson}
            ai={ai}
            locked={Boolean(done)}
            files={files}
            onEdit={onEdit}
            flush={flush}
            onResolve={(r) => resolve(r)}
            onFeedback={(f, p) => {
              if (doneRef.current && doneRef.current.response !== CODE_PASS_RESPONSE) return;
              setFeedback(f);
              setFeedbackPending(p);
            }}
          />
        </div>
      )}
      <div class="checkpoint__live" aria-live="polite">
        {done && (
          <BranchMoment
            outcome={done.outcome}
            branch={done.branch}
            feedback={feedback}
            feedbackPending={feedbackPending && done.response === CODE_PASS_RESPONSE}
            lessonId={lesson.id}
            onRestart={onRestart}
          />
        )}
      </div>
    </section>
  );
}
