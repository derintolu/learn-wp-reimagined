// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { LocationProvider } from 'preact-iso';
import { FEATURES } from '../../src/config';
import { content } from '../../src/content';
import { BadgeClaim } from '../../src/pages/BadgeClaim';
import { RecordPanel } from '../../src/components/RecordPanel';
import { CompletedSummary } from '../../src/components/CompletedSummary';
import { setRecordManager } from '../../src/record/useRecord';
import { memoryManager } from './helpers';

const flags = FEATURES as { badges: boolean };
const ID = '33333333-3333-4333-8333-333333333333';
const lesson = Object.values(content.lessons)[0];
const badge = (over: object = {}) => ({ id: ID, pathId: lesson.pathId, name: 'Block themes', status: 'pending', testedOut: 3, ...over });

let list: unknown;
let mintUrl: string;
let mintOk: boolean;
let fetchMock: ReturnType<typeof vi.fn>;
let assign: ReturnType<typeof vi.fn>;

beforeEach(() => {
  flags.badges = true;
  list = [badge()];
  mintUrl = 'https://lrs.sqwrlz.com/claim/abc';
  mintOk = true;
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/badges') return new Response(JSON.stringify(list), { status: 200 });
    if (url === '/api/badges/claim-link' && init?.method === 'POST') {
      return mintOk ? new Response(JSON.stringify({ url: mintUrl }), { status: 200 }) : new Response('{}', { status: 503 });
    }
    return new Response(JSON.stringify({ actor: null }), { status: 200 });
  });
  vi.stubGlobal('fetch', fetchMock);
  assign = vi.spyOn(window.location, 'assign').mockImplementation(() => {}) as unknown as ReturnType<typeof vi.fn>;
  history.replaceState(null, '', `/badges/claim?badge=${ID}`);
});
afterEach(() => {
  cleanup();
  flags.badges = false;
  setRecordManager(null);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  history.replaceState(null, '', '/');
});

describe('badge claim page', () => {
  it('explains the badge against the certificate', async () => {
    render(<BadgeClaim />);
    await screen.findByRole('heading', { level: 1, name: 'Claim the Block themes badge' });
    expect(screen.getByText(/certificate is a document/)).toBeTruthy();
    expect(screen.getByText(/verifiable credential/)).toBeTruthy();
  });

  it('claim page navigates to the minted URL', async () => {
    render(<BadgeClaim />);
    fireEvent.click(await screen.findByRole('button', { name: 'Claim on the LRS' }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith('https://lrs.sqwrlz.com/claim/abc'));
    const post = fetchMock.mock.calls.find((c) => c[1]?.method === 'POST')!;
    expect(JSON.parse(post[1].body)).toEqual({ badge: ID });
    expect(document.body.textContent).not.toContain('claim/abc');
  });

  it('does not navigate to a link off the LRS origin', async () => {
    mintUrl = 'https://evil.example/claim/abc';
    render(<BadgeClaim />);
    fireEvent.click(await screen.findByRole('button', { name: 'Claim on the LRS' }));
    await screen.findByRole('alert');
    expect(assign).not.toHaveBeenCalled();
  });

  it('says so when no link could be made', async () => {
    mintOk = false;
    render(<BadgeClaim />);
    fireEvent.click(await screen.findByRole('button', { name: 'Claim on the LRS' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/could not make a claim link/);
    expect(assign).not.toHaveBeenCalled();
  });

  it('offers no button for a claimed badge or an unknown one', async () => {
    list = [badge({ status: 'claimed' })];
    render(<BadgeClaim />);
    await screen.findByText(/already claimed/);
    expect(screen.queryByRole('button', { name: 'Claim on the LRS' })).toBeNull();
    cleanup();
    history.replaceState(null, '', '/badges/claim?badge=zzz');
    render(<BadgeClaim />);
    await screen.findByText(/couldn't find that badge/);
  });

  it('is NotFound with the flag off and asks for nothing', () => {
    flags.badges = false;
    render(<BadgeClaim />);
    expect(screen.getByText(/That page doesn't exist/)).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('badges in the record menu and on a completed lesson', () => {
  async function openPanel() {
    setRecordManager(memoryManager(content));
    render(
      <LocationProvider>
        <RecordPanel />
      </LocationProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: /Your record/ }));
    return screen.findByRole('dialog', { name: /Your record/ });
  }

  it('badges list shows the tested-out count in words', async () => {
    const panel = await openPanel();
    const item = await within(panel).findByText(/Block themes: ready to claim/);
    expect(item.textContent).toContain('You tested out of three lessons.');
    expect(within(panel).getByRole('link', { name: 'Claim it' }).getAttribute('href')).toBe(`/badges/claim?badge=${ID}`);
  });

  it('says one lesson in the singular', async () => {
    list = [badge({ testedOut: 1, status: 'claimed' })];
    const panel = await openPanel();
    expect((await within(panel).findByText(/Block themes: claimed/)).textContent).toContain('tested out of one lesson.');
    expect(within(panel).queryByRole('link', { name: 'Claim it' })).toBeNull();
  });

  it('lists nothing and fetches nothing with the flag off', async () => {
    flags.badges = false;
    const panel = await openPanel();
    expect(within(panel).queryByText('Your badges')).toBeNull();
    expect(fetchMock.mock.calls.some((c) => c[0] === '/api/badges')).toBe(false);
  });

  it('a completed lesson links to the claim page for its path', async () => {
    const m = memoryManager(content);
    render(<CompletedSummary lesson={lesson} record={m.record} />);
    const link = await screen.findByRole('link', { name: 'Claim it' });
    expect(link.getAttribute('href')).toBe(`/badges/claim?badge=${ID}`);
  });

  it('a completed lesson shows no claim link with the flag off', () => {
    flags.badges = false;
    const m = memoryManager(content);
    render(<CompletedSummary lesson={lesson} record={m.record} />);
    expect(screen.queryByRole('link', { name: 'Claim it' })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
