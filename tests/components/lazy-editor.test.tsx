// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { CodeEditor, preloadCodeEditor, setEditorImporter } from '../../src/components/LazyCodeEditor';

afterEach(() => {
  cleanup();
  setEditorImporter(null);
});

describe('LazyCodeEditor', () => {
  it('falls back to a labelled textarea when CodeMirror fails to load, and the learner can still edit', async () => {
    setEditorImporter(() => Promise.reject(new Error('chunk failed')));
    const onChange = vi.fn();
    render(<CodeEditor file="theme.json" value='{ "version": 2 }' onChange={onChange} />);
    const box = (await screen.findByRole('textbox', { name: 'Code editor for theme.json' })) as HTMLTextAreaElement;
    expect(box.tagName).toBe('TEXTAREA');
    expect(box.value).toBe('{ "version": 2 }');
    fireEvent.input(box, { target: { value: '{ "version": 3 }' } });
    expect(onChange).toHaveBeenCalledWith('{ "version": 3 }');
  });

  it('forgets a failed load, so a retry can succeed', async () => {
    const importer = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockImplementation(() => import('../../src/components/CodeEditor'));
    setEditorImporter(importer);
    await expect(preloadCodeEditor()).rejects.toThrow('offline');
    render(<CodeEditor file="theme.json" value="{}" onChange={() => {}} />);
    await waitFor(() => expect(document.querySelector('.cm-content')).toBeTruthy());
    expect(importer).toHaveBeenCalledTimes(2);
  });

  it('"Load the full editor" retries after a failure', async () => {
    const importer = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockImplementation(() => import('../../src/components/CodeEditor'));
    setEditorImporter(importer);
    render(<CodeEditor file="a.css" value="a{}" onChange={() => {}} label="Edit a.css" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Load the full editor' }));
    await waitFor(() => expect(document.querySelector('.cm-content')).toBeTruthy());
    expect(screen.getByRole('textbox', { name: 'Edit a.css' }).classList.contains('cm-content')).toBe(true);
  });

  it('a new value from outside replaces the text without echoing it to onChange', async () => {
    const { CodeEditor: Real } = await import('../../src/components/CodeEditor');
    const { EditorView } = await import('@codemirror/view');
    const onChange = vi.fn();
    const { rerender } = render(<Real file="a.css" value="a{}" onChange={onChange} />);
    const view = EditorView.findFromDOM(document.querySelector('.cm-editor') as HTMLElement)!;
    rerender(<Real file="a.css" value="b{}" onChange={onChange} />);
    await waitFor(() => expect(view.state.doc.toString()).toBe('b{}'));
    expect(onChange).not.toHaveBeenCalled();
    view.dispatch({ changes: { from: 0, insert: 'x' } });
    expect(onChange).toHaveBeenCalledWith('xb{}');
  });
});
