// @vitest-environment happy-dom
// @vitest-environment-options {"settings": {"enableIframePageLoading": true}}
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/preact';
import { LivePreview } from '../../src/studio/LivePreview';
import { PREVIEW_BOOT_TIMEOUT_MS, setPlaygroundImporter, startLivePreview } from '../../src/studio/previewClient';
import { playgroundBlueprint, playgroundUrl } from '../../src/finale/playground';

const files = { 'style.css': '/* t */', 'templates/index.html': '<p>hi</p>' };
const DIR = '/wordpress/wp-content/themes/my-block-theme';
const PV = { kind: 'theme', slug: 'my-block-theme' } as const;

function fake() {
  const calls: string[] = [];
  const client = {
    isReady: vi.fn(async () => {}),
    mkdir: vi.fn(async (p: string) => void calls.push(`mkdir ${p}`)),
    writeFile: vi.fn(async (p: string) => void calls.push(`write ${p}`)),
    goTo: vi.fn(async (p: string) => void calls.push(`goTo ${p}`)),
  };
  const startPlaygroundWeb = vi.fn(async () => client);
  setPlaygroundImporter(async () => ({ startPlaygroundWeb }) as never);
  return { client, startPlaygroundWeb, calls };
}

beforeEach(() => vi.useRealTimers());
afterEach(() => {
  cleanup();
  setPlaygroundImporter(null);
  vi.useRealTimers();
});

