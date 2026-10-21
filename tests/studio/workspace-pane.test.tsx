// @vitest-environment happy-dom
// @vitest-environment-options {"settings": {"enableIframePageLoading": true}}
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { EditorView } from '@codemirror/view';

vi.mock('../../src/content', async () => {
  const { buildContent } = await import('../../scripts/build-content');
  return { content: buildContent('tests/fixtures/content') };
});

import { content } from '../../src/content';
import { setRecordManager } from '../../src/record/useRecord';
import { FILE_EDIT_DEBOUNCE_MS } from '../../src/record/useFileEdits';
import { setPlaygroundImporter } from '../../src/studio/previewClient';
import { StudioProvider, useStudio, type Studio } from '../../src/studio/StudioContext';
import { Workspace } from '../../src/studio/WorkspacePane';
import type { RecordManager } from '../../src/record/store';
import { RecordManager as Manager } from '../../src/record/store';
import { memoryManager } from '../components/helpers';

const DIR = '/wordpress/wp-content/themes/my-block-theme';
const lesson = () => content.lessons['templates-and-parts']; // owns theme.json; style.css and templates/index.html are provided

/** A fake Playground client. `hold` makes each writeFile wait until released, in call order. */
function fakePlayground() {
  const writes: Array<{ path: string; data: string }> = [];
  const client = {
    isReady: vi.fn(async () => {}),
    mkdir: vi.fn(async () => {}),
    writeFile: vi.fn(async (path: string, data: string) => void writes.push({ path, data })),
    goTo: vi.fn(async () => {}),
  };
  let boot!: () => void;
  const booted = new Promise<void>((r) => (boot = r));
  const startPlaygroundWeb = vi.fn(async () => {
    await booted;
    return client;
  });
  setPlaygroundImporter(async () => ({ startPlaygroundWeb }) as never);
  return { client, writes, boot };
}

let manager: RecordManager;
let studio!: Studio;
function Probe() {
  studio = useStudio();
  return null;
}

function mount() {
  manager = memoryManager(content);
  vi.spyOn(manager, 'dispatch');
  setRecordManager(manager);
  return render(
    <StudioProvider lesson={lesson()}>
      <Probe />
      <Workspace />
    </StudioProvider>,
  );
}

async function editorView(name: RegExp): Promise<EditorView> {
  const el = await screen.findByRole('textbox', { name });
  const view = EditorView.findFromDOM(el.closest('.cm-editor') as HTMLElement);
  if (!view) throw new Error('no editor view');
  return view;
}

function type(view: EditorView, text: string) {
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
}

async function live() {
  await screen.findByText('Live: your theme in WordPress Playground');
}

afterEach(() => {
  cleanup();
  setRecordManager(null);
  setPlaygroundImporter(null);
  vi.useRealTimers();
});

