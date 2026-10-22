import { useRoute } from 'preact-iso';
import { content } from '../content';
import { useRecord } from '../record/useRecord';
import { nextLessonId } from '../shared/engine';
import { branchSkippedLessons } from '../shared/record';
import type { PathId } from '../shared/types';
import { SketchIcon } from '../components/SketchIcon';
import { Swipe } from '../components/Swipe';
import { NOT_FOUND_TITLE, NotFound } from './routes';
import { usePageTitle } from '../usePageTitle';

const has = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

/** The first word of a path title gets the highlighter; the rest stays plain. */
function swiped(title: string) {
  const [first, ...rest] = title.split(' ');
  return (
    <>
      <Swipe>{first}</Swipe> {rest.join(' ')}
    </>
  );
}

export function PathOverview() {
  const { params } = useRoute();
  const { record } = useRecord();
  const known = has(content.paths, params.pathId);
  usePageTitle(known ? content.paths[params.pathId as PathId].title : NOT_FOUND_TITLE);
  if (!known) return <NotFound />;
  const pathId = params.pathId as PathId;
  const path = content.paths[pathId];
  const lessons = path.lessons.map((id) => content.lessons[id]).filter(Boolean);
  const minutes = lessons.reduce((s, l) => s + l.minutes, 0);

  if (path.status !== 'live' || lessons.length === 0) {
    return (
      <section class="band band--dark path-hero">
        <div class="wrap split">
          <h1 class="split__title path-hero__title">{swiped(path.title)}</h1>
          <div class="split__body">
            <p class="lede">{path.tagline}</p>
            <p class="path-hero__soon">This path is coming soon. Have a look at the other paths in the meantime.</p>
            <a class="button button--quiet" href="/#paths">
              See all paths
            </a>
          </div>
        </div>
      </section>
    );
  }

  const placement = record.placement?.pathId === pathId ? record.placement : undefined;
  // Skipped by placement, or jumped over by a checkpoint's skip branch.
  const skip = [...new Set([...(placement?.skip ?? []), ...branchSkippedLessons(record, content, pathId)])];
  // Only this path's lessons: progress on another path mustn't make this one say "continue".
  const done = new Set(record.completedLessons.filter((id) => path.lessons.includes(id)));
  const here = record.current?.pathId === pathId && path.lessons.includes(record.current.lessonId) ? record.current.lessonId : null;
  const firstOpen = path.lessons.find((id) => !done.has(id) && !skip.includes(id)) ?? null;
  const allDone = path.lessons.every((id) => done.has(id) || skip.includes(id)) && done.size > 0;
  const start = nextLessonId(content, pathId, null, skip);

  let cta: { href: string; label: string };
  if (here && !(allDone && done.has(here))) cta = { href: `/learn/${here}`, label: 'Continue where you left off' };
  else if (allDone) cta = { href: `/finale/${pathId}`, label: 'Go to the finale' };
  else if (firstOpen && done.size > 0) cta = { href: `/learn/${firstOpen}`, label: 'Continue where you left off' };
  else cta = { href: `/learn/${start ?? path.lessons[0]}`, label: `Start with “${content.lessons[start ?? path.lessons[0]].title}”` };

  return (
    <>
      <section class="band band--dark path-hero" aria-labelledby="path-title">
        <div class="wrap split">
          <div>
            <SketchIcon name={pathId} class="path-hero__icon" />
            <h1 class="split__title path-hero__title" id="path-title">
              {swiped(path.title)}
            </h1>
          </div>
          <div class="split__body">
            <p class="lede">{path.tagline}</p>
            <p class="path-hero__meta">
              {lessons.length} {lessons.length === 1 ? 'lesson' : 'lessons'}, about {minutes} minutes. Branching checkpoints
              along the way.
            </p>
            {placement && (
              <blockquote class="path-hero__reason">
                <p>{placement.reason}</p>
              </blockquote>
            )}
            <a class="button path-hero__cta" href={cta.href}>
              {cta.label}
              <span aria-hidden="true">→</span>
            </a>
          </div>
        </div>
      </section>
      <section class="band band--light" aria-labelledby="lessons-title">
        <div class="wrap split">
          <h2 class="split__title" id="lessons-title">
            The <Swipe>lessons</Swipe>
          </h2>
          <ol class="lesson-list" aria-label="Lessons in this path">
            {lessons.map((l, i) => {
              const status = done.has(l.id) ? 'done' : skip.includes(l.id) ? 'skipped' : l.id === here ? 'here' : null;
              return (
                <li class={`lesson-row${status ? ` lesson-row--${status}` : ''}`} key={l.id}>
                  <span class="lesson-row__n" aria-hidden="true">
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <div class="lesson-row__main">
                    <h3 class="lesson-row__title">
                      <a href={`/learn/${l.id}`} aria-current={l.id === here ? 'step' : undefined}>
                        {l.title}
                      </a>
                    </h3>
                    <p class="lesson-row__meta">
                      {l.minutes} min
                      {l.checkpoint && <> · {l.checkpoint.kind === 'code' ? 'Code checkpoint' : 'Checkpoint'}</>}
                      {l.bug && <> · Catch the bug</>}
                    </p>
                  </div>
                  {status && (
                    <span class={`chip chip--${status}`}>
                      {status === 'done' ? 'Done' : status === 'skipped' ? 'Skipped' : "You're here"}
                    </span>
                  )}
                </li>
              );
            })}
          </ol>
        </div>
      </section>
    </>
  );
}
