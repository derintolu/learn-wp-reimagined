// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { content } from '../../src/content';
import { OFFICIAL_PANEL_COPY, RecordPanel, SHADOW_PANEL_COPY } from '../../src/components/RecordPanel';
import { setRecordManager } from '../../src/record/useRecord';
import { LRS_HOST } from '../../src/shared/course-meta';
import { RecordManager } from '../../src/record/store';
import type { LearningRecord } from '../../src/shared/record';
import { phasesUpTo, restoreFlags, setFlags } from '../helpers/flags';

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 404 })));
  let saved: LearningRecord | null = null;
  // An IndexedDB-kind store, so the panel shows its "Saved in this browser" line.
  setRecordManager(new RecordManager({ kind: 'indexeddb', load: async () => saved, save: async (r) => void (saved = r) }, content));
});
afterEach(() => {
  cleanup();
  restoreFlags();
  setRecordManager(null);
  vi.unstubAllGlobals();
});

const memoryManagerFor = () => new RecordManager({ kind: 'memory', load: async () => null, save: async () => {} }, content);

const body = () => {
  render(<RecordPanel />);
  fireEvent.click(screen.getByRole('button', { name: /record/i }));
  return document.querySelector('.record__body')!.textContent!;
};

describe('record panel privacy line, per flag state', () => {
  it("today: answers aren't stored, and nothing mentions a second server", () => {
    const t = body();
    expect(t).toContain("and aren't stored.");
    expect(t).not.toContain('second server');
  });

  it("lrsShadow on: the answers are no longer said to be unstored, and the copy on the second server is named", () => {
    phasesUpTo('lrsShadow');
    const t = body();
    expect(t).toContain(SHADOW_PANEL_COPY);
    expect(t).not.toContain("and aren't stored");
    expect(t).toContain("Tutor messages aren't stored.");
  });

  it('lrsShadow out of order (senseiLearners off): unchanged', () => {
    setFlags({ lrsShadow: true });
    expect(body()).not.toContain('second server');
  });

  it('lrsShadow on with no browser storage: the second-server copy is still named', () => {
    setRecordManager(memoryManagerFor());
    phasesUpTo('lrsShadow');
    const t = body();
    expect(t).toContain("isn't being saved");
    expect(t).toContain(SHADOW_PANEL_COPY);
  });

  it('officialRecord on: the official record is on our servers, the browser keeps a working copy', () => {
    phasesUpTo('officialRecord');
    const t = body();
    expect(t).toContain(OFFICIAL_PANEL_COPY);
    expect(OFFICIAL_PANEL_COPY).toContain(LRS_HOST);
    expect(t).toContain('working copy');
    expect(t).not.toContain('stays on this device');
    expect(t).not.toContain('Your answers and tutor messages');
    expect(t).not.toMatch(/\p{Extended_Pictographic}/u);
  });
});
