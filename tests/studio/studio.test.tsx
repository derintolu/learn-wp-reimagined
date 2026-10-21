// @vitest-environment happy-dom
// @vitest-environment-options {"settings": {"enableIframePageLoading": true}}
// The lesson page as a three-pane studio: course bar, outline, feed and workspace.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

import { App } from '../../src/app';
import { getStatus, codeFeedback, tutorStream } from '../../src/ai/client';
import { content } from '../../src/content';
import { setRecordManager } from '../../src/record/useRecord';
import { setPlaygroundImporter } from '../../src/studio/previewClient';
import { resetSaveWarning } from '../../src/components/RecordPanel';
import { resetAiStatusForTests } from '../../src/ai/useAiStatus';
import { RecordManager, type RecordStore } from '../../src/record/store';
import { applyEvent, branchHistory, newRecord, type LearningRecord } from '../../src/shared/record';

const PLACED = { pathId: 'block-theme' as const, startLessonId: 'theme-json-basics', skip: [], reason: 'Picked.' };

let manager: RecordManager;
function use(r: LearningRecord | null) {
  let saved = r;
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

function open(url: string) {
  history.replaceState(null, '', url);
  return render(<App />);
}

function at(lessonId: string, beatIndex: number, extra: Partial<LearningRecord> = {}): LearningRecord {
  return { ...newRecord(), placement: PLACED, current: { pathId: 'block-theme', lessonId, beatIndex }, ...extra };
}

async function editor(name: RegExp): Promise<EditorView> {
  const el = await screen.findByRole('textbox', { name });
  const view = EditorView.findFromDOM(el.closest('.cm-editor') as HTMLElement);
  if (!view) throw new Error('no editor view');
  return view;
}
async function typeInto(name: RegExp, text: string) {
  const view = await editor(name);
  act(() => {
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
  });
}

/** matchMedia that answers `narrow` for the studio's 960px query and no to everything else. */
function stubMedia(narrow: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((q: string) => ({
      matches: q.includes('960') ? narrow : false,
      media: q,
      addEventListener: () => {},
      removeEventListener: () => {},
    })),
  );
}

const outline = () => screen.findByRole('navigation', { name: 'Course outline' });

beforeEach(() => {
  setPlaygroundImporter(() => Promise.reject(new Error('no Playground in tests')));
  vi.mocked(getStatus).mockResolvedValue({ ai: 'off' });
  vi.mocked(tutorStream).mockRejectedValue(new Error('off'));
  vi.mocked(codeFeedback).mockResolvedValue({ ok: false, fallback: true });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  setRecordManager(null);
  setPlaygroundImporter(null);
  resetSaveWarning();
  resetAiStatusForTests();
  vi.restoreAllMocks();
});

