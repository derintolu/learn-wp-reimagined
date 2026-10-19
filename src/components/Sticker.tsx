import type { ComponentChildren } from 'preact';

export function Sticker({ children }: { children: ComponentChildren }) {
  return <span class="sticker">{children}</span>;
}
