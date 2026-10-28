import { FEATURES } from '../config';
import { useAiStatusValue, type AiStatus } from '../ai/useAiStatus';
import { SketchIcon } from './SketchIcon';

export type CapKind = 'day-cap' | 'month-cap' | 'rate-limited' | 'off';

const KEEP_WORKING = 'Lessons, code checks and your progress all keep working';
const RATE_LIMITED = 'You are going a little fast. Please wait a few minutes and try again.';

const COPY: Record<CapKind, { title: string; body: string }> = {
  'day-cap': {
    title: "The tutor's taking a breather.",
    body: `We've used today's AI budget. ${KEEP_WORKING}, and the tutor's back after midnight UTC.`,
  },
  'month-cap': {
    title: "The tutor's taking a breather.",
    body: `We've used this month's AI budget. ${KEEP_WORKING}, and the tutor's back on the 1st of next month (UTC).`,
  },
  'rate-limited': {
    title: 'The tutor needs a moment.',
    body: RATE_LIMITED,
  },
  off: {
    title: 'The live tutor is switched off right now.',
    body: `${KEEP_WORKING} without it.`,
  },
};

/** Which notice a capped or off status needs. */
export function capKind(s: AiStatus): CapKind {
  if (s.ai === 'off') return 'off';
  if (s.reason === 'month-cap') return 'month-cap';
  if (s.reason === 'rate-limited') return 'rate-limited';
  return 'day-cap';
}

/** Says why the tutor isn't available. Reads the page's shared AI status unless one is passed. */
export function CapNotice({ status }: { status?: AiStatus }) {
  const shared = useAiStatusValue();
  const s = status ?? shared;
  const kind = capKind(s);
  const copy = COPY[kind];
  const body = kind === 'rate-limited' ? `${s.message?.trim() || RATE_LIMITED} ${KEEP_WORKING} meanwhile.` : copy.body;
  return (
    <div class="cap-notice" role="status" data-kind={kind}>
      <SketchIcon name="cup" class="cap-notice__icon" />
      <p class="cap-notice__title">{copy.title}</p>
      <p class="cap-notice__body">{body}</p>
      {FEATURES.agent && (
        <div class="cap-notice__actions">
          <a class="button" href="/connect">Continue in your own AI</a>
        </div>
      )}
    </div>
  );
}
