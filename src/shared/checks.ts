import type { Check } from './types';

function resolvePointer(doc: unknown, pointer: string): { found: boolean; value?: unknown } {
  if (pointer === '') return { found: true, value: doc };
  if (!pointer.startsWith('/')) return { found: false };
  let cur: unknown = doc;
  for (const raw of pointer.slice(1).split('/')) {
    const key = raw.replace(/~1/g, '/').replace(/~0/g, '~');
    if (Array.isArray(cur)) {
      if (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= cur.length) return { found: false };
      cur = cur[Number(key)];
    } else if (cur !== null && typeof cur === 'object' && Object.prototype.hasOwnProperty.call(cur, key)) {
      cur = (cur as Record<string, unknown>)[key];
    } else {
      return { found: false };
    }
  }
  return { found: true, value: cur };
}

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function runCheck(check: Check, files: Record<string, string>): boolean {
  if (!Object.prototype.hasOwnProperty.call(files, check.file)) return false;
  const text = files[check.file];
  try {
    switch (check.type) {
      case 'contains':
        return text.includes(check.value);
      case 'notContains':
        return !text.includes(check.value);
      case 'regex':
        return new RegExp(check.pattern, check.flags).test(text);
      case 'json': {
        const r = resolvePointer(JSON.parse(text), check.pointer);
        return r.found && deepEqual(r.value, check.equals);
      }
      default:
        return false;
    }
  } catch {
    return false;
  }
}

export function runChecks(
  checks: Check[],
  files: Record<string, string>,
): { passed: boolean; results: { check: Check; passed: boolean }[] } {
  const results = checks.map((check) => ({ check, passed: runCheck(check, files) }));
  return { passed: results.every((r) => r.passed), results };
}
