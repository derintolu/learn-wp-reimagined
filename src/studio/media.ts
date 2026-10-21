import { useEffect, useState } from 'preact/hooks';

/** At or below this width the studio shows one pane at a time. */
export const NARROW = '(max-width: 960px)';

const query = (q: string) => typeof matchMedia === 'function' && matchMedia(q).matches;

/** Whether a media query matches, kept up to date. */
export function useMedia(q: string): boolean {
  const [matches, setMatches] = useState(() => query(q));
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const mq = matchMedia(q);
    const on = () => setMatches(mq.matches);
    on();
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, [q]);
  return matches;
}

/** 'smooth', unless the learner prefers reduced motion. */
export function scrollBehavior(): ScrollBehavior {
  return query('(prefers-reduced-motion: reduce)') ? 'auto' : 'smooth';
}
