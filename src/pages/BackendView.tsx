import { useEffect, useRef, useState } from 'preact/hooks';
import { useRoute } from 'preact-iso';
import { content } from '../content';
import { Sticker } from '../components/Sticker';
import { fetchCourse, fetchLesson, type SenseiCourse, type SenseiLesson } from '../backend/sensei';
import { plainText, sanitizeHtml } from '../backend/sanitize';
import { NOT_FOUND_TITLE, NotFound } from './routes';
import { usePageTitle } from '../usePageTitle';

const has = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

type Result =
  | { kind: 'down' }
  | { kind: 'course'; course: SenseiCourse | null }
  | { kind: 'lesson'; lesson: SenseiLesson | null };
/** A result is only shown for the address it was fetched for, so navigating never flashes the previous page. */
type State = { at: string; result: Result } | null;

function Banner({ what, studioLabel, studioHref }: { what: 'course' | 'lesson'; studioLabel: string; studioHref: string }) {
  return (
    <div class="backend-banner" role="note">
      <Sticker>unofficial concept</Sticker>
      <p class="backend-banner__text">This is the backend view: Sensei's own record of this {what}.</p>
      <a class="backend-banner__link" href={studioHref}>{studioLabel}</a>
    </div>
  );
}

/** /backend/:pathId and /backend/:pathId/:lessonId: what Sensei holds for a course or lesson, read from its public route. */
export function BackendView() {
  const { params } = useRoute();
  const { pathId, lessonId } = params;
  const path = has(content.paths, pathId) ? content.paths[pathId as keyof typeof content.paths] : null;
  const valid = !!path && (lessonId === undefined || path.lessons.includes(lessonId));
  const at = `${pathId}/${lessonId ?? ''}`;
  const [state, setState] = useState<State>(null);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (!valid) return;
    let live = true;
    const run: Promise<Result> = lessonId
      ? fetchLesson(lessonId).then((lesson) => ({ kind: 'lesson', lesson }))
      : fetchCourse(pathId).then((course) => ({ kind: 'course', course }));
    run.then(
      (result) => live && setState({ at, result }),
      () => live && setState({ at, result: { kind: 'down' } }),
    );
    return () => {
      live = false;
    };
  }, [valid, at]);

  const result = state && state.at === at ? state.result : null;
  // After the load (or the error) lands, move focus to the heading so a keyboard or screen reader user hears the new page.
  useEffect(() => {
    if (result) heading.current?.focus({ preventScroll: false });
  }, [result]);

  const course = result?.kind === 'course' ? result.course : null;
  const lesson = result?.kind === 'lesson' ? result.lesson : null;
  const title = course ? plainText(course.title) : lesson ? plainText(lesson.title) : null;
  usePageTitle(!valid ? NOT_FOUND_TITLE : title ? `Backend view: ${title}` : 'Backend view');
  if (!valid) return <NotFound />;

  const what = lessonId ? 'lesson' : 'course';
  const missing = result?.kind === 'down' || (result?.kind === 'course' && !course) || (result?.kind === 'lesson' && !lesson);

  return (
    <section class="band band--light backend">
      <div class="wrap">
        <Banner
          what={what}
          studioLabel={lessonId ? 'Take the lesson in the studio' : 'Take the course in the studio'}
          studioHref={lessonId ? `/learn/${encodeURIComponent(lessonId)}` : `/path/${encodeURIComponent(pathId)}`}
        />
        <h1 class="backend-title" tabIndex={-1} ref={heading}>{title ?? 'Backend view'}</h1>
        <div aria-live="polite">
          {!result && <p class="backend-status">Asking Sensei…</p>}
          {missing && <p class="backend-status backend-status--down">Sensei isn't answering right now.</p>}
        </div>
        {course && (
          <>
            <div class="prose backend-body" dangerouslySetInnerHTML={{ __html: sanitizeHtml(course.html) }} />
            <h2 class="backend-subtitle">Lessons</h2>
            {course.lessons.length === 0 ? (
              <p class="backend-status">Sensei has no lessons for this course yet.</p>
            ) : (
              <ol class="backend-lessons">
                {course.lessons.map((l) => (
                  <li key={l.key}>
                    <a href={`/backend/${encodeURIComponent(pathId)}/${encodeURIComponent(l.key)}`}>{plainText(l.title)}</a>
                  </li>
                ))}
              </ol>
            )}
          </>
        )}
        {lesson && (
          <>
            <div class="prose backend-body" dangerouslySetInnerHTML={{ __html: sanitizeHtml(lesson.html) }} />
            <p class="backend-back"><a href={`/backend/${encodeURIComponent(pathId)}`}>Back to the course record</a></p>
          </>
        )}
      </div>
    </section>
  );
}
