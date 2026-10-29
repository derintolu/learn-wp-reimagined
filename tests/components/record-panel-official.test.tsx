// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { LocationProvider } from 'preact-iso';
import { content } from '../../src/content';
import { RecordPanel } from '../../src/components/RecordPanel';
import { setRecordManager } from '../../src/record/useRecord';
import { memoryManager } from './helpers';
const ids = Object.keys(content.lessons);
const official = { completed: [ids[0], ids[1]], testedOut: [ids[2]], carriedOver: [], branches: [], badges: [], asOf: '2026-01-01T00:00:00.000Z' };

let recordCalls = 0;
let gone = false;
let failing = false;
let exportStatus = 200;
let viewUrl = 'https://lrs.sqwrlz.com/view/abc';
function stub() {
  recordCalls = 0;
  gone = false;
  failing = false;
  exportStatus = 200;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      if (url === '/api/session' && init.method === 'DELETE') {
        gone = true;
        return new Response(JSON.stringify({ deleted: true }), { status: 200 });
      }
      if (url === '/api/record' && gone) return new Response('{}', { status: 401 });
      if (url === '/api/record' && failing) return new Response('{}', { status: 503 });
      if (url === '/api/record/export') return new Response(exportStatus === 200 ? '{"statements":[]}' : '{"error":{}}', { status: exportStatus });
      if (url === '/api/record') {
        recordCalls++;
        return new Response(JSON.stringify(official), { status: 200 });
      }
      if (url === '/api/record/view-link' && init.method === 'POST') return new Response(JSON.stringify({ url: viewUrl }), { status: 200 });
      if (url === '/api/sensei') return new Response(JSON.stringify({}), { status: 200 });
      return new Response(JSON.stringify({ actor: null }), { status: 200 });
    }),
  );
}

async function openPanel() {
  render(
    <LocationProvider>
      <RecordPanel />
    </LocationProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: /Your record/ }));
  return screen.findByRole('dialog', { name: /Your record/ });
}

beforeEach(() => {
  setRecordManager(memoryManager(content));
  stub();
});
afterEach(() => {
  cleanup();
  setRecordManager(null);
  vi.unstubAllGlobals();
});

describe('the official record in the record panel', () => {
  it('panel shows completed and tested-out counts from the server', async () => {
    const panel = await openPanel();
    expect(await screen.findByText('2 lessons completed, 1 lesson tested out.')).toBeTruthy();
    expect(within(panel).getByRole('button', { name: 'Download my record' })).toBeTruthy();
    expect(await screen.findByRole('heading', { name: 'What Sensei sees' })).toBeTruthy();
  });

  it('View in the LRS opens the minted URL in the same tab', async () => {
    const assign = vi.fn();
    vi.stubGlobal('location', { assign, pathname: '/', href: 'http://localhost/', origin: 'http://localhost' });
    await openPanel();
    fireEvent.click(await screen.findByRole('button', { name: 'View in the LRS' }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith('https://lrs.sqwrlz.com/view/abc'));
  });

  it('View in the LRS refuses a URL off the LRS origin', async () => {
    viewUrl = 'https://evil.example/view';
    const assign = vi.fn();
    vi.stubGlobal('location', { assign, pathname: '/', href: 'http://localhost/', origin: 'http://localhost' });
    await openPanel();
    fireEvent.click(await screen.findByRole('button', { name: 'View in the LRS' }));
    expect(await screen.findByText(/couldn't open the LRS/)).toBeTruthy();
    expect(assign).not.toHaveBeenCalled();
    viewUrl = 'https://lrs.sqwrlz.com/view/abc';
  });

  it('refresh on window focus, and by the Refresh button', async () => {
    await openPanel();
    await screen.findByText('2 lessons completed, 1 lesson tested out.');
    const before = recordCalls;
    fireEvent(window, new Event('focus'));
    await waitFor(() => expect(recordCalls).toBe(before + 1));
    await waitFor(() => expect((screen.getByRole('button', { name: 'Refresh' }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(recordCalls).toBe(before + 2));
  });

  it('after Delete my data the official record and the Sensei panel are gone', async () => {
    try {
      const panel = await openPanel();
      await screen.findByText('2 lessons completed, 1 lesson tested out.');
      await screen.findByRole('heading', { name: 'What Sensei sees' });
      fireEvent.click(within(panel).getByRole('button', { name: 'Delete my data' }));
      const dialog = await screen.findByRole('alertdialog');
      fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
      await waitFor(() => expect(screen.queryByText('2 lessons completed, 1 lesson tested out.')).toBeNull());
      expect(screen.queryByRole('heading', { name: 'What Sensei sees' })).toBeNull();
      fireEvent(window, new Event('focus'));
      await screen.findByText('Nothing recorded yet.');
      expect(screen.queryByText(/couldn't read your official record/)).toBeNull();
      expect(screen.queryByText('2 lessons completed, 1 lesson tested out.')).toBeNull();
    } finally {
    }
  });

  it('a failed refresh does not keep the old record as current', async () => {
    await openPanel();
    await screen.findByText('2 lessons completed, 1 lesson tested out.');
    failing = true;
    fireEvent(window, new Event('focus'));
    await screen.findByText(/couldn't read your official record/);
    expect(screen.queryByText('2 lessons completed, 1 lesson tested out.')).toBeNull();
  });

  it('two concurrent reads (focus and Refresh) leave loading false and the newest data shown', async () => {
    await openPanel();
    await screen.findByText('2 lessons completed, 1 lesson tested out.');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Refresh' }).getAttribute('aria-disabled')).toBeNull());
    official.completed = [ids[0], ids[1], ids[3]];
    fireEvent(window, new Event('focus'));
    fireEvent(window, new Event('focus'));
    await screen.findByText('3 lessons completed, 1 lesson tested out.');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Refresh' }).getAttribute('aria-disabled')).toBeNull());
    official.completed = [ids[0], ids[1]];
  });

  it('a learner with no session sees "Nothing recorded yet." and no Download, LRS or Sensei', async () => {
    gone = true;
    const panel = await openPanel();
    await screen.findByText('Nothing recorded yet.');
    expect(screen.queryByText(/couldn't read your official record/)).toBeNull();
    expect(within(panel).queryByRole('button', { name: 'Download my record' })).toBeNull();
    expect(within(panel).queryByRole('button', { name: 'View in the LRS' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'What Sensei sees' })).toBeNull();
    expect(within(panel).getByRole('button', { name: 'Refresh' })).toBeTruthy();
  });

  it('Download my record saves the export only when the server answers OK', async () => {
    const saved: string[] = [];
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      saved.push(this.download);
    });
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} }));
    const panel = await openPanel();
    await screen.findByText('2 lessons completed, 1 lesson tested out.');
    fireEvent.click(within(panel).getByRole('button', { name: 'Download my record' }));
    await waitFor(() => expect(saved).toEqual(['learn-wp-reimagined-record.json']));
    exportStatus = 503;
    fireEvent.click(within(panel).getByRole('button', { name: 'Download my record' }));
    await screen.findByText("We couldn't download your record right now. Try again later.");
    expect(saved).toHaveLength(1);
    click.mockRestore();
  });

});
