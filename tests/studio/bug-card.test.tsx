// @vitest-environment happy-dom
// @vitest-environment-options {"settings": {"enableIframePageLoading": true}}
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { EditorView } from '@codemirror/view';

vi.mock('../../src/content', async () => {
  const { buildContent } = await import('../../scripts/build-content');
  return { content: buildContent('tests/fixtures/content') };
});
vi.mock('../../src/ai/client', () => ({
  getStatus: vi.fn(),
  placement: vi.fn(),
  judge: vi.fn(),
  codeFeedback: vi.fn(),
  tutorStream: vi.fn(),
}));

import { content } from '../../src/content';
import { setRecordManager } from '../../src/record/useRecord';
import { setPlaygroundImporter } from '../../src/studio/previewClient';
import { StudioProvider, useStudio, type Studio } from '../../src/studio/StudioContext';
import { Workspace } from '../../src/studio/WorkspacePane';
import { BugCard } from '../../src/studio/BugCard';
import { Checkpoint } from '../../src/components/Checkpoint';
import type { RecordManager } from '../../src/record/store';
import type { Lesson } from '../../src/shared/types';
import { memoryManager } from '../components/helpers';

const DIR = '/wordpress/wp-content/themes/my-block-theme';
const BUG_FILE = 'patterns/hero.php';
const FIX = '<?php\n/**\n * Title: Hero\n * Slug: mytheme/hero\n */\n?>\n';

function fakePlayground() {
  const writes: Array<{ path: string; data: string }> = [];
  const client = {
    isReady: vi.fn(async () => {}),
    mkdir: vi.fn(async () => {}),
    writeFile: vi.fn(async (path: string, data: string) => void writes.push({ path, data })),
    goTo: vi.fn(async () => {}),
  };
  setPlaygroundImporter(async () => ({ startPlaygroundWeb: async () => client }) as never);
  return { client, writes };
}

let manager: RecordManager;
let studio!: Studio;
function Probe() {
  studio = useStudio();
  return null;
}

async function useManager(seed?: (m: RecordManager) => Promise<void>) {
  manager = memoryManager(content);
  await manager.init();
  if (seed) await seed(manager);
  vi.spyOn(manager, 'dispatch');
  setRecordManager(manager);
}
const dispatched = () => vi.mocked(manager.dispatch).mock.calls.map((c) => c[0]);

function mountBug(onSolved = vi.fn()) {
  const lesson = content.lessons['patterns'];
  render(
    <StudioProvider lesson={lesson}>
      <Probe />
      <BugCard lesson={lesson} ai="off" onSolved={onSolved} />
      <Workspace />
    </StudioProvider>,
  );
  return onSolved;
}

async function editorView(name: RegExp): Promise<EditorView> {
  const el = await screen.findByRole('textbox', { name });
  const view = EditorView.findFromDOM(el.closest('.cm-editor') as HTMLElement);
  if (!view) throw new Error('no editor view');
  return view;
}
async function typeInto(name: RegExp, text: string) {
  const view = await editorView(name);
  act(() => {
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
  });
}

afterEach(() => {
  cleanup();
  setRecordManager(null);
  setPlaygroundImporter(null);
  vi.restoreAllMocks();
});

