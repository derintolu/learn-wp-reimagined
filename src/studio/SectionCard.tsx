import type { Lesson } from '../shared/types';
import { Markdown } from '../components/Markdown';

/** One beat as a course page inside the conversation: number, goal, the authored text, its sources. */
export function SectionCard({
  lesson,
  index,
  number,
  active,
  headingRef,
}: {
  lesson: Lesson;
  index: number;
  /** "{lesson}.{section}", e.g. "1.2". */
  number: string;
  active: boolean;
  headingRef?: { current: HTMLHeadingElement | null };
}) {
  const beat = lesson.beats[index];
  const hid = `section-${lesson.id}-${index}`;
  const last = lesson.sources.length - 1;
  return (
    <article class="section-card" data-beat={index} aria-current={active ? 'step' : undefined} aria-labelledby={hid}>
      <header class="section-card__head">
        <span class="section-card__n">{number}</span>
        <h2 class="section-card__goal" id={hid} tabIndex={-1} ref={headingRef as never}>
          {beat.goal}
        </h2>
      </header>
      <Markdown class="section-card__body" text={beat.content} />
      <p class="section-card__sources">
        Based on{' '}
        {lesson.sources.map((s, i) => (
          <span key={s.url}>
            {i > 0 && (i === last ? ' and ' : ', ')}
            <a href={s.url} target="_blank" rel="noopener noreferrer">
              {s.title}
            </a>
          </span>
        ))}
      </p>
    </article>
  );
}
