export type Viewport = '1440x900' | '390x844';
export type SpeedMetrics = { lessonOpenMs: number; beatAdvanceMs: number; checkpointResultMs: number };
export type SpeedRun = Record<Viewport, SpeedMetrics>;
export type SpeedResult = { metric: string; viewport: string; ok: boolean; base: number; now: number };

const VIEWPORTS: Viewport[] = ['1440x900', '390x844'];
const METRICS: (keyof SpeedMetrics)[] = ['lessonOpenMs', 'beatAdvanceMs', 'checkpointResultMs'];

/** Budget: lesson open and beat advance within base + 10%, checkpoint result within base + 300 ms. */
export function compareSpeed(base: SpeedRun, run: SpeedRun): SpeedResult[] {
  const out: SpeedResult[] = [];
  for (const viewport of VIEWPORTS) {
    for (const metric of METRICS) {
      const b = base[viewport][metric];
      const now = run[viewport][metric];
      const limit = metric === 'checkpointResultMs' ? b + 300 : b * 1.1;
      out.push({ metric, viewport, ok: now <= limit + 1e-9, base: b, now });
    }
  }
  return out;
}
