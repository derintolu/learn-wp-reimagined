// Record handles on /api/mcp under the standard: the practice handle `cxp_<32>` the reference server issues,
// and the `lr_<32>` handle today's server issued, which keeps resolving. Both carry the same 192 random bits;
// the reference server only accepts `cxp_`, so a legacy handle is passed to it in that form, and the store
// finds the record the legacy handle was issued for (practiceStore.ts). Handles are bearer secrets: never logged.
import { isHandle as isLegacyHandle } from '../../../vendor/learning-mcp/core/index.ts';
import { isPracticeHandle } from '../../../vendor/course-xapi-mcp/core/practice-record.ts';

export { isLegacyHandle, isPracticeHandle };

const LEGACY = 'lr_';
const PRACTICE = 'cxp_';

/** Either handle format. */
export const isAnyHandle = (h: unknown): h is string => isLegacyHandle(h) || isPracticeHandle(h);

/** The practice form of a handle (`lr_X` -> `cxp_X`); a practice handle is returned as it is. */
export function practiceForm(h: string): string {
  return isLegacyHandle(h) ? PRACTICE + h.slice(LEGACY.length) : h;
}

/** The legacy form of a practice handle (`cxp_X` -> `lr_X`): where a record issued before the swap is stored. */
export function legacyForm(h: string): string {
  return isPracticeHandle(h) ? LEGACY + h.slice(PRACTICE.length) : h;
}

const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * A JSON-RPC body with every legacy `handle` argument of a tools/call in its practice form, or null when it has
 * none (the body is then passed on as it came). Only the handle argument changes; nothing in a result names it.
 */
export function withPracticeHandles(text: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  let changed = false;
  for (const m of Array.isArray(parsed) ? parsed : [parsed]) {
    if (!isObj(m) || m.method !== 'tools/call' || !isObj(m.params) || !isObj(m.params.arguments)) continue;
    const args = m.params.arguments;
    if (isLegacyHandle(args.handle)) {
      args.handle = practiceForm(args.handle);
      changed = true;
    }
  }
  return changed ? JSON.stringify(parsed) : null;
}
