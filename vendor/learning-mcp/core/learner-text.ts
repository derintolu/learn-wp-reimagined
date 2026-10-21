// Vendored from github.com/derintolu/learning-mcp @ f2c83626d84bd478b330fbc6c064d980b52585e2, packages/core/src/learner-text.ts. Do not edit here; change learning-mcp and re-vendor.
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
