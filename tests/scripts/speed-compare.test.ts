import { describe, expect, it } from 'vitest';
import { compareSpeed, type SpeedRun } from '../../scripts/speed/compare';

const vp = { lessonOpenMs: 1000, beatAdvanceMs: 200, checkpointResultMs: 2000 };
const base = (): SpeedRun => ({ '1440x900': { ...vp }, '390x844': { ...vp } });

describe('compareSpeed', () => {
  it('flags lessonOpen 11% slower', () => {
    const run = base();
    run['1440x900'].lessonOpenMs = 1110;
    const r = compareSpeed(base(), run).find((x) => x.metric === 'lessonOpenMs' && x.viewport === '1440x900');
    expect(r).toMatchObject({ ok: false, base: 1000, now: 1110 });
    expect(compareSpeed(base(), base()).every((x) => x.ok)).toBe(true);
  });
  it('allows checkpoint +299 ms', () => {
    const run = base();
    run['390x844'].checkpointResultMs = 2299;
    expect(compareSpeed(base(), run).find((x) => x.metric === 'checkpointResultMs' && x.viewport === '390x844')?.ok).toBe(true);
  });
  it('flags checkpoint +301 ms', () => {
    const run = base();
    run['390x844'].checkpointResultMs = 2301;
    expect(compareSpeed(base(), run).find((x) => x.metric === 'checkpointResultMs' && x.viewport === '390x844')?.ok).toBe(false);
  });
});