describe('BugCard', () => {
  it('starting the hunt swaps in bug.code, opens the file and applies it', async () => {
    const bug = content.lessons['patterns'].bug!;
    expect(content.lessons['patterns'].starterFiles![BUG_FILE]).not.toBe(bug.code);
    const { writes } = fakePlayground();
    await useManager();
    mountBug();
    await waitFor(() => expect(writes).toContainEqual({ path: `${DIR}/${BUG_FILE}`, data: bug.code }));
    expect(studio.files[BUG_FILE]).toBe(bug.code);
    expect(studio.active).toBe(BUG_FILE);
    expect(studio.pane).toBe('workspace');
    expect(studio.dirty).toEqual([]);
    expect(dispatched().some((e) => e.type === 'fileEdited')).toBe(false);

    const box = screen.getByRole('region', { name: /Catch the bug/ });
    expect(box.textContent).toContain('AI-written code. We planted one bug. Find it.');
    expect(box.textContent).toContain(`Look at the preview on the right, then fix ${BUG_FILE} there by hand.`);
    expect(within(box).queryByRole('textbox')).toBeNull(); // the editor lives in the workspace
    // Before the first check the checklist is grey: neither passed nor failed.
    const items = within(box).getAllByRole('listitem');
    expect(items.map((li) => li.textContent)).toEqual([expect.stringContaining('Namespace the slug.')]);
    expect(items[0].className).toContain('is-pending');

    act(() => studio.openFile('style.css'));
    fireEvent.click(within(box).getByRole('button', { name: `Open ${BUG_FILE}` }));
    expect(studio.active).toBe(BUG_FILE);
  });

  it('reload mid-hunt restores the saved partial fix, not bug.code', async () => {
    const partial = '<?php\n/**\n * Title: Hero\n * Slug: mytheme\n */\n?>\n';
    const { writes } = fakePlayground();
    await useManager((m) => m.dispatch({ type: 'fileEdited', file: BUG_FILE, content: partial, lessonId: 'patterns' }));
    mountBug();
    await waitFor(() => expect(writes).toContainEqual({ path: `${DIR}/${BUG_FILE}`, data: partial }));
    expect(writes.some((w) => w.data === content.lessons['patterns'].bug!.code)).toBe(false);
    expect(studio.files[BUG_FILE]).toBe(partial);
    expect(studio.active).toBe(BUG_FILE);
    expect((await editorView(/hero\.php/)).state.doc.toString()).toBe(partial);
  });

  it("another lesson's saved edit of the file does not stand in for bug.code", async () => {
    const bug = content.lessons['patterns'].bug!;
    fakePlayground();
    await useManager((m) => m.dispatch({ type: 'fileEdited', file: BUG_FILE, content: FIX, lessonId: 'templates-and-parts' }));
    mountBug();
    await waitFor(() => expect(studio.files[BUG_FILE]).toBe(bug.code));
  });

  it('a passing fix applies the file and marks every check passed', async () => {
    const { writes } = fakePlayground();
    await useManager();
    const onSolved = mountBug();
    const box = await screen.findByRole('region', { name: /Catch the bug/ });
    await waitFor(() => expect(writes).toHaveLength(1));

    fireEvent.click(within(box).getByRole('button', { name: 'Check my fix' }));
    expect(await within(box).findByText('Not yet. The bug is still in there.')).toBeTruthy();
    expect(within(box).getAllByRole('listitem')[0].className).toContain('is-fail');
    expect(dispatched()).toContainEqual({ type: 'codeChecked', lessonId: 'patterns', file: BUG_FILE, passed: false });
    expect(writes).toHaveLength(1); // a miss applies nothing

    await typeInto(/hero\.php/, FIX);
    fireEvent.click(within(box).getByRole('button', { name: 'Check my fix' }));
    expect(await within(box).findByText(/You caught it/)).toBeTruthy();
    for (const li of within(box).getAllByRole('listitem')) expect(li.className).toContain('is-pass');
    await waitFor(() => expect(writes.at(-1)).toEqual({ path: `${DIR}/${BUG_FILE}`, data: FIX }));
    expect(studio.dirty).toEqual([]);
    expect(onSolved).toHaveBeenCalledTimes(1);
    expect(dispatched()).toContainEqual({ type: 'codeChecked', lessonId: 'patterns', file: BUG_FILE, passed: true });
    expect(dispatched()).toContainEqual({ type: 'fileEdited', file: BUG_FILE, content: FIX, lessonId: 'patterns' });
  });
});

describe('Code checkpoint in the workspace', () => {
  it('code checkpoint checks the workspace copy; two misses offer Keep trying / Review only', async () => {
    const lesson: Lesson = content.lessons['templates-and-parts'];
    const { writes } = fakePlayground();
    await useManager();
    const onResolved = vi.fn();
    render(
      <StudioProvider lesson={lesson}>
        <Probe />
        <Checkpoint lesson={lesson} ai="off" onResolved={onResolved} onRestart={() => {}} />
        <Workspace />
      </StudioProvider>,
    );
    const cp = await screen.findByRole('region', { name: /Checkpoint/ });
    await screen.findByRole('tablist', { name: 'Files' });
    expect(within(cp).queryByRole('textbox')).toBeNull();
    act(() => studio.openFile('style.css'));
    fireEvent.click(within(cp).getByRole('button', { name: 'Edit theme.json in the workspace' }));
    expect(studio.active).toBe('theme.json');

    fireEvent.click(within(cp).getByRole('button', { name: 'Check my code' }));
    await within(cp).findByText('Add a colour with a slug.');
    expect(within(cp).queryByRole('button', { name: 'Keep trying' })).toBeNull();
    fireEvent.click(within(cp).getByRole('button', { name: 'Check my code' }));
    expect(await within(cp).findByRole('button', { name: 'Keep trying' })).toBeTruthy();
    expect(within(cp).getByRole('button', { name: /Review/ })).toBeTruthy();
    expect(within(cp).queryByRole('button', { name: 'Skip this one' })).toBeNull();
    expect(within(cp).queryByRole('button', { name: 'Show me the answer' })).toBeNull();
    fireEvent.click(within(cp).getByRole('button', { name: 'Keep trying' }));
    await waitFor(() => expect(within(cp).queryByRole('button', { name: 'Keep trying' })).toBeNull());
    expect(onResolved).not.toHaveBeenCalled();
    expect(writes).toEqual([]);

    const fixed = '{ "version": 3, "settings": { "color": { "palette": [ { "slug": "brand", "color": "#3858E9", "name": "Brand" } ] } } }';
    await typeInto(/theme\.json/, fixed);
    fireEvent.click(within(cp).getByRole('button', { name: 'Check my code' }));
    await waitFor(() => expect(onResolved).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'advance', response: 'code checks passed' })));
    await waitFor(() => expect(writes).toEqual([{ path: `${DIR}/theme.json`, data: fixed }]));
    const events = dispatched().filter((e) => e.type === 'codeChecked');
    expect(events.map((e) => (e as { passed: boolean }).passed)).toEqual([false, false, true]);
  });
});
