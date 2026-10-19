import type { ContentBundle } from './shared/types';
import generated from './generated/content.json';

/** The content bundle built by `npm run content`. */
export const content = generated as unknown as ContentBundle;
