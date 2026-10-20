import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** The bodies of every @media (prefers-reduced-motion: reduce) block, found by brace matching. */
function reducedMotionBlocks(css: string): string[] {
  const out: string[] = [];
  const re = /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css))) {
    let depth = 1;
    let i = re.lastIndex;
    for (; i < css.length && depth > 0; i++) {
      if (css[i] === '{') depth++;
      else if (css[i] === '}') depth--;
    }
    out.push(css.slice(re.lastIndex, i - 1));
  }
  return out;
}

const dir = 'src/styles';
const sheets = readdirSync(dir).filter((f) => f.endsWith('.css'));

describe('reduced motion', () => {
  it.each(sheets)('%s only turns motion off, never hides content', (file) => {
    const css = readFileSync(join(dir, file), 'utf8');
    for (const block of reducedMotionBlocks(css)) {
      expect(block).not.toMatch(/display\s*:\s*none/);
      expect(block).not.toMatch(/visibility\s*:\s*hidden/);
      expect(block).not.toMatch(/opacity\s*:\s*0\s*[;}]/);
    }
  });

  it('uses no overshoot easing', () => {
    for (const file of sheets) {
      const css = readFileSync(join(dir, file), 'utf8');
      for (const m of css.matchAll(/cubic-bezier\(([^)]+)\)/g)) {
        const [, y1, , y2] = m[1].split(',').map(Number);
        expect(y1, `${file}: ${m[0]}`).toBeLessThanOrEqual(1);
        expect(y2, `${file}: ${m[0]}`).toBeLessThanOrEqual(1);
      }
    }
  });
});
