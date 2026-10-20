import { useEffect, useRef } from 'preact/hooks';
import { content } from '../content';
import type { Branch, Outcome } from '../shared/types';
import { Markdown } from './Markdown';
import { tidy } from './PlacementChat';
import { SketchIcon } from './SketchIcon';

export const OUTCOME_LABEL: Record<Outcome, string> = {
  advance: 'Advance',
  review: 'Review',
  skip: 'Skip ahead',
};

const titleOf = (id: string) => (Object.prototype.hasOwnProperty.call(content.lessons, id) ? content.lessons[id].title : id);

/**
 * A little fork in the road. All three authored routes are drawn faintly; the chosen
 * one draws in with its outcome colour: review loops back, advance goes on to the
 * next stop, skip leaps over it.
 */
function BranchGlyph({ outcome }: { outcome: Outcome }) {
  const routes: Record<Outcome, string> = {
    review: 'M64 44 C 98 46, 98 84, 62 84 C 36 84, 22 72, 22 58',
    advance: 'M64 44 L 146 44',
    skip: 'M64 44 C 96 4, 168 4, 204 40',
  };
  const ends: Record<Outcome, [number, number]> = { review: [22, 58], advance: [146, 44], skip: [204, 40] };
  const [ex, ey] = ends[outcome];
  return (
    <svg class="branch-glyph" viewBox="0 0 220 94" aria-hidden="true" focusable="false">
      <path class="branch-glyph__trunk" d="M8 44 L 64 44" />
      {(Object.keys(routes) as Outcome[])
        .filter((o) => o !== outcome)
        .map((o) => (
          <path key={o} class="branch-glyph__road" d={routes[o]} />
        ))}
      <circle class="branch-glyph__stop" cx="146" cy="44" r="5" />
      <circle class="branch-glyph__stop" cx="204" cy="40" r="5" />
      <path class="branch-glyph__chosen" d={routes[outcome]} pathLength={1} />
      <circle class="branch-glyph__fork" cx="64" cy="44" r="5.5" />
      <circle class="branch-glyph__end" cx={ex} cy={ey} r="8" />
    </svg>
  );
}

/** The visible "your path just branched" moment after a checkpoint. */
export function BranchMoment({
  outcome,
  branch,
  feedback,
  feedbackPending,
  lessonId,
  onRestart,
}: {
  outcome: Outcome;
  branch: Branch;
  feedback?: string | null;
  feedbackPending?: boolean;
  lessonId: string;
  onRestart: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.focus({ preventScroll: true });
    ref.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
  }, []);
  const same = branch.to === lessonId;
  const target = titleOf(branch.to);

  return (
    <div
      class={`moment moment--${outcome}`}
      data-testid="branch-moment"
      data-outcome={outcome}
      tabIndex={-1}
      ref={ref}
      aria-labelledby="moment-badge moment-message"
    >
      <BranchGlyph outcome={outcome} />
      <p class="moment__badge" id="moment-badge">
        {OUTCOME_LABEL[outcome]}
      </p>
      <p class="moment__message" id="moment-message">
        {branch.message}
      </p>
      {(feedback || feedbackPending) && (
        <div class="moment__feedback">
          <SketchIcon name="tutor" class="moment__avatar" />
          {feedback ? (
            <div>
              <span class="visually-hidden">Tutor's note: </span>
              <Markdown text={tidy(feedback)} />
            </div>
          ) : (
            <span class="moment__thinking">The tutor is adding a note…</span>
          )}
        </div>
      )}
      <div class="moment__actions">
        {same ? (
          <button type="button" class="button" onClick={onRestart}>
            Go through this lesson again
          </button>
        ) : (
          <a class="button" href={`/learn/${branch.to}`}>
            {outcome === 'review' ? `Go back to “${target}”` : `Continue to “${target}”`}
            <span aria-hidden="true">→</span>
          </a>
        )}
      </div>
    </div>
  );
}
