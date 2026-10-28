import { useEffect, useState } from 'preact/hooks';
import { content } from '../content';
import { BACKEND_VIEW_PATH } from '../shared/course-meta';

interface Seen {
  enrolled: string[];
  completedLessons: string[];
  testedOutLessons: string[];
}
type State = { kind: 'loading' } | { kind: 'down' } | { kind: 'ok'; seen: Seen };

const has = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);
const lessonTitle = (id: string) => (has(content.lessons, id) ? content.lessons[id].title : id);
const pathTitle = (id: string) => (has(content.paths, id) ? content.paths[id as keyof typeof content.paths].title : id);
const list = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

/** "What Sensei sees": the learner's own Sensei account, read through GET /api/sensei. */
export function SenseiPanel() {
  const [state, setState] = useState<State>({ kind: 'loading' });
  useEffect(() => {
    let live = true;
    fetch('/api/sensei', { credentials: 'same-origin' })
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        const j = (await res.json()) as Record<string, unknown>;
        return { enrolled: list(j.enrolled), completedLessons: list(j.completedLessons), testedOutLessons: list(j.testedOutLessons) };
      })
      .then(
        (seen) => live && setState({ kind: 'ok', seen }),
        () => live && setState({ kind: 'down' }),
      );
    return () => {
      live = false;
    };
  }, []);

  return (
    <section class="sensei-panel" aria-labelledby="sensei-panel-h">
      <h2 id="sensei-panel-h">What Sensei sees</h2>
      {state.kind === 'loading' && <p role="status">Asking Sensei...</p>}
      {state.kind === 'down' && <p role="status">Sensei isn't answering right now.</p>}
      {state.kind === 'ok' && (
        <>
          <h3>Enrolled in</h3>
          {state.seen.enrolled.length ? (
            <ul aria-label="Enrolments">
              {state.seen.enrolled.map((id) => (
                <li key={id}>{pathTitle(id)}</li>
              ))}
            </ul>
          ) : (
            <p>Not enrolled in anything yet.</p>
          )}
          <h3>Completed lessons</h3>
          {state.seen.completedLessons.length ? (
            <ul aria-label="Completed lessons">
              {state.seen.completedLessons.map((id) => (
                <li key={id}>{lessonTitle(id)}</li>
              ))}
            </ul>
          ) : (
            <p>No completed lessons yet.</p>
          )}
          <h3>Tested-out lessons</h3>
          {state.seen.testedOutLessons.length ? (
            <ul aria-label="Tested-out lessons">
              {state.seen.testedOutLessons.map((id) => (
                <li key={id}>{lessonTitle(id)}</li>
              ))}
            </ul>
          ) : (
            <p>No lessons tested out.</p>
          )}
        </>
      )}
      <p>
        <a href={BACKEND_VIEW_PATH}>See the backend view</a>
      </p>
      {/* Certificate download: filled by Task 50. */}
      <div data-slot="certificate" />
    </section>
  );
}
