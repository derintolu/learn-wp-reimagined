import type { ComponentChildren } from 'preact';

export type Speaker = 'learner' | 'tutor';

const SPEAKER_LABEL: Record<Speaker, string> = { learner: 'You said:', tutor: 'Tutor said:' };

/** One chat message. Group a conversation inside `<div class="chat">`. */
export function Bubble({ from, children }: { from: Speaker; children: ComponentChildren }) {
  return (
    <div class={`bubble bubble--${from}`}>
      <span class="visually-hidden">{SPEAKER_LABEL[from]} </span>
      {children}
    </div>
  );
}
