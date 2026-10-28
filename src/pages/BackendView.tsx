import { useEffect, useState } from 'preact/hooks';
import { useRoute } from 'preact-iso';
import { content } from '../content';
import { FEATURES } from '../config';
import { Sticker } from '../components/Sticker';
import { fetchCourse, fetchLessons, type SenseiPost } from '../backend/sensei';
import { plainText, sanitizeHtml } from '../backend/sanitize';
import { NOT_FOUND_TITLE, NotFound } from './routes';
import { usePageTitle } from '../usePageTitle';

const has = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

type State =
  | { kind: 'loading' }
  | { kind: 'down' }
  | { kind: 'course'; course: SenseiPost | null; lessons: SenseiPost[] }
  | { kind: 'lesson'; lesson: SenseiPost | null };

function Banner({ what, studioLabel, studioHref }: { what: 'course' | 'lesson'; studioLabel: string; studioHref: string }) {
  return (
    <div class="backend-banner" role="note">
      <Sticker>unofficial concept</Sticker>
      <p class="backend-banner__text">This is the backend view: Sensei's own record of this {what}.</p>
      <a class="backend-banner__link" href={studioHref}>{studioLabel}</a>
    </div>
  );
}

/** /backend/:pathId and /backend/:pathId/:lessonId: what Sensei holds for a course or lesson, read from its public REST. */
export function BackendView() {
  const { params } = useRoute();
  const { pathId, lessonId } = params;
  const path = FEATURES.wordpressContent && has(content.paths, pathId) ? content.paths[pathId as keyof typeof content.paths] : null;
  const valid = !!path && (lessonId === undefined || path.lessons.includes(lessonId));
  const [state, setState] = useState<State>({ kind: 'loading' });

  useEffect(() => {
    if (!valid) return;
    let live = true;
    setState({ kind: 'loading' });
    const run = lessonId
      ? fetchLessons([lessonId]).then((l): State => ({ kind: 'lesson', lesson: l[0] ?? null }))
      : Promise.all([fetchCourse(pathId), fetchLessons(path!.lessons)]).then(([course, lessons]): State => ({ kind: 'course', course, lessons }));
    run.then((s) => live && setState(s), () => live && setState({ kind: 'down' }));
    return () => {
      live = false;
    };
  }, [valid, pathId, lessonId]);

  const title =
    state.kind === 'course' && state.course ? plainText(state.course.title)
    : state.kind === 'lesson' && state.lesson ? plainText(state.lesson.title)
    : null;
  usePageTitle(!valid ? NOT_FOUND_TITLE : title ? `Backend view: ${title}` : 'Backend view');
  if (!valid) return <NotFound />;

  const what = lessonId ? 'lesson' : 'course';
  const banner = (
    <Banner
      what={what}
      studioLabel={lessonId ? 'Take the lesson in the studio' : 'Take the course in the studio'}
      studioHref={lessonId ? `/learn/${encodeURIComponent(lessonId)}` : `/path/${encodeURIComponent(pathId)}`}
    />
  );
  const missing = state.kind === 'down' || (state.kind === 'course' && !state.course) || (state.kind === 'lesson' && !state.lesson);

  return (
    <section class="band band--light backend">
      <div class="wrap">
        {banner}
        <div aria-live="polite">
          {state.kind === 'loading' && <p class="backend-status">Asking Sensei…</p>}
          {missing && <p class="backend-status backend-status--down">Sensei isn't answering right now.</p>}
        </div>
        {state.kind === 'course' && state.course && (
          <>
            <h1 class="backend-title">{plainText(state.course.title)}</h1>
            <div class="prose backend-body" dangerouslySetInnerHTML={{ __html: sanitizeHtml(state.course.html) }} />
            <h2 class="backend-subtitle">Lessons</h2>
            <ol class="backend-lessons">
              {state.lessons.map((l) => (
                <li key={l.slug}>
                  <a href={`/backend/${encodeURIComponent(pathId)}/${encodeURIComponent(l.slug)}`}>{plainText(l.title)}</a>
                </li>
              ))}
            </ol>
          </>
        )}
        {state.kind === 'lesson' && state.lesson && (
          <>
            <h1 class="backend-title">{plainText(state.lesson.title)}</h1>
            <div class="prose backend-body" dangerouslySetInnerHTML={{ __html: sanitizeHtml(state.lesson.html) }} />
            <p class="backend-back"><a href={`/backend/${encodeURIComponent(pathId)}`}>Back to the course record</a></p>
          </>
        )}
      </div>
    </section>
  );
}
