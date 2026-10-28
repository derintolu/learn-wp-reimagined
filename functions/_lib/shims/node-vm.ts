// Web shim for `node:vm` in the Functions bundle (scripts/vendor-shims.ts). The vendored checks run each
// authored regex as `new RegExp(pattern, flags).test(text)` in a context with a time limit; a Workers-like
// runtime has no vm, so the test runs directly, without the limit, as today's server ran it. Patterns with
// nested quantifiers are still refused before this point (core/checks.ts hasNestedQuantifier).
const REGEX_TEST = 'new RegExp(pattern, flags).test(text)';

type RegexContext = { pattern: string; flags: string; text: string };

export function createContext<T extends object>(o: T): T {
  return o;
}

export function runInContext(code: string, ctx: RegexContext): boolean {
  if (code !== REGEX_TEST) throw new Error('the vm module is not available in Functions (Node only)');
  return new RegExp(ctx.pattern, ctx.flags).test(ctx.text);
}
