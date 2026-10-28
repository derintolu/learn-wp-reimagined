// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { FEATURES } from '../../src/config';
import { content } from '../../src/content';
import { CarryOverOffer } from '../../src/components/CarryOverOffer';
import { resetSession } from '../../src/record/session';
import { setRecordManager } from '../../src/record/useRecord';
import { memoryManager } from './helpers';

const flags = FEATURES as { sessions: boolean; officialRecord: boolean };
const lessonId = Object.keys(content.lessons)[0];

function stubFetch(carryStatus = 200) {
  const f = vi.fn(async (url: string, init: RequestInit = {}) => {
    if (url === '/api/session') return new Response(JSON.stringify({ actor: { homePage: 'https://x', name: 'a1' } }), { status: 200 });
    if (url === '/api/carry-over') return new Response(JSON.stringify({ waived: [lessonId] }), { status: carryStatus });
    return new Response('{}', { status: 404 });
  });
  vi.stubGlobal('fetch', f);
  return f;
}

async function mount(withProgress: boolean) {
  const m = memoryManager(content);
  setRecordManager(m);
  if (withProgress) {
    await m.dispatch({ type: 'lessonCompleted', lessonId });
    await m.settled();
  }
  return render(<CarryOverOffer />);
}

beforeEach(() => {
  flags.officialRecord = true;
  flags.sessions = false;
  localStorage.clear();
  resetSession();
});
afterEach(() => {
  cleanup();
  flags.officialRecord = false;
  flags.sessions = false;
  setRecordManager(null);
  vi.unstubAllGlobals();
});

describe('CarryOverOffer', () => {
  it('offer hidden when the local record has no progress', async () => {
    await mount(false);
    expect(screen.queryByRole('button', { name: 'Bring your progress over' })).toBeNull();
  });

  it('offer hidden with the flag off', async () => {
    flags.officialRecord = false;
    await mount(true);
    expect(screen.queryByRole('button', { name: 'Bring your progress over' })).toBeNull();
  });

  it('sends the old record on request, then stops offering', async () => {
    flags.sessions = true;
    const f = stubFetch();
    await mount(true);
    fireEvent.click(await screen.findByRole('button', { name: 'Bring your progress over' }));
    expect(await screen.findByText(/in the official record now/)).toBeTruthy();
    const call = f.mock.calls.find((c) => c[0] === '/api/carry-over')!;
    const sent = JSON.parse(String((call[1] as RequestInit).body));
    expect(sent.completedLessons).toEqual([lessonId]);
    expect(sent.statements).toBeUndefined();
    cleanup();
    await mount(true);
    expect(screen.queryByRole('button', { name: 'Bring your progress over' })).toBeNull();
  });

  it('Not now hides it without sending anything', async () => {
    flags.sessions = true;
    const f = stubFetch();
    await mount(true);
    fireEvent.click(await screen.findByRole('button', { name: 'Not now' }));
    expect(screen.queryByRole('button', { name: 'Not now' })).toBeNull();
    expect(f.mock.calls.some((c) => c[0] === '/api/carry-over')).toBe(false);
  });

  it('a failure keeps the offer and says nothing changed', async () => {
    flags.sessions = true;
    stubFetch(503);
    await mount(true);
    fireEvent.click(await screen.findByRole('button', { name: 'Bring your progress over' }));
    await waitFor(() => expect(screen.getByText(/Nothing was changed/)).toBeTruthy());
    expect(screen.getByRole('button', { name: 'Bring your progress over' })).toBeTruthy();
  });
});
