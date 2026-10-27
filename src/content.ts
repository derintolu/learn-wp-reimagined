import type { ContentBundle } from './shared/types';
import generated from './generated/content.json';

/** Where the course content comes from. */
export interface CourseSource {
  initial(): ContentBundle;
  latest(): Promise<{ bundle: ContentBundle; etag: string } | null>;
}

const bundled = generated as unknown as ContentBundle;

/** The content bundle built by `npm run content`; never has anything newer. */
export const bundledSource: CourseSource = {
  initial: () => bundled,
  latest: async () => null,
};

let source: CourseSource = bundledSource;
let adoptedEtag: string | null = null;

/** Live binding: importers see the swapped bundle after `adoptLatest()`. */
export let content: ContentBundle = source.initial();

/** Swap in a newer bundle if the source has one. Call only at lesson open. */
export async function adoptLatest(): Promise<boolean> {
  const next = await source.latest();
  if (!next || next.etag === adoptedEtag) return false;
  content = next.bundle;
  adoptedEtag = next.etag;
  return true;
}

export function setCourseSourceForTests(s: CourseSource | null): void {
  source = s ?? bundledSource;
  adoptedEtag = null;
  content = source.initial();
}
