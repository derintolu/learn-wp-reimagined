import type { ContentBundle } from '../../src/shared/types';
import generated from '../../src/generated/content.json';

let override: ContentBundle | null = null;
let current: ContentBundle | null = null;

export function getContent(): ContentBundle {
  return override ?? current ?? (generated as unknown as ContentBundle);
}

/** Test-only: swap the bundle (pass null to restore the generated one). */
export function setContentForTests(bundle: ContentBundle | null): void {
  override = bundle;
}

/** The bundle the course cache last loaded (null falls back to the baked one). Tests' override still wins. */
export function setCurrentContent(b: ContentBundle | null): void {
  current = b;
}