describe('Studio', () => {
  it('/learn/:id renders course bar, outline, feed and workspace; no site footer', async () => {
    use(at('templates-and-parts', 0, { completedLessons: ['theme-json-basics'] }));
    open('/learn/templates-and-parts');
    expect((await screen.findByRole('heading', { level: 1 })).textContent).toBe('Templates and template parts');

    const bar = document.querySelector('header.course-bar') as HTMLElement;
    expect(bar).toBeTruthy();
    expect(within(bar).getByRole('link', { name: /Learn WordPress, reimagined/ }).getAttribute('href')).toBe('/');
    expect(within(bar).getByText('unofficial concept')).toBeTruthy();
    expect(bar.textContent).toContain('Block theme developer · Lesson 2 of 3');
    const meter = within(bar).getByRole('progressbar');
    await waitFor(() => expect(meter.getAttribute('aria-valuenow')).toBe('1'));
    expect(meter.getAttribute('aria-valuemax')).toBe('3');
    expect(within(bar).getByRole('button', { name: /Your record/ })).toBeTruthy();

    expect(await outline()).toBeTruthy();
    const log = screen.getByRole('log');
    expect(log.getAttribute('aria-live')).toBe('polite');
    expect(screen.getByRole('region', { name: 'Workspace' })).toBeTruthy();
    expect(document.querySelector('footer')).toBeNull();
    expect(document.querySelector('.site-header')).toBeNull();
    // The skip link lands on the conversation.
    expect(screen.getByRole('link', { name: 'Skip to content' }).getAttribute('href')).toBe('#feed');
    expect(document.getElementById('feed')).toBe(log);
  });

  it('outline marks done/current/skipped lessons and the current lesson\'s sections', async () => {
    use(
      at('templates-and-parts', 1, {
        completedLessons: ['theme-json-basics'],
        placement: { ...PLACED, skip: ['patterns'] },
      }),
    );
    open('/learn/templates-and-parts');
    const nav = await outline();
    expect(within(nav).getByText('Course')).toBeTruthy();
    expect(nav.textContent).toContain('Block theme developer');
    expect(nav.textContent).toContain('3 lessons · about 30 min · adaptive');

    const row = (title: string) => within(nav).getByRole('link', { name: new RegExp(title) });
    await waitFor(() => expect(row('theme.json basics').closest('li')!.classList.contains('is-done')).toBe(true));
    expect(row('theme.json basics').getAttribute('href')).toBe('/learn/theme-json-basics');
    const current = row('Templates and template parts');
    expect(current.getAttribute('aria-current')).toBe('page');
    const skipped = row('Block patterns').closest('li')!;
    expect(skipped.classList.contains('is-skipped')).toBe(true);
    expect(skipped.textContent).toContain('Skipped');

    // Only the current lesson expands, to its beats then its checkpoint.
    const sections = within(current.closest('li')!).getByRole('list');
    const items = within(sections).getAllByRole('listitem');
    expect(items.map((li) => li.textContent)).toEqual([
      expect.stringContaining('Know where block templates live.'),
      expect.stringContaining('Reuse a header as a template part.'),
      expect.stringContaining('Checkpoint'),
    ]);
    expect(items[0].classList.contains('is-done')).toBe(true);
    expect(items[1].classList.contains('is-current')).toBe(true);
    expect(items[1].getAttribute('aria-current')).toBe('step');
    expect(items[2].classList.contains('is-upcoming')).toBe(true);
    expect(items[2].textContent).toContain('Branch');
    expect(row('theme.json basics').closest('li')!.querySelector('ul')).toBeNull();

    // Moving on updates the sections.
    fireEvent.click(await screen.findByRole('button', { name: /On to the checkpoint/ }));
    await screen.findByRole('region', { name: /Checkpoint/ });
    await waitFor(() => expect(items[1].classList.contains('is-done')).toBe(true));
    expect(items[2].classList.contains('is-current')).toBe(true);
  });

  it('a bug lesson lists "Catch the bug" with a Code tag', async () => {
    use(at('patterns', 0));
    open('/learn/patterns');
    const nav = await outline();
    const current = within(nav).getByRole('link', { name: /Block patterns/ }).closest('li')!;
    const items = within(within(current).getByRole('list')).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[1].textContent).toContain('Catch the bug');
    expect(items[1].textContent).toContain('Code');
  });

  it('Your path lists branches from the record', async () => {
    use(at('theme-json-basics', 0));
    open('/learn/theme-json-basics');
    let nav = await outline();
    expect(nav.textContent).toContain('Your path');
    expect(nav.textContent).toContain('Branches you take appear here.');
    cleanup();

    let r = at('theme-json-basics', 0);
    r = applyEvent(r, { type: 'checkpointAnswered', lessonId: 'theme-json-basics', response: 'x', outcome: 'review', to: 'theme-json-basics' }, content);
    r = applyEvent(r, { type: 'checkpointAnswered', lessonId: 'theme-json-basics', response: 'y', outcome: 'skip', to: 'templates-and-parts' }, content);
    expect(branchHistory(r)).toEqual([
      { from: 'theme-json-basics', to: 'theme-json-basics', outcome: 'review' },
      { from: 'theme-json-basics', to: 'templates-and-parts', outcome: 'skip' },
    ]);
    use(r);
    open('/learn/templates-and-parts');
    nav = await outline();
    const history = within(nav).getByRole('list', { name: 'Your path' });
    await waitFor(() =>
      expect(within(history).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
        'Lesson 1 → review: theme.json basics',
        'Lesson 1 → skip: Templates and template parts',
      ]),
    );
    expect(nav.textContent).not.toContain('Branches you take appear here.');
  });

  it('navigating to the next lesson swaps workspace files and tags new edits with the new lesson id; old edits keep theirs', async () => {
    use(at('templates-and-parts', 0, { completedLessons: ['theme-json-basics'] }));
    open('/learn/templates-and-parts');
    const passing = '{ "version": 3, "settings": { "color": { "palette": [ { "slug": "brand", "color": "#3858E9", "name": "Brand" } ] } } }';
    await typeInto(/theme\.json/, passing);
    await waitFor(
      () => expect(dispatched()).toContainEqual({ type: 'fileEdited', file: 'theme.json', content: passing, lessonId: 'templates-and-parts' }),
      { timeout: 2000 },
    );

    fireEvent.click(within(await outline()).getByRole('link', { name: /Block patterns/ }));
    await waitFor(() => expect(location.pathname).toBe('/learn/patterns'));
    expect(await screen.findByRole('heading', { level: 1, name: 'Block patterns' })).toBeTruthy();
    // The new lesson's files, no stale tabs: theme.json carries forward read-only, the pattern is editable.
    const tabs = await screen.findByRole('tablist', { name: 'Files' });
    await waitFor(() => expect(within(tabs).getByRole('tab', { name: /patterns\/hero\.php/ })).toBeTruthy());
    expect(within(tabs).getAllByRole('tab').map((t) => t.textContent)).toEqual(['style.css', 'templates/index.html', 'theme.json', 'patterns/hero.php']);
    expect(screen.getByRole('tab', { name: /patterns\/hero\.php/ }).getAttribute('aria-selected')).toBe('true');

    await typeInto(/hero\.php/, '<?php /* Slug: mytheme/hero */ ?>');
    await waitFor(
      () =>
        expect(dispatched()).toContainEqual({
          type: 'fileEdited',
          file: 'patterns/hero.php',
          content: '<?php /* Slug: mytheme/hero */ ?>',
          lessonId: 'patterns',
        }),
      { timeout: 2000 },
    );
    expect(manager.record.fileLessons).toEqual({ 'theme.json': 'templates-and-parts', 'patterns/hero.php': 'patterns' });
    expect(manager.record.files['theme.json']).toBe(passing);
  });

  it('pane switch shows one pane at a time below 960px', async () => {
    stubMedia(true);
    use(at('templates-and-parts', 0));
    open('/learn/templates-and-parts');
    const switcher = await screen.findByRole('group', { name: 'Show pane' });
    const btn = (name: string) => within(switcher).getByRole('button', { name });
    const pane = (name: string) => document.querySelector(`[data-pane-id="${name}"]`) as HTMLElement;
    await screen.findByRole('log');
    expect(btn('Lesson').getAttribute('aria-pressed')).toBe('true');
    expect(btn('Outline').getAttribute('aria-pressed')).toBe('false');
    expect(pane('lesson').hidden).toBe(false);
    expect(pane('outline').hidden).toBe(true);
    expect(pane('workspace').hidden).toBe(true);

    fireEvent.click(btn('Outline'));
    expect(btn('Outline').getAttribute('aria-pressed')).toBe('true');
    expect(pane('outline').hidden).toBe(false);
    expect(pane('lesson').hidden).toBe(true);

    fireEvent.click(btn('Workspace'));
    expect(pane('workspace').hidden).toBe(false);
    expect(pane('outline').hidden).toBe(true);
  });

  it('wide screens show every pane and no pane switch', async () => {
    stubMedia(false);
    use(at('templates-and-parts', 0));
    open('/learn/templates-and-parts');
    await screen.findByRole('log');
    expect(screen.queryByRole('group', { name: 'Show pane' })).toBeNull();
    for (const p of ['outline', 'lesson', 'workspace']) expect((document.querySelector(`[data-pane-id="${p}"]`) as HTMLElement).hidden).toBe(false);
  });

  it('completed lesson opens read-only with CompletedSummary', async () => {
    let r = at('theme-json-basics', 1);
    r = applyEvent(r, { type: 'checkpointAnswered', lessonId: 'theme-json-basics', response: 'x', outcome: 'skip', to: 'templates-and-parts' }, content);
    r = applyEvent(r, { type: 'lessonCompleted', lessonId: 'theme-json-basics' }, content);
    use(r);
    open('/learn/theme-json-basics');
    const summary = await screen.findByTestId('completed-summary');
    const log = screen.getByRole('log');
    expect(log.contains(summary)).toBe(true);
    // Every section shows, nothing to send, no Continue, no checkpoint.
    expect(log.querySelectorAll('.section-card')).toHaveLength(2);
    expect(screen.queryByRole('textbox', { name: 'Message the tutor' })).toBeNull();
    expect(screen.queryByRole('button', { name: /checkpoint/i })).toBeNull();
    expect(screen.queryByRole('region', { name: /Checkpoint/ })).toBeNull();
    // The outline marks the whole lesson done.
    const nav = await outline();
    const items = within(within(nav).getByRole('link', { name: /theme\.json basics/ }).closest('li')!.querySelector('ul')!).getAllByRole('listitem');
    expect(items.every((li) => li.classList.contains('is-done'))).toBe(true);
    await new Promise((res) => setTimeout(res, 30));
    expect(dispatched()).toEqual([]);
  });

  it('post-beat cards only appear once the beats are done', async () => {
    use(at('templates-and-parts', 0));
    open('/learn/templates-and-parts');
    await screen.findByRole('log');
    await screen.findByRole('button', { name: /^Next/ });
    expect(screen.queryByRole('region', { name: /Checkpoint/ })).toBeNull();
    expect(screen.queryByTestId('completed-summary')).toBeNull();
  });

  it('the code checkpoint editor is described by its question', async () => {
    use(at('templates-and-parts', 1));
    open('/learn/templates-and-parts');
    const ed = await screen.findByRole('textbox', { name: /theme\.json/ });
    expect(ed.getAttribute('aria-describedby')).toBeNull();
    fireEvent.click(await screen.findByRole('button', { name: /checkpoint/i }));
    await screen.findByRole('region', { name: /Checkpoint/ });
    await waitFor(() => expect(screen.getByRole('textbox', { name: /theme\.json/ }).getAttribute('aria-describedby')).toBe('cp-q-templates-and-parts'));
    expect(document.getElementById('cp-q-templates-and-parts')).toBeTruthy();
    // Another tab is not described by it.
    fireEvent.click(screen.getByRole('tab', { name: /style\.css/ }));
    await waitFor(() => expect(screen.getByRole('textbox', { name: /style\.css/ }).getAttribute('aria-describedby')).toBeNull());
  });
});

describe('Smooth scrolling', () => {
  it('jumps instead of gliding when the learner prefers reduced motion', async () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn((q: string) => ({ matches: q.includes('reduce'), media: q, addEventListener: () => {}, removeEventListener: () => {} })),
    );
    const scroll = vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(() => {});
    use(at('theme-json-basics', 0));
    open('/learn/theme-json-basics');
    fireEvent.click(await screen.findByRole('button', { name: /^Next/ }));
    await screen.findByRole('heading', { name: 'Add a colour palette.' });
    await waitFor(() => expect(scroll).toHaveBeenCalled());
    for (const call of scroll.mock.calls) expect(call[0]).toMatchObject({ behavior: 'auto' });
    fireEvent.click(screen.getByRole('button', { name: /checkpoint/i }));
    await screen.findByRole('region', { name: /Checkpoint/ });
    await waitFor(() => expect(scroll.mock.calls.length).toBeGreaterThan(1));
    for (const call of scroll.mock.calls) expect(call[0]).toMatchObject({ behavior: 'auto' });
  });
});
