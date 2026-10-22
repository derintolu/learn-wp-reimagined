import { pageNames, playgroundBlueprint, previewTarget, sitePagesPhp } from '../finale/playground';
import type { Preview } from '../shared/types';

type Mod = typeof import('@wp-playground/client');

export const PREVIEW_BOOT_TIMEOUT_MS = 45_000;
const REMOTE_URL = 'https://playground.wordpress.net/remote.html';

export interface LivePreview {
  write(files: Record<string, string>): Promise<void>;
}

let importer: () => Promise<Mod> = () => import('@wp-playground/client');

/** For tests: replace how the Playground client chunk is fetched. */
export function setPlaygroundImporter(fn: (() => Promise<Mod>) | null): void {
  importer = fn ?? (() => import('@wp-playground/client'));
}

function dirsOf(files: Record<string, string>): Set<string> {
  const dirs = new Set<string>();
  for (const p of Object.keys(files)) {
    const parts = p.split('/').slice(0, -1);
    for (let i = 1; i <= parts.length; i++) dirs.add(parts.slice(0, i).join('/'));
  }
  return dirs;
}

type Client = Awaited<ReturnType<Mod['startPlaygroundWeb']>>;

/**
 * A writer that pushes edited files under the preview's target, then reloads the lesson's page.
 * For the site kind it also re-runs the pages PHP, over every page file written so far.
 */
function writerFor(client: Client, files: Record<string, string>, preview: Preview, landing: string): LivePreview {
  const base = previewTarget(preview);
  const known = dirsOf(files);
  const pages = new Set(pageNames(files));
  return {
    async write(next) {
      for (const dir of [...dirsOf(next)].sort()) {
        if (known.has(dir)) continue;
        await client.mkdir(`${base}/${dir}`);
        known.add(dir);
      }
      for (const [p, data] of Object.entries(next)) await client.writeFile(`${base}/${p}`, data);
      if (preview.kind === 'site') {
        for (const n of pageNames(next)) pages.add(n);
        await client.run({ code: sitePagesPhp([...pages].sort()) });
      }
      await client.goTo(landing);
    },
  };
}

/**
 * Boot WordPress Playground in the iframe with the lesson's preview (theme, plugin or pages) at
 * `landing` (the site kind boots logged in, since its lessons land in wp-admin), then hand back a writer that pushes edited files in and reloads that page. A plugin
 * boots on `known`'s main file (the path's previewFiles), then gets the full workspace written.
 * Rejects if the client can't load, boot takes longer than PREVIEW_BOOT_TIMEOUT_MS, or the signal aborts. If it timed out but
 * the boot finishes later (and the signal hasn't aborted), `onLateReady` gets the writer.
 */
export async function startLivePreview(
  iframe: HTMLIFrameElement,
  files: Record<string, string>,
  preview: Preview,
  landing: string,
  signal?: AbortSignal,
  onLateReady?: (p: LivePreview) => void,
  known?: Record<string, string>,
): Promise<LivePreview> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  const guard = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      reject(new Error('Playground boot timed out'));
    }, PREVIEW_BOOT_TIMEOUT_MS);
    const abort = () => reject(new Error('Playground boot aborted'));
    if (signal?.aborted) abort();
    else signal?.addEventListener('abort', abort, { once: true });
  });
  guard.catch(() => {}); // the race below reports it; this one must never go unhandled

  const boot = (async () => {
    const { startPlaygroundWeb } = await importer();
    const client = await startPlaygroundWeb({
      iframe,
      remoteUrl: REMOTE_URL,
      blueprint: playgroundBlueprint(files, preview, { login: preview.kind === 'site', landing, known }) as never,
    });
    await client.isReady();
    const writer = writerFor(client, files, preview, landing);
    if (preview.kind === 'plugin') await writer.write(files);
    return writer;
  })();
  boot.then(
    (writer) => {
      if (timedOut && !signal?.aborted) onLateReady?.(writer);
    },
    () => {},
  );

  try {
    return await Promise.race([boot, guard]);
  } finally {
    clearTimeout(timer);
  }
}
