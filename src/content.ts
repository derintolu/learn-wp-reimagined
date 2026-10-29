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

const FETCH_TIMEOUT_MS = 3000;
let wordpressEtag: string | null = null;

/** The course as WordPress holds it (`GET /api/course`). Any failure, a 304 or a bad body means nothing newer. */
export const wordpressSource: CourseSource = {
  initial: () => bundled,
  latest: async () => {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch('/api/course', {
        headers: wordpressEtag ? { 'If-None-Match': wordpressEtag } : {},
        signal: ctl.signal,
      });
      if (!res.ok) return null;
      const etag = res.headers.get('ETag');
      const bundle = (await res.json()) as ContentBundle;
      if (!etag || !bundle || typeof bundle !== 'object' || !bundle.lessons || !bundle.paths) return null;
      wordpressEtag = etag;
      return { bundle, etag };
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  },
};

let source: CourseSource = wordpressSource;
let adoptedEtag: string | null = null;
let pending: { bundle: ContentBundle; etag: string } | null = null;
let checking: Promise<void> | null = null;

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

/** Look for a newer bundle in the background and keep it aside until the next lesson opens. Never throws. */
export function prefetchLatest(): Promise<void> {
  checking ??= source
    .latest()
    .then((next) => {
      if (next && next.etag !== adoptedEtag) pending = next;
    })
    .catch(() => {})
    .finally(() => {
      checking = null;
    });
  return checking;
}

/** Swap in a bundle a background check already fetched. Synchronous: opening a lesson never waits for the network. */
export function adoptPending(): boolean {
  if (!pending) return false;
  content = pending.bundle;
  adoptedEtag = pending.etag;
  pending = null;
  return true;
}

export function setCourseSourceForTests(s: CourseSource | null): void {
  source = s ?? bundledSource;
  adoptedEtag = null;
  pending = null;
  checking = null;
  content = source.initial();
}
