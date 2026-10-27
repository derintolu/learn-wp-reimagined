export type Viewport = '1440x900' | '390x844';
export type SpeedMetrics = { lessonOpenMs: number; beatAdvanceMs: number; checkpointResultMs: number };
export type SpeedRun = Record<Viewport, SpeedMetrics>;
/** Optional metadata stored beside the numbers; SpeedRun stays compatible. */
export type SpeedMeta = { baseUrl?: string; checkpointPath?: string; conditions?: string; provisional?: boolean };
export type SpeedFile = SpeedRun & SpeedMeta;
/** Absolute floor for lessonOpen and beatAdvance: single-digit-ms bases make a pure 10% rule meaningless. */
export const SPEED_FLOOR_MS = 50;
export type SpeedResult = { metric: string; viewport: string; ok: boolean; base: number; now: number };

const VIEWPORTS: Viewport[] = ['1440x900', '390x844'];
const METRICS: (keyof SpeedMetrics)[] = ['lessonOpenMs', 'beatAdvanceMs', 'checkpointResultMs'];

/** Budget: lesson open and beat advance within max(base + 10%, base + 50 ms), checkpoint result within base + 300 ms. */
export function compareSpeed(base: SpeedRun, run: SpeedRun): SpeedResult[] {
  const out: SpeedResult[] = [];
  for (const viewport of VIEWPORTS) {
    for (const metric of METRICS) {
      const b = base[viewport][metric];
      const now = run[viewport][metric];
      const limit = metric === 'checkpointResultMs' ? b + 300 : Math.max(b * 1.1, b + SPEED_FLOOR_MS);
      out.push({ metric, viewport, ok: now <= limit + 1e-9, base: b, now });
    }
  }
  return out;
}

/** Why two files can't be compared, or null. Different base URLs or checkpoint paths measure different things. */
export function incomparable(base: SpeedMeta, run: SpeedMeta): string | null {
  if (base.baseUrl !== run.baseUrl) return `baseUrl differs (${base.baseUrl} vs ${run.baseUrl})`;
  if (base.checkpointPath !== run.checkpointPath) return `checkpointPath differs (${base.checkpointPath} vs ${run.checkpointPath})`;
  return null;
}

/** CLI: tsx scripts/speed/compare.ts <baseline.json> <run.json> [--force]. Exit 1 on refusal or a missed budget. */
export function cli(argv: string[], read: (p: string) => SpeedFile, log: (m: string) => void = console.log): number {
  const force = argv.includes('--force');
  const [bp, rp] = argv.filter((a) => !a.startsWith('--'));
  if (!bp || !rp) {
    log('usage: compare.ts <baseline.json> <run.json> [--force]');
    return 2;
  }
  const base = read(bp);
  const run = read(rp);
  const why = incomparable(base, run);
  if (why && !force) {
    log(`Refusing to compare: ${why}. Re-measure under the same conditions, or pass --force.`);
    return 2;
  }
  if (why) log(`Warning (--force): ${why}`);
  const results = compareSpeed(base, run);
  for (const r of results) log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.viewport} ${r.metric}: ${r.base} -> ${r.now}`);
  return results.every((r) => r.ok) ? 0 : 1;
}

if (process.argv[1] && /speed[\\/]compare\.ts$/.test(process.argv[1])) {
  const { readFileSync } = await import('node:fs');
  process.exit(cli(process.argv.slice(2), (p) => JSON.parse(readFileSync(p, 'utf8'))));
}
