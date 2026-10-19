import type { ContentBundle } from '../../src/shared/types';
import generated from '../../src/generated/content.json';

let override: ContentBundle | null = null;

export function getContent(): ContentBundle {
  return override ?? (generated as unknown as ContentBundle);
}

/** Test-only: swap the bundle (pass null to restore the generated one). */
export function setContentForTests(bundle: ContentBundle | null): void {
  override = bundle;
}
