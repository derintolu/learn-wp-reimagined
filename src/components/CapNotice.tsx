import { FEATURES } from '../config';
import { SketchIcon } from './SketchIcon';

export type CapState = 'capped' | 'off';

const COPY: Record<CapState, { title: string; body: string }> = {
  capped: {
    title: "The tutor's taking a breather.",
    body: "We've used today's AI budget. Lessons, code checks and your progress all keep working, and the tutor's back after midnight UTC.",
  },
  off: {
    title: 'The live tutor is switched off right now.',
    body: 'Lessons, code checks and your progress all keep working without it.',
  },
};

export function CapNotice({ state }: { state: CapState }) {
  const copy = COPY[state];
  return (
    <div class="cap-notice" role="status">
      <SketchIcon name="cup" class="cap-notice__icon" />
      <p class="cap-notice__title">{copy.title}</p>
      <p class="cap-notice__body">{copy.body}</p>
      {FEATURES.agent && (
        <div class="cap-notice__actions">
          <a class="button" href="/connect">Continue in your own agent</a>
        </div>
      )}
    </div>
  );
}
