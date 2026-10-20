/** Small hand-drawn-style icons. Our own strokes; decorative unless given a label. */
export type SketchName = 'learner' | 'block-theme' | 'vibe-coder' | 'tutor' | 'arrow' | 'cup' | 'branch';

const PATHS: Record<SketchName, { viewBox: string; d: string[] }> = {
  // A sprout pushing out of the ground
  learner: {
    viewBox: '0 0 48 48',
    d: [
      'M6 39.5c6-1.2 12.5-1.6 18.4-1.3 6 .3 11.6.9 17.6.5',
      'M24.2 38.4c-.4-5.3-.2-10.6.6-15.6',
      'M24.6 25.4c-4.9.6-9.6-1.2-12.1-5.4 4.8-1.3 10.2.3 12.1 5.4Z',
      'M25 22.4c1-5.3 5.4-9.3 11.4-9.7-.4 5.8-4.9 9.9-11.4 9.7Z',
    ],
  },
  // Three stacked blocks, slightly off-square
  'block-theme': {
    viewBox: '0 0 48 48',
    d: [
      'M7.5 26.6l15.6-.4.4 14.8-15.7.3Z',
      'M25.3 26.4l15.2.3-.3 14.6-15.1-.2Z',
      'M15.8 9.4l15.8-.6.3 14.8-15.8.4Z',
      'M20.2 15.3c2.3-.2 4.6-.1 7 0',
    ],
  },
  // Code brackets with a spark
  'vibe-coder': {
    viewBox: '0 0 48 48',
    d: [
      'M14.5 15.8c-3.2 2.7-6.2 5.3-8.8 8 2.7 2.6 5.6 5.3 8.8 8.1',
      'M33.4 15.6c3.2 2.8 6.1 5.5 8.9 8.3-2.8 2.6-5.8 5.3-9 7.9',
      'M24 13.2c.6 3.7 1.6 6.3 5.6 7.5-3.9 1.2-5 3.7-5.5 7.6-.6-3.9-1.8-6.4-5.7-7.5 3.9-1.2 5-3.8 5.6-7.6Z',
      'M22.4 35.8c.6.1 1.2.1 1.9 0',
    ],
  },
  // A friendly speech-bubble face for the tutor
  tutor: {
    viewBox: '0 0 48 48',
    d: [
      'M9.4 11.6c9.4-2 20.4-2.2 29.4-.2 2.6.6 3.9 2.5 3.9 5.4.1 4.3-.1 8.9-.6 12.7-.4 2.6-2 4-4.6 4.2-5 .3-10.1.2-15 .4-3.1 2.4-6.2 4.6-9.6 6.3.8-2.2 1.4-4.5 1.6-6.9-2.1-.4-3.8-1.6-4.3-4-.8-4.1-1-8.4-.6-12.6.2-2.5 1.6-4.7 3.8-5.3Z',
      'M18.4 19.8v2.1',
      'M29.4 19.6v2.1',
      'M18.2 26c3.5 2.6 7.9 2.6 11.4-.1',
    ],
  },
  // A loopy hand-drawn arrow pointing down and right
  arrow: {
    viewBox: '0 0 120 80',
    d: [
      'M6 12c14-6 32-6 40 4 7 9-2 20-10 16-7-4-2-15 8-17 20-4 39 9 52 25 4.6 5.6 8.6 11.8 12 18',
      'M95.6 49.2c3.4 3.7 6.8 8.1 8.8 13.6-5.4-.9-10.6-1-15.6.2',
    ],
  },
  // A road that forks three ways, for checkpoints
  branch: {
    viewBox: '0 0 48 48',
    d: [
      'M5.5 24.2c4.6-.3 9.2-.2 13.6.1',
      'M19.1 24.3c5.4-.6 10-4.9 13.4-11.2',
      'M19.2 24.4c6.6.1 13.2 0 19.4-.3',
      'M19.1 24.6c5.2.9 9.8 5.4 13 11.3',
      'M29.4 11.6c1.4.6 2.7 1 4.1 1.5.1-1.5.3-3 .2-4.4',
      'M36 21c1.3 1 2.4 2.1 3.4 3.3-1.2 1-2.4 2-3.6 2.9',
      'M28.9 36.6c1.5-.2 3-.4 4.4-.8-.4-1.4-.8-2.8-1.4-4.2',
    ],
  },
  // A cup of tea, for "taking a breather"
  cup: {
    viewBox: '0 0 48 48',
    d: [
      'M9 20.4c9.8-.6 19.6-.6 29.4.1-.3 7.6-2.1 14.2-6.6 17.6-4.6 3.2-11.6 3.3-16.3.1-4.4-3.3-6.2-10-6.5-17.8Z',
      'M38.2 23.4c4.4-.8 6.6 2.8 4.4 6-1.6 2.3-4.3 3-6.6 2.6',
      'M18.5 14.2c-1.8-2.2 1.6-3.8-.2-6.2',
      'M25.4 14.6c-1.8-2.3 1.7-4-.1-6.6',
      'M7.2 42.4c11.3.8 22.6.8 33.8-.1',
    ],
  },
};

export function SketchIcon({ name, class: className, label }: { name: SketchName; class?: string; label?: string }) {
  const icon = PATHS[name];
  return (
    <svg
      class={`sketch ${className ?? ''}`.trim()}
      viewBox={icon.viewBox}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : 'true'}
      focusable="false"
    >
      {icon.d.map((d) => (
        <path d={d} key={d} />
      ))}
    </svg>
  );
}
