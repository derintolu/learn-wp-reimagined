// @vitest-environment happy-dom
// @vitest-environment-options {"settings": {"enableIframePageLoading": true}}
// Editors open the learner's saved file only when it was edited in THIS lesson (final review item 1).
// Uses the real block-theme content, so the scenarios match the live path.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { EditorView } from '@codemirror/view';

vi.mock('../../src/ai/client', () => ({
  getStatus: vi.fn(),
  placement: vi.fn(),
  judge: vi.fn(),
  codeFeedback: vi.fn(),
  tutorStream: vi.fn(),
}));

import { App } from '../../src/app';
import { getStatus, tutorStream, codeFeedback } from '../../src/ai/client';
import { content } from '../../src/content';
import { setRecordManager } from '../../src/record/useRecord';
import { setPlaygroundImporter } from '../../src/studio/previewClient';
import { resetSaveWarning } from '../../src/components/RecordPanel';
import { RecordManager, type RecordStore } from '../../src/record/store';
import { applyEvent, newRecord, type LearningRecord } from '../../src/shared/record';

const L1 = 'bt-what-is-a-block-theme';
const L4 = 'bt-global-styles';

let manager: RecordManager;
function use(r: LearningRecord) {
  let saved: LearningRecord | null = r;
  const store: RecordStore = {
    kind: 'indexeddb',
    load: async () => saved,
    save: async (x) => {
      saved = x;
    },
  };
  manager = new RecordManager(store, content);
  vi.spyOn(manager, 'dispatch');
  setRecordManager(manager);
}
const dispatched = () => vi.mocked(manager.dispatch).mock.calls.map((c) => c[0]);

async function editorText(name: RegExp): Promise<string> {
  const el = await screen.findByRole('textbox', { name });
  const view = EditorView.findFromDOM(el.closest('.cm-editor') as HTMLElement);
  if (!view) throw new Error('no editor view');
  return view.state.doc.toString();
}

function at(lessonId: string, r: LearningRecord): LearningRecord {
  const lesson = content.lessons[lessonId];
  return { ...r, current: { pathId: 'block-theme', lessonId, beatIndex: lesson.beats.length - 1 } };
}

/** Lesson 4's finished theme.json: the learner's later edit, which fixes lesson 1's planted bug too. */
const LATER_THEME_JSON = content.paths['block-theme'].finalFiles!['theme.json'];

beforeEach(() => {
  setPlaygroundImporter(() => Promise.reject(new Error('no Playground in tests')));
  vi.mocked(getStatus).mockResolvedValue({ ai: 'off' });
  vi.mocked(tutorStream).mockRejectedValue(new Error('off'));
  vi.mocked(codeFeedback).mockResolvedValue({ ok: false, fallback: true });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  setRecordManager(null);
  setPlaygroundImporter(null);
  resetSaveWarning();
  vi.restoreAllMocks();
});

