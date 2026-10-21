import { THEME_DIR, playgroundBlueprint } from '../finale/playground';

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

/** A writer that pushes edited files into the theme and reloads the page. */
function writerFor(client: Client, files: Record<string, string>): LivePreview {
  const known = dirsOf(files);
  return {
    async write(next) {
      for (const dir of [...dirsOf(next)].sort()) {
        if (known.has(dir)) continue;
        await client.mkdir(`${THEME_DIR}/${dir}`);
        known.add(dir);
      }
      for (const [p, data] of Object.entries(next)) await client.writeFile(`${THEME_DIR}/${p}`, data);
      await client.goTo('/');
    },
  };
}

/**
 * Boot WordPress Playground in the iframe with the theme active, then hand back a writer
 * that pushes edited files in and reloads the page. Rejects if the client can't load,
 * boot takes longer than PREVIEW_BOOT_TIMEOUT_MS, or the signal aborts. If it timed out but
 * the boot finishes later (and the signal hasn't aborted), `onLateReady` gets the writer.
 */
export async function startLivePreview(
  iframe: HTMLIFrameElement,
  files: Record<string, string>,
  signal?: AbortSignal,
  onLateReady?: (p: LivePreview) => void,
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
      blueprint: playgroundBlueprint(files, { login: false }) as never,
    });
    await client.isReady();
    return client;
  })();
  boot.then(
    (client) => {
      if (timedOut && !signal?.aborted) onLateReady?.(writerFor(client, files));
    },
    () => {},
  );

  try {
    return writerFor(await Promise.race([boot, guard]), files);
  } finally {
    clearTimeout(timer);
  }
}