describe('workspace pane', () => {
  it('tabs list every workspace file, with the open tab aria-selected', async () => {
    fakePlayground();
    mount();
    const list = await screen.findByRole('tablist', { name: 'Files' });
    const tabs = within(list).getAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual(['style.css', 'templates/index.html', 'theme.json']);
    expect(within(list).getByRole('tab', { name: 'theme.json' }).getAttribute('aria-selected')).toBe('true');
    expect(within(list).getByRole('tab', { name: 'style.css' }).getAttribute('aria-selected')).toBe('false');

    fireEvent.click(within(list).getByRole('tab', { name: 'style.css' }));
    expect(within(list).getByRole('tab', { name: 'style.css' }).getAttribute('aria-selected')).toBe('true');
    expect(studio.active).toBe('style.css');
  });

  it('openFile switches the tab and the mobile pane to Workspace', async () => {
    fakePlayground();
    mount();
    await screen.findByRole('tablist', { name: 'Files' });
    expect(studio.pane).toBe('lesson');
    act(() => studio.openFile('templates/index.html'));
    expect(studio.active).toBe('templates/index.html');
    expect(studio.pane).toBe('workspace');
    expect(screen.getByRole('tab', { name: 'templates/index.html' }).getAttribute('aria-selected')).toBe('true');
  });

  it('a provided (non-editable) file opens read-only, labelled "Provided"', async () => {
    fakePlayground();
    mount();
    fireEvent.click(await screen.findByRole('tab', { name: 'style.css' }));
    const view = await editorView(/style\.css/);
    expect(view.state.readOnly).toBe(true);
    expect(screen.getByRole('tabpanel').textContent).toContain('Provided');

    fireEvent.click(screen.getByRole('tab', { name: 'theme.json' }));
    const editable = await editorView(/theme\.json/);
    expect(editable.state.readOnly).toBe(false);
    expect(screen.getByRole('tabpanel').textContent).not.toContain('Provided');
  });

  it("typing in an editable file dispatches fileEdited with this lesson's id after the debounce", async () => {
    fakePlayground();
    mount();
    const view = await editorView(/theme\.json/);
    vi.useFakeTimers();
    type(view, '{"version":3}');
    expect(vi.mocked(manager.dispatch)).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(FILE_EDIT_DEBOUNCE_MS + 10);
    expect(vi.mocked(manager.dispatch)).toHaveBeenCalledWith({
      type: 'fileEdited',
      file: 'theme.json',
      content: '{"version":3}',
      lessonId: 'templates-and-parts',
    });
  });

  it('replaceFile changes the text without recording an edit', async () => {
    fakePlayground();
    mount();
    const view = await editorView(/theme\.json/); // the editor is live, so it sees the new text
    act(() => studio.replaceFile('theme.json', '{"bug":true}'));
    await waitFor(() => expect(view.state.doc.toString()).toBe('{"bug":true}'));
    act(() => studio.flush());
    expect(studio.files['theme.json']).toBe('{"bug":true}');
    expect(studio.dirty).toEqual(['theme.json']);
    expect(vi.mocked(manager.dispatch)).not.toHaveBeenCalled();
  });

  it('Apply to site writes only dirty files to the preview and clears the dirty dots', async () => {
    const { writes, client, boot } = fakePlayground();
    mount();
    boot();
    await live();
    type(await editorView(/theme\.json/), '{"version":3}');
    const tab = screen.getByRole('tab', { name: /theme\.json/ });
    await waitFor(() => expect(tab.querySelector('.ws-dot')).toBeTruthy());
    expect(studio.dirty).toEqual(['theme.json']);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Apply to site' }));
    });
    await waitFor(() => expect(client.goTo).toHaveBeenCalled());
    expect(writes).toEqual([{ path: `${DIR}/theme.json`, data: '{"version":3}' }]);
    expect(studio.dirty).toEqual([]);
    expect(document.querySelector('.ws-dot')).toBeNull();
  });

  it('a file added after boot is written, with its folder made first', async () => {
    const { client, writes, boot } = fakePlayground();
    mount();
    boot();
    await live();
    act(() => studio.replaceFile('parts/header.html', '<header/>'));
    expect(screen.getByRole('tab', { name: /parts\/header\.html/ })).toBeTruthy();
    await act(() => studio.apply());
    expect(client.mkdir).toHaveBeenCalledWith(`${DIR}/parts`);
    expect(writes).toEqual([{ path: `${DIR}/parts/header.html`, data: '<header/>' }]);
  });

  it('applying invalid JSON still writes it and nothing throws', async () => {
    const { writes, boot } = fakePlayground();
    mount();
    boot();
    await live();
    type(await editorView(/theme\.json/), '{ "version": 3,');
    await act(() => studio.apply());
    expect(writes).toEqual([{ path: `${DIR}/theme.json`, data: '{ "version": 3,' }]);
  });

  it('apply before the preview is ready waits, then writes once it is', async () => {
    const { writes, boot } = fakePlayground();
    mount();
    await screen.findByRole('tablist', { name: 'Files' });
    act(() => studio.replaceFile('theme.json', '{"early":true}'));
    await act(() => studio.apply());
    expect(writes).toEqual([]);
    expect(studio.dirty).toEqual([]);
    boot();
    await live();
    await waitFor(() => expect(writes).toEqual([{ path: `${DIR}/theme.json`, data: '{"early":true}' }]));
  });

  it('overlapping applies land in order, and a failed write does not break the next', async () => {
    const { client, writes, boot } = fakePlayground();
    const releases: Array<() => void> = [];
    let calls = 0;
    client.writeFile.mockImplementation(async (path: string, data: string) => {
      const n = ++calls;
      await new Promise<void>((r) => releases.push(r));
      if (n === 1) throw new Error('disk full');
      writes.push({ path, data });
    });
    mount();
    boot();
    await live();

    let first!: Promise<void>, second!: Promise<void>, third!: Promise<void>;
    act(() => studio.replaceFile('theme.json', 'one'));
    act(() => void (first = studio.apply()));
    act(() => studio.replaceFile('theme.json', 'two'));
    act(() => void (second = studio.apply()));
    act(() => studio.replaceFile('theme.json', 'three'));
    act(() => void (third = studio.apply()));

    // Only the first write has started; the rest wait their turn.
    await waitFor(() => expect(releases).toHaveLength(1));
    releases[0](); // rejects
    await expect(first).resolves.toBeUndefined();
    expect(studio.dirty).toEqual([]); // 'one' failed, but 'three' has been applied since
    await waitFor(() => expect(releases).toHaveLength(2));
    releases[1]();
    await second;
    await waitFor(() => expect(releases).toHaveLength(3));
    releases[2]();
    await third;
    expect(writes.map((w) => w.data)).toEqual(['two', 'three']);
  });

  it('a failed write leaves the file dirty, and the next apply retries it', async () => {
    const { client, writes, boot } = fakePlayground();
    client.writeFile.mockRejectedValueOnce(new Error('disk full'));
    mount();
    boot();
    await live();
    act(() => studio.replaceFile('theme.json', 'mine'));
    await act(() => studio.apply());
    expect(writes).toEqual([]);
    expect(studio.dirty).toEqual(['theme.json']);
    expect(screen.getByRole('tab', { name: /theme\.json/ }).querySelector('.ws-dot')).toBeTruthy();
    await act(() => studio.apply());
    expect(writes).toEqual([{ path: `${DIR}/theme.json`, data: 'mine' }]);
    expect(studio.dirty).toEqual([]);
  });

  it('a record that fails to load still opens the files', async () => {
    fakePlayground();
    manager = new Manager({ kind: 'indexeddb', load: async () => Promise.reject(new Error('blocked')), save: async () => {} }, content);
    setRecordManager(manager);
    render(
      <StudioProvider lesson={lesson()}>
        <Probe />
        <Workspace />
      </StudioProvider>,
    );
    const list = await screen.findByRole('tablist', { name: 'Files' });
    expect(within(list).getAllByRole('tab').map((t) => t.textContent)).toEqual(['style.css', 'templates/index.html', 'theme.json']);
    expect(screen.queryByText('Opening your files…')).toBeNull();
    expect(studio.editable).toContain('theme.json');
  });

  it('while the preview has failed, Apply is disabled, says why, and leaves files dirty', async () => {
    setPlaygroundImporter(async () => {
      throw new Error('offline');
    });
    mount();
    await screen.findByText(/Couldn't start WordPress here\./);
    const btn = screen.getByRole('button', { name: 'Apply to site' }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    const desc = document.getElementById(btn.getAttribute('aria-describedby') ?? '');
    expect(desc?.textContent).toBe("WordPress couldn't start here. Use Open in Playground below.");
    type(await editorView(/theme\.json/), '{"version":3}');
    await waitFor(() => expect(studio.dirty).toEqual(['theme.json']));
    await act(() => studio.apply());
    expect(studio.dirty).toEqual(['theme.json']);
    expect(screen.getByRole('tab', { name: /theme\.json/ }).querySelector('.ws-dot')).toBeTruthy();
  });

  it('Apply is enabled while the preview boots and once it is live', async () => {
    const { boot } = fakePlayground();
    mount();
    const btn = (await screen.findByRole('button', { name: 'Apply to site' })) as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    expect(btn.getAttribute('aria-describedby')).toBeNull();
    boot();
    await live();
    expect(btn.disabled).toBe(false);
  });

  it('on a completed lesson every file is read-only, labelled "Lesson complete"', async () => {
    fakePlayground();
    manager = memoryManager(content);
    await manager.init();
    await manager.dispatch({ type: 'lessonCompleted', lessonId: 'templates-and-parts' });
    expect(manager.record.completedLessons).toContain('templates-and-parts');
    setRecordManager(manager);
    render(
      <StudioProvider lesson={lesson()}>
        <Probe />
        <Workspace />
      </StudioProvider>,
    );
    const view = await editorView(/style\.css/);
    expect(view.state.readOnly).toBe(true);
    expect(studio.editable).toEqual([]);
    expect(screen.getByRole('tabpanel').textContent).toContain('Lesson complete. Read-only.');
    expect(screen.getByRole('tabpanel').textContent).not.toContain('Provided');
  });
});
