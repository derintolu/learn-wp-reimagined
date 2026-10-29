// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { content } from '../../src/content';
import { CarryOverOffer } from '../../src/components/CarryOverOffer';
import { resetSession } from '../../src/record/session';
import { setRecordManager } from '../../src/record/useRecord';
import { memoryManager } from './helpers';
const lessonId = Object.keys(content.lessons)[0];

/** What /api/record answers: the official record's lessons, or a status (401 = no session yet). */
let officialAnswer: { completed?: string[]; testedOut?: string[]; carriedOver?: string[] } | number;
function stubFetch(carryStatus = 200) {
  const f = vi.fn(async (url: string, init: RequestInit = {}) => {
    if (url === '/api/record') {
      if (typeof officialAnswer === 'number') return new Response('{}', { status: officialAnswer });
      return new Response(JSON.stringify({ completed: [], testedOut: [], carriedOver: [], branches: [], badges: [], asOf: 'x', ...officialAnswer }), { status: 200 });
    }
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
  officialAnswer = {};
  stubFetch();
  localStorage.clear();
  resetSession();
});
afterEach(() => {
  cleanup();
  setRecordManager(null);
  vi.unstubAllGlobals();
});

describe('CarryOverOffer', () => {
  it('offer hidden when the local record has no progress', async () => {
    await mount(false);
    expect(screen.queryByRole('button', { name: 'Bring your progress over' })).toBeNull();
  });

  it('sends the old record on request, then stops offering', async () => {
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
    const f = stubFetch();
    await mount(true);
    fireEvent.click(await screen.findByRole('button', { name: 'Not now' }));
    expect(screen.queryByRole('button', { name: 'Not now' })).toBeNull();
    expect(f.mock.calls.some((c) => c[0] === '/api/carry-over')).toBe(false);
  });

  it('no offer when the official record already has the local completions', async () => {
    officialAnswer = { completed: [lessonId] };
    const f = stubFetch();
    await mount(true);
    await waitFor(() => expect(f.mock.calls.some((c) => c[0] === '/api/record')).toBe(true));
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByRole('button', { name: 'Bring your progress over' })).toBeNull();
  });

  it('a tested-out or carried-over lesson also counts as already there', async () => {
    for (const answer of [{ testedOut: [lessonId] }, { carriedOver: [lessonId] }]) {
      officialAnswer = answer;
      stubFetch();
      await mount(true);
      await new Promise((r) => setTimeout(r, 0));
      expect(screen.queryByRole('button', { name: 'Bring your progress over' })).toBeNull();
      cleanup();
    }
  });

  it('offers for a completion the official record lacks, including with no session yet', async () => {
    officialAnswer = 401;
    stubFetch();
    await mount(true);
    expect(await screen.findByRole('button', { name: 'Bring your progress over' })).toBeTruthy();
  });

  it('no offer while the official record cannot be read', async () => {
    officialAnswer = 503;
    stubFetch();
    await mount(true);
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByRole('button', { name: 'Bring your progress over' })).toBeNull();
  });

  it('a failure keeps the offer and says nothing changed', async () => {
    stubFetch(503);
    await mount(true);
    fireEvent.click(await screen.findByRole('button', { name: 'Bring your progress over' }));
    await waitFor(() => expect(screen.getByText(/Nothing was changed/)).toBeTruthy());
    expect(screen.getByRole('button', { name: 'Bring your progress over' })).toBeTruthy();
  });
});