describe('Lesson editors only load files saved in that lesson', () => {
  it('(a) theme.json edited in lesson 4, then lesson 1: the bug hunt still shows the planted bug and does not auto-pass', async () => {
    const bug = content.lessons[L1].bug!;
    expect(bug.file).toBe('theme.json');
    use(
      at(L1, {
        ...newRecord(),
        files: { 'theme.json': LATER_THEME_JSON },
        fileLessons: { 'theme.json': L4 },
      }),
    );
    history.replaceState(null, '', `/learn/${L1}`);
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: /bug hunt/i }));
    const box = await screen.findByRole('region', { name: /Catch the bug/ });
    expect(await editorText(/theme\.json/)).toBe(bug.code);
    fireEvent.click(within(box).getByRole('button', { name: 'Check my fix' }));
    expect(await within(box).findByText('Not yet. The bug is still in there.')).toBeTruthy();
    expect(dispatched()).toContainEqual({ type: 'codeChecked', lessonId: L1, file: 'theme.json', passed: false });
    expect(dispatched().some((e) => e.type === 'lessonCompleted')).toBe(false);
  });

  it('(a) a legacy edit with no lesson tag is not loaded into the bug hunt either', async () => {
    use(at(L1, { ...newRecord(), files: { 'theme.json': LATER_THEME_JSON } }));
    history.replaceState(null, '', `/learn/${L1}`);
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: /bug hunt/i }));
    await screen.findByRole('region', { name: /Catch the bug/ });
    expect(await editorText(/theme\.json/)).toBe(content.lessons[L1].bug!.code);
  });

  it('the bug hunt does reopen the learner’s own work in progress from that lesson', async () => {
    // Still fails the fix checks, so it is a fix in progress (a copy that passes gives way to the bug).
    const mine = content.lessons[L1].bug!.code + '\n';
    use(at(L1, { ...newRecord(), files: { 'theme.json': mine }, fileLessons: { 'theme.json': L1 } }));
    history.replaceState(null, '', `/learn/${L1}`);
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: /bug hunt/i }));
    await screen.findByRole('region', { name: /Catch the bug/ });
    expect(await editorText(/theme\.json/)).toBe(mine);
  });

  it('(b) after the skip branch from lesson 1, lesson 4’s code checkpoint opens lesson 4’s starter', async () => {
    // Lesson 1: the learner fixed the bug (an edit tagged lesson 1), then the judge chose "skip".
    const fixed = content.lessons[L1].bug!.code.replace('"value"', '"color"');
    let r: LearningRecord = {
      ...newRecord(),
      placement: { pathId: 'block-theme', startLessonId: L1, skip: [], reason: 'Picked.' },
    };
    r = applyEvent(r, { type: 'fileEdited', file: 'theme.json', content: fixed, lessonId: L1 }, content);
    const skip = content.lessons[L1].checkpoint!.branches.find((b) => b.outcome === 'skip')!;
    r = applyEvent(r, { type: 'checkpointAnswered', lessonId: L1, response: 'I know this', outcome: 'skip', to: skip.to }, content);
    r = applyEvent(r, { type: 'lessonCompleted', lessonId: L1 }, content);
    use(at(L4, r));
    history.replaceState(null, '', `/learn/${L4}`);
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: /checkpoint/i }));
    await screen.findByRole('region', { name: /Checkpoint/ });
    const starter = content.lessons[L4].starterFiles!['theme.json'];
    expect(starter).not.toBe(fixed);
    await waitFor(async () => expect(await editorText(/theme\.json/)).toBe(starter));
  });

  it('lesson 4’s checkpoint reopens the learner’s lesson 4 edit', async () => {
    const mine = content.lessons[L4].starterFiles!['theme.json'] + '\n';
    use(at(L4, { ...newRecord(), files: { 'theme.json': mine }, fileLessons: { 'theme.json': L4 } }));
    history.replaceState(null, '', `/learn/${L4}`);
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: /checkpoint/i }));
    await screen.findByRole('region', { name: /Checkpoint/ });
    await act(async () => {});
    expect(await editorText(/theme\.json/)).toBe(mine);
  });
});

describe('Path overview after a checkpoint skip branch', () => {
  it('counts the jumped-over lesson as skipped, so the path is done and the finale button shows', async () => {
    const path = content.paths['block-theme'];
    const skip = content.lessons[L1].checkpoint!.branches.find((b) => b.outcome === 'skip')!;
    let r: LearningRecord = {
      ...newRecord(),
      placement: { pathId: 'block-theme', startLessonId: L1, skip: [], reason: 'Picked.' },
    };
    r = applyEvent(r, { type: 'checkpointAnswered', lessonId: L1, response: 'I know this', outcome: 'skip', to: skip.to }, content);
    const jumped = path.lessons.slice(1, path.lessons.indexOf(skip.to));
    expect(jumped.length).toBeGreaterThan(0);
    for (const id of path.lessons) if (!jumped.includes(id)) r = applyEvent(r, { type: 'lessonCompleted', lessonId: id }, content);
    use(r);
    history.replaceState(null, '', '/path/block-theme');
    render(<App />);
    const list = await screen.findByRole('list', { name: /Lessons/ });
    await waitFor(() => expect(within(list).getAllByText('Skipped')).toHaveLength(jumped.length));
    expect(screen.getByRole('link', { name: /Go to the finale/ }).getAttribute('href')).toBe('/finale/block-theme');
  });
});
