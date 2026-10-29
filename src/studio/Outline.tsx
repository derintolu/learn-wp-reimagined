import { content } from '../content';
import { useOfficialRecord } from '../record/official';
import { useRecord } from '../record/useRecord';
import { branchHistory, branchSkippedLessons } from '../shared/record';
import type { Lesson } from '../shared/types';

type State = 'done' | 'current' | 'upcoming';

const STATE_TEXT: Record<State, string> = { done: ' (done)', current: ' (you are here)', upcoming: '' };

const has = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

/** One row under the current lesson: a beat, the bug hunt or the checkpoint. */
function Section({ state, label, tag }: { state: State; label: string; tag?: string }) {
  return (
    <li class={`outline__section is-${state}`} aria-current={state === 'current' ? 'step' : undefined}>
      <span class="outline__section-label">
        {label}
        <span class="visually-hidden">{STATE_TEXT[state]}</span>
      </span>
      {tag && <span class="outline__tag">{tag}</span>}
    </li>
  );
}

/**
 * The left pane: the path's lessons (done, current or skipped), the current lesson's sections
 * marked from the step, and the branches the learner has taken.
 */
export function Outline({ lesson, step, bugSolved }: { lesson: Lesson; step: number; bugSolved: boolean }) {
  const { record } = useRecord();
  const { official } = useOfficialRecord();
  const testedOut = new Set(official?.testedOut ?? []);
  const path = content.paths[lesson.pathId];
  const lessons = path.lessons.filter((id) => has(content.lessons, id)).map((id) => content.lessons[id]);
  const minutes = lessons.reduce((s, l) => s + l.minutes, 0);
  const done = new Set(record.completedLessons);
  const placementSkip = record.placement?.pathId === lesson.pathId ? record.placement.skip : [];
  const skipped = new Set([...placementSkip, ...branchSkippedLessons(record, content, lesson.pathId)]);

  const n = lesson.beats.length;
  const finished = done.has(lesson.id);
  const beatState = (i: number): State => (finished || i < step ? 'done' : i === step ? 'current' : 'upcoming');
  const bugState: State = finished || (step >= n && bugSolved) ? 'done' : step >= n ? 'current' : 'upcoming';
  const cpState: State = finished ? 'done' : step >= n && (!lesson.bug || bugSolved) ? 'current' : 'upcoming';

  const history = branchHistory(record).filter((b) => has(content.lessons, b.from) && has(content.lessons, b.to));
  const numberOf = (id: string) => content.paths[content.lessons[id].pathId].lessons.indexOf(id) + 1;

  return (
    <nav class="outline" aria-label="Course outline">
      <h2 class="outline__kicker">Course</h2>
      <p class="outline__title">
        <a href={`/path/${path.id}`}>{path.title}</a>
      </p>
      <p class="outline__meta">
        {lessons.length} {lessons.length === 1 ? 'lesson' : 'lessons'} · about {minutes} min · adaptive
      </p>
      <ol class="outline__lessons">
        {lessons.map((l, i) => {
          const current = l.id === lesson.id;
          const state = current ? 'current' : done.has(l.id) ? 'done' : skipped.has(l.id) ? 'skipped' : 'open';
          return (
            <li key={l.id} class={`outline__lesson is-${state}`}>
              <a class="outline__row" href={`/learn/${l.id}`} aria-current={current ? 'page' : undefined}>
                <span class="outline__num" aria-hidden="true">
                  {i + 1}
                </span>
                <span class="outline__name">
                  {l.title}
                  {state === 'done' && <span class="visually-hidden"> (done)</span>}
                </span>
                {state === 'skipped' && <span class="outline__skipped">Skipped</span>}
                {testedOut.has(l.id) && state !== 'done' && <span class="outline__skipped">Tested out</span>}
              </a>
              {current && (
                <ul class="outline__sections" aria-label="Sections in this lesson">
                  {lesson.beats.map((b, k) => (
                    <Section key={b.id} state={beatState(k)} label={b.goal} />
                  ))}
                  {lesson.bug && <Section state={bugState} label="Catch the bug" tag="Code" />}
                  {lesson.checkpoint && <Section state={cpState} label="Checkpoint" tag="Branch" />}
                </ul>
              )}
            </li>
          );
        })}
      </ol>
      <div class="outline__history">
        <h2 class="outline__kicker" id="outline-history">
          Your path
        </h2>
        {history.length ? (
          <ol aria-labelledby="outline-history">
            {history.map((b, i) => (
              <li key={i}>
                <b>Lesson {numberOf(b.from)}</b> → {b.outcome}: {content.lessons[b.to].title}
              </li>
            ))}
          </ol>
        ) : (
          <p class="outline__empty">Branches you take appear here.</p>
        )}
      </div>
    </nav>
  );
}
