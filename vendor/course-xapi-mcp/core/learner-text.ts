// Vendored from github.com/derintolu/learning-mcp @ f545f5cd68a2c64dc96ac0b138fea6d4332de637, reference/packages/core/src/learner-text.ts. Do not edit here; change learning-mcp and re-vendor.
// SPDX-License-Identifier: Apache-2.0
// Learner text is data. Ported from learn-wp-reimagined/functions/_lib/prompts.ts (wrapLearner).

export const LIMITS = {
  /** learner replies and checkpoint responses */
  text: 4000,
  /** agent-written placement reasons and branch rationales */
  rationale: 300,
  /** bytes per submitted file (UTF-16 code units, as JavaScript counts) */
  file: 65536,
  /** files per call */
  files: 10,
} as const;

/** Wraps learner text so an agent can tell it apart from instructions. Typed wrapper tags are neutralised. */
export function wrapLearner(text: string): string {
  const safe = text.replace(/<\s*\/?\s*learner_input\b[^<>]*>?/gi, '[tag removed]');
  return `<learner_input>${safe}</learner_input>`;
}
