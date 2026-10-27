import { describe, expect, it } from 'vitest';
import { SPEED_FLOOR_MS, cli, compareSpeed, type SpeedFile, type SpeedRun } from '../../scripts/speed/compare';

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

  it('applies a 50 ms floor to a 5 ms base', () => {
    expect(SPEED_FLOOR_MS).toBe(50);
    const b = base();
    b['1440x900'].beatAdvanceMs = 5;
    const at = (ms: number) => {
      const run = base();
      run['1440x900'].beatAdvanceMs = ms;
      return compareSpeed(b, run).find((x) => x.metric === 'beatAdvanceMs' && x.viewport === '1440x900')?.ok;
    };
    expect(at(54)).toBe(true);
    expect(at(55)).toBe(true);
    expect(at(56)).toBe(false);
  });
  it('passes a value exactly at the limit', () => {
    const run = base();
    run['1440x900'].lessonOpenMs = 1100;
    run['1440x900'].checkpointResultMs = 2300;
    expect(compareSpeed(base(), run).every((x) => x.ok)).toBe(true);
  });
});

describe('compare cli', () => {
  const file = (m: object): SpeedFile => ({ ...base(), ...m });
  const files: Record<string, SpeedFile> = {
    a: file({ baseUrl: 'http://x', checkpointPath: 'fallback' }),
    b: file({ baseUrl: 'https://y', checkpointPath: 'fallback' }),
    c: file({ baseUrl: 'http://x', checkpointPath: 'ai' }),
  };
  const go = (args: string[]) => {
    const out: string[] = [];
    return { code: cli(args, (p) => files[p], (m) => out.push(m)), out };
  };
  it('refuses a different baseUrl or checkpointPath', () => {
    expect(go(['a', 'b']).code).toBe(2);
    expect(go(['a', 'b']).out[0]).toMatch(/baseUrl differs/);
    expect(go(['a', 'c']).out[0]).toMatch(/checkpointPath differs/);
  });
  it('compares anyway with --force, and passes matching files', () => {
    expect(go(['a', 'b', '--force']).code).toBe(0);
    expect(go(['a', 'a']).code).toBe(0);
  });
});
