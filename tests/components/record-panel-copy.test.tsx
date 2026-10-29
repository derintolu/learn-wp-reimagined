// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { content } from '../../src/content';
import { NOT_SAVED, NO_WORKING_COPY, OFFICIAL_PANEL_COPY, RecordPanel, SaveWarning, resetSaveWarning } from '../../src/components/RecordPanel';
import { ensureSession, resetSession } from '../../src/record/session';
import { setRecordManager } from '../../src/record/useRecord';
import { LRS_HOST } from '../../src/shared/course-meta';
import { RecordManager } from '../../src/record/store';
import type { LearningRecord } from '../../src/shared/record';

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 404 })));
  let saved: LearningRecord | null = null;
  // An IndexedDB-kind store, so the panel shows its "Working copy in this browser" line.
  setRecordManager(new RecordManager({ kind: 'indexeddb', load: async () => saved, save: async (r) => void (saved = r) }, content));
});
afterEach(() => {
  cleanup();
  resetSession();
  resetSaveWarning();
  setRecordManager(null);
  vi.unstubAllGlobals();
});

const memoryManagerFor = () => new RecordManager({ kind: 'memory', load: async () => null, save: async () => {} }, content);

const body = () => {
  render(<RecordPanel />);
  fireEvent.click(screen.getByRole('button', { name: /record/i }));
  return document.querySelector('.record__body')!.textContent!;
};

describe('record panel privacy line', () => {
  it('the official record is on our servers, the browser keeps a working copy', () => {
    const t = body();
    expect(t).toContain(OFFICIAL_PANEL_COPY);
    expect(OFFICIAL_PANEL_COPY).toContain(LRS_HOST);
    expect(t).toContain('working copy');
    expect(t).not.toContain('stays on this device');
    expect(t).not.toContain('second server');
    expect(t).not.toContain('Your answers and tutor messages');
    expect(t).not.toMatch(/\p{Extended_Pictographic}/u);
  });

  it("with no browser storage: still the official record, and the browser can't keep a working copy", () => {
    setRecordManager(memoryManagerFor());
    const t = body();
    expect(t).toContain(OFFICIAL_PANEL_COPY);
    expect(t).toContain("This browser can't keep a working copy.");
  });

  it('names the browser state as a working copy, not as where the record is saved', () => {
    body();
    expect(document.querySelector('.record__state')!.textContent).toBe('Working copy in this browser');
    expect(document.body.textContent).not.toContain('Saved in this browser');
  });
});

describe('a browser that keeps nothing (private window, blocked storage)', () => {
  const noStorage = () => setRecordManager(memoryManagerFor());
  const withSession = async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ actor: { homePage: 'https://learnwp.sqwrlz.com', name: 'a1' } }), { status: 200 })));
    expect(await ensureSession({ create: false })).not.toBeNull();
  };

  it('with no session yet: "Not saved", and the warning says nothing is being saved', () => {
    noStorage();
    render(<SaveWarning />);
    expect(screen.getByText(NOT_SAVED)).toBeTruthy();
    cleanup();
    render(<RecordPanel />);
    expect(screen.getByRole('button', { name: /record/i }).textContent).toContain('Not saved');
  });

  it('with a session: the official record is on our servers, only the working copy is missing', async () => {
    noStorage();
    await withSession();
    render(<SaveWarning />);
    expect(screen.getByText(NO_WORKING_COPY)).toBeTruthy();
    expect(screen.queryByText(NOT_SAVED)).toBeNull();
    cleanup();
    render(<RecordPanel />);
    const button = screen.getByRole('button', { name: /record/i });
    expect(button.textContent).not.toContain('Not saved');
    fireEvent.click(button);
    expect(document.querySelector('.record__state')!.textContent).toBe('No working copy in this browser');
  });
});
