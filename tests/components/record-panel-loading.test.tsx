// @vitest-environment happy-dom
// Its own file: the official record is module state, and this needs it fresh.
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/preact';
import { LocationProvider } from 'preact-iso';
import { content } from '../../src/content';
import { RecordPanel } from '../../src/components/RecordPanel';
import { setRecordManager } from '../../src/record/useRecord';
import { memoryManager } from './helpers';

afterEach(() => {
  cleanup();
  setRecordManager(null);
  vi.unstubAllGlobals();
});

it('while the official record loads, the panel shows no download or view buttons that may vanish', async () => {
  setRecordManager(memoryManager(content));
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));
  render(
    <LocationProvider>
      <RecordPanel />
    </LocationProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: /Your record/ }));
  const panel = await screen.findByRole('dialog', { name: /Your record/ });
  expect(await screen.findByText('Reading your official record...')).toBeTruthy();
  expect(within(panel).queryByRole('button', { name: 'Download my record' })).toBeNull();
  expect(within(panel).queryByRole('button', { name: 'View in the LRS' })).toBeNull();
});
