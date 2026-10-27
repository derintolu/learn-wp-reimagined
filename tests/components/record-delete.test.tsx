// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { LocationProvider } from 'preact-iso';
import { FEATURES } from '../../src/config';
import { content } from '../../src/content';
import { RecordPanel } from '../../src/components/RecordPanel';
import { resetSession } from '../../src/record/session';
import { useFileEdits } from '../../src/record/useFileEdits';
import { getRecordManager, setRecordManager } from '../../src/record/useRecord';
import { memoryManager } from './helpers';

const flags = FEATURES as { sessions: boolean };
const lessonId = Object.keys(content.lessons)[0];
const FAILED = "We couldn't delete your data. Nothing was changed. Try again later.";

const BROWSER_FAILED = "Your data was deleted on this site, but this browser's copy couldn't be cleared. Close this tab's site data to finish.";

function stubDelete(status: number) {
  const f = vi.fn(async (url: string, init: RequestInit = {}) => {
    if (url === '/api/session' && init.method === 'DELETE') return new Response(JSON.stringify(status === 200 ? { deleted: true } : { error: { code: 'x' } }), { status });
    return new Response(JSON.stringify({ actor: null }), { status: 200 });
  });
  vi.stubGlobal('fetch', f);
  return f;
}

async function openPanel() {
  render(
    <LocationProvider>
      <RecordPanel />
    </LocationProvider>,
  );
  const trigger = screen.getByRole('button', { name: /Your record/ });
  fireEvent.click(trigger);
  const panel = await screen.findByRole('dialog', { name: /Your record/ });
  return { trigger, panel };
}

beforeEach(async () => {
  flags.sessions = true;
  resetSession();
  const m = memoryManager(content);
  setRecordManager(m);
  flags.sessions = false;
  await m.dispatch({ type: 'lessonCompleted', lessonId });
  await m.settled();
  flags.sessions = true;
});
afterEach(() => {
  cleanup();
  flags.sessions = false;
  setRecordManager(null);
  vi.unstubAllGlobals();
});

describe('Delete my data', () => {
  it('is not offered while sessions are off', async () => {
    flags.sessions = false;
    const { panel } = await openPanel();
    expect(within(panel).queryByRole('button', { name: 'Delete my data' })).toBeNull();
  });

  it('is keyboard operable and returns focus', async () => {
    stubDelete(200);
    const { panel } = await openPanel();
    const trigger = within(panel).getByRole('button', { name: 'Delete my data' });
    trigger.focus();
    fireEvent.click(trigger);
    const dlg = await screen.findByRole('alertdialog', { name: 'Delete my data?' });
    expect(dlg.getAttribute('aria-modal')).toBe('true');
    expect(within(dlg).getByText("This deletes your progress on this site and in this browser. It can't be undone.")).toBeTruthy();
    const keep = within(dlg).getByRole('button', { name: 'Keep it' });
    const del = within(dlg).getByRole('button', { name: 'Delete' });
    expect(dlg.contains(document.activeElement)).toBe(true);
    // Tab stays inside, both ways.
    del.focus();
    fireEvent.keyDown(del, { key: 'Tab' });
    expect(document.activeElement).toBe(keep);
    fireEvent.keyDown(keep, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(del);
    // Escape closes as "Keep it": the record stays, the panel stays open, focus returns.
    fireEvent.keyDown(dlg, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(document.activeElement).toBe(trigger);
    expect(screen.getByRole('dialog', { name: /Your record/ })).toBeTruthy();
    expect(getRecordManager().record.statements.length).toBeGreaterThan(0);
    // "Keep it" does the same.
    fireEvent.click(trigger);
    fireEvent.click(await screen.findByRole('button', { name: 'Keep it' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(document.activeElement).toBe(trigger);
  });

  it('deleting clears the record, closes the dialog and says so', async () => {
    const f = stubDelete(200);
    const { panel } = await openPanel();
    const trigger = within(panel).getByRole('button', { name: 'Delete my data' });
    fireEvent.click(trigger);
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(f).toHaveBeenCalledWith('/api/session', expect.objectContaining({ method: 'DELETE' }));
    expect(getRecordManager().record.statements).toHaveLength(0);
    expect(within(panel).getByText('Your data is deleted.')).toBeTruthy();
    expect(document.activeElement).toBe(trigger);
  });

  it('leaves the record when the server fails and says so', async () => {
    stubDelete(500);
    const { panel } = await openPanel();
    fireEvent.click(within(panel).getByRole('button', { name: 'Delete my data' }));
    const dlg = await screen.findByRole('alertdialog');
    fireEvent.click(within(dlg).getByRole('button', { name: 'Delete' }));
    const msg = await within(dlg).findByText(FAILED);
    expect(msg.closest('[role="status"]')).toBeTruthy();
    expect(screen.getByRole('alertdialog')).toBeTruthy();
    expect(getRecordManager().record.statements.length).toBeGreaterThan(0);
  });

  it('after a failed delete Tab stays inside and Escape closes as Keep it', async () => {
    stubDelete(500);
    const { panel } = await openPanel();
    const trigger = within(panel).getByRole('button', { name: 'Delete my data' });
    fireEvent.click(trigger);
    const dlg = await screen.findByRole('alertdialog');
    fireEvent.click(within(dlg).getByRole('button', { name: 'Delete' }));
    await within(dlg).findByText(FAILED);
    const keep = within(dlg).getByRole('button', { name: 'Keep it' });
    const del = within(dlg).getByRole('button', { name: 'Delete' });
    expect(dlg.contains(document.activeElement)).toBe(true);
    del.focus();
    fireEvent.keyDown(del, { key: 'Tab' });
    expect(document.activeElement).toBe(keep);
    fireEvent.keyDown(keep, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(document.activeElement).toBe(trigger);
  });

  it('a failed delete keeps edits that were waiting to be saved', async () => {
    stubDelete(500);
    function Editor() {
      const { edit } = useFileEdits(lessonId);
      return <button type="button" onClick={() => edit('a.css', 'pending')}>edit</button>;
    }
    render(<Editor />);
    fireEvent.click(screen.getByRole('button', { name: 'edit' }));
    const { panel } = await openPanel();
    fireEvent.click(within(panel).getByRole('button', { name: 'Delete my data' }));
    const dlg = await screen.findByRole('alertdialog');
    fireEvent.click(within(dlg).getByRole('button', { name: 'Delete' }));
    await within(dlg).findByText(FAILED);
    cleanup(); // unmounting flushes the edit that was kept
    await waitFor(() => expect(getRecordManager().record.files['a.css']).toBe('pending'));
  });

  it('says so when this browser could not be cleared after the server deleted', async () => {
    stubDelete(200);
    vi.spyOn(getRecordManager(), 'reset').mockRejectedValue(new Error('disk'));
    const { panel } = await openPanel();
    fireEvent.click(within(panel).getByRole('button', { name: 'Delete my data' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));
    const msg = await screen.findByText(BROWSER_FAILED);
    expect(msg.closest('[role="status"]')).toBeTruthy();
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('the dialog styles fit a phone and respect reduced motion', async () => {
    const { readFileSync } = await import('node:fs');
    const css = readFileSync('src/styles/lesson.css', 'utf8');
    expect(css).toMatch(/\.record-confirm\s*\{[^}]*max-width:\s*min\(/s);
    expect(css).toMatch(/prefers-reduced-motion[\s\S]*\.record-confirm/);
  });
});