describe('live preview', () => {
  it('boots with the theme blueprint and login false', async () => {
    const { startPlaygroundWeb } = fake();
    const iframe = document.createElement('iframe');
    await startLivePreview(iframe, files, PV, '/');
    expect(startPlaygroundWeb).toHaveBeenCalledWith({
      iframe,
      remoteUrl: 'https://playground.wordpress.net/remote.html',
      blueprint: playgroundBlueprint(files, PV, { login: false }),
    });
    expect(playgroundBlueprint(files, PV, { login: false }).login).toBe(false);
    expect(playgroundBlueprint(files, PV).login).toBe(true);
  });

  it('write() mkdirs new folders, writes each file under the theme dir, then goTo("/")', async () => {
    const { calls } = fake();
    const p = await startLivePreview(document.createElement('iframe'), files, PV, '/');
    await p.write({ ...files, 'parts/header.html': 'h', 'parts/x/y.html': 'y' });
    expect(calls).toEqual([
      `mkdir ${DIR}/parts`,
      `mkdir ${DIR}/parts/x`,
      `write ${DIR}/style.css`,
      `write ${DIR}/templates/index.html`,
      `write ${DIR}/parts/header.html`,
      `write ${DIR}/parts/x/y.html`,
      'goTo /',
    ]);
  });

  it('importer rejects -> failed state with Open in Playground link', async () => {
    setPlaygroundImporter(async () => {
      throw new Error('offline');
    });
    render(<LivePreview files={files} preview={PV} landing="/" onReady={() => {}} />);
    expect(await screen.findByText(/Couldn't start WordPress here\./)).toBeTruthy();
    const link = screen.getByRole('link', { name: 'Open in Playground' }) as HTMLAnchorElement;
    expect(link.href).toBe(playgroundUrl(files, PV, { landing: '/', login: false }));
    expect(link.target).toBe('_blank');
  });

  it("the fallback link boots a plugin on the known main file and opens on the lesson's page", async () => {
    setPlaygroundImporter(async () => {
      throw new Error('offline');
    });
    const PLUGIN = { kind: 'plugin', slug: 'hello-learn' } as const;
    const MAIN = 'hello-learn/hello-learn.php';
    const GOOD = '<?php\n/* Plugin Name: Hello Learn */\n';
    const mine = { [MAIN]: '<?php fatal(' };
    render(<LivePreview files={mine} preview={PLUGIN} landing="/wp-admin/plugins.php" known={{ [MAIN]: GOOD }} onReady={() => {}} />);
    const link = (await screen.findByRole('link', { name: 'Open in Playground' })) as HTMLAnchorElement;
    const bp = JSON.parse(decodeURIComponent(link.href.slice(link.href.indexOf('#') + 1)));
    expect(bp).toEqual(playgroundBlueprint(mine, PLUGIN, { landing: '/wp-admin/plugins.php', known: { [MAIN]: GOOD }, login: false }));
    expect(bp.landingPage).toBe('/wp-admin/plugins.php');
    expect(bp.steps.find((s: { path?: string }) => s.path?.endsWith(MAIN)).data).toBe(GOOD);
  });

  it('the fallback link for a site logs in, as the live preview does', async () => {
    setPlaygroundImporter(async () => {
      throw new Error('offline');
    });
    const pages = { 'pages/home.html': '<p>hi</p>' };
    render(<LivePreview files={pages} preview={{ kind: 'site' }} landing="/wp-admin/" onReady={() => {}} />);
    const link = (await screen.findByRole('link', { name: 'Open in Playground' })) as HTMLAnchorElement;
    const bp = JSON.parse(decodeURIComponent(link.href.slice(link.href.indexOf('#') + 1)));
    expect(bp.login).toBe(true);
    expect(bp.landingPage).toBe('/wp-admin/');
  });

  it('shows booting then live and hands over the preview', async () => {
    fake();
    const onReady = vi.fn();
    render(<LivePreview files={files} preview={PV} landing="/" onReady={onReady} />);
    expect(screen.getByText('Starting WordPress Playground')).toBeTruthy();
    expect(await screen.findByText('Live: your theme in WordPress Playground')).toBeTruthy();
    expect(onReady).toHaveBeenCalledOnce();
  });

  it('boot exceeding PREVIEW_BOOT_TIMEOUT_MS -> failed state', async () => {
    vi.useFakeTimers();
    setPlaygroundImporter(async () => ({ startPlaygroundWeb: () => new Promise(() => {}) }) as never);
    render(<LivePreview files={files} preview={PV} landing="/" onReady={() => {}} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PREVIEW_BOOT_TIMEOUT_MS + 1);
    });
    expect(screen.getByText(/Couldn't start WordPress here\./)).toBeTruthy();
  });

  it('a boot that finishes after the timeout is promoted to live', async () => {
    vi.useFakeTimers();
    const { client } = fake();
    let finish!: () => void;
    client.isReady.mockImplementation(() => new Promise<void>((r) => (finish = r)));
    const onReady = vi.fn();
    const onFailed = vi.fn();
    render(<LivePreview files={files} preview={PV} landing="/" onReady={onReady} onFailed={onFailed} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PREVIEW_BOOT_TIMEOUT_MS + 1);
    });
    expect(screen.getByText(/Couldn't start WordPress here\./)).toBeTruthy();
    expect(onFailed).toHaveBeenCalledOnce();
    expect(onReady).not.toHaveBeenCalled();
    expect((document.querySelector('iframe') as HTMLIFrameElement).hidden).toBe(true);

    await act(async () => {
      finish();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByText('Live: your theme in WordPress Playground')).toBeTruthy();
    expect(onReady).toHaveBeenCalledOnce();
    expect((document.querySelector('iframe') as HTMLIFrameElement).hidden).toBe(false);
    const p = onReady.mock.calls[0][0];
    await p.write({ 'style.css': 'x' });
    expect(client.writeFile).toHaveBeenCalledWith(`${DIR}/style.css`, 'x');
  });

  it('a late boot after unmount does nothing', async () => {
    vi.useFakeTimers();
    const { client } = fake();
    let finish!: () => void;
    client.isReady.mockImplementation(() => new Promise<void>((r) => (finish = r)));
    const onReady = vi.fn();
    const { unmount } = render(<LivePreview files={files} preview={PV} landing="/" onReady={onReady} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PREVIEW_BOOT_TIMEOUT_MS + 1);
    });
    unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200); // let the unmount's effect cleanup run (it aborts the boot)
    });
    await act(async () => {
      finish();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(onReady).not.toHaveBeenCalled();
  });

  it('no unhandled rejection when the iframe unmounts mid-boot', async () => {
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    let fail!: (e: Error) => void;
    setPlaygroundImporter(async () => ({ startPlaygroundWeb: () => new Promise((_, r) => (fail = r)) }) as never);
    const { unmount } = render(<LivePreview files={files} preview={PV} landing="/" onReady={() => {}} />);
    await act(async () => {});
    unmount();
    fail(new Error('torn down'));
    await new Promise((r) => setTimeout(r, 20));
    process.off('unhandledRejection', unhandled);
    expect(unhandled).not.toHaveBeenCalled();
  });
});
