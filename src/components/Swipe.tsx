import type { ComponentChildren } from 'preact';

/** A hand-drawn highlighter stroke behind one or two key words. The words stay plain text. */
export function Swipe({ children }: { children: ComponentChildren }) {
  return (
    <span class="swipe">
      <svg class="swipe__mark" viewBox="0 0 240 48" preserveAspectRatio="none" aria-hidden="true" focusable="false">
        <path
          fill="currentColor"
          d="M5 17.5c9-3.6 24-5.4 46-6.6 31-1.7 64-1.3 96-1.9 30-.6 59-.9 86 1.4 3.4.3 5.4 2.6 5.1 5.6l-1.2 17.5c-.4 4-2.6 6.6-7.2 6.8-21 .9-46 .2-72 1.2-27 1-58 2.8-89 2.6-21-.1-41-1-59-3.2C6.3 40.6 3 38 2.7 34.2L2 22.8c-.2-2.5 1-4.4 3-5.3Z"
        />
        <path
          fill="currentColor"
          opacity="0.55"
          d="M14 13.6c38-3.4 92-4.6 150-4.4 22 .1 44 .6 62 2.2l-.6 3.4c-30-1.5-70-1.6-108-1-34 .5-70 1.6-102 3.5Z"
        />
      </svg>
      <span class="swipe__text">{children}</span>
    </span>
  );
}
