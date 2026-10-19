import { describe, expect, it } from 'vitest';
import { ContentBundleSchema } from '../../src/shared/schema';

const branches = [
  { outcome: 'advance', to: 'a', message: 'ok' },
  { outcome: 'review', to: 'a', message: 'again' },
  { outcome: 'skip', to: 'a', message: 'skip' },
];
const checkpoint = (id: string) => ({
  id,
  question: 'q',
  kind: 'free-text',
  rubric: 'r',
  branches,
  fallback: [{ label: 'x', outcome: 'advance' }],
});
const lesson = (id: string, cp = true) => ({
  id,
  pathId: 'block-theme',
  title: 't',
  minutes: 5,
  sources: [{ title: 's', url: 'https://example.com' }],
  beats: [{ id: 'b', goal: 'g', content: 'c' }],
  ...(cp ? { checkpoint: checkpoint('cp-' + id) } : {}),
});
const path = (status: 'live' | 'coming-soon', lessons: string[]) => ({
  id: 'block-theme', title: 'T', tagline: 'tag', status, lessons, placementHints: 'h',
});
const full = (p: any, lessons: any[]) => ({
  paths: {
    'block-theme': p,
    learner: { ...path('coming-soon', []), id: 'learner' },
    'vibe-coder': { ...path('coming-soon', []), id: 'vibe-coder' },
  },
  lessons: Object.fromEntries(lessons.map((l) => [l.id, l])),
});

describe('ContentBundleSchema', () => {
  it('accepts a live path with two checkpoints', () => {
    const b = full(path('live', ['a', 'b']), [lesson('a'), lesson('b')]);
    expect(ContentBundleSchema.safeParse(b).success).toBe(true);
  });
  it('rejects a live path with one checkpoint', () => {
    const b = full(path('live', ['a', 'b']), [lesson('a'), lesson('b', false)]);
    expect(ContentBundleSchema.safeParse(b).success).toBe(false);
  });
  it('rejects a live path with zero lessons but allows coming-soon', () => {
    expect(ContentBundleSchema.safeParse(full(path('live', []), [])).success).toBe(false);
    expect(ContentBundleSchema.safeParse(full(path('coming-soon', []), [])).success).toBe(true);
  });
  it('rejects a checkpoint missing the skip branch', () => {
    const l: any = lesson('a');
    l.checkpoint.branches = branches.slice(0, 2);
    expect(ContentBundleSchema.safeParse(full(path('live', ['a', 'b']), [l, lesson('b')])).success).toBe(false);
  });
  it('rejects a code checkpoint without file and checks', () => {
    const l: any = lesson('a');
    l.checkpoint.kind = 'code';
    expect(ContentBundleSchema.safeParse(full(path('live', ['a', 'b']), [l, lesson('b')])).success).toBe(false);
  });
  it('rejects a branch to an unknown lesson', () => {
    const l: any = lesson('a');
    l.checkpoint.branches[0].to = 'ghost';
    expect(ContentBundleSchema.safeParse(full(path('live', ['a', 'b']), [l, lesson('b')])).success).toBe(false);
  });
});
