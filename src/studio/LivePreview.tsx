import { useEffect, useRef, useState } from 'preact/hooks';
import { playgroundUrl } from '../finale/playground';
import type { Preview as PreviewKind } from '../shared/types';
import { startLivePreview, type LivePreview as Preview } from './previewClient';

type Status = 'booting' | 'live' | 'failed';

const WHAT: Record<PreviewKind['kind'], string> = { theme: 'your theme', plugin: 'your plugin', site: 'your site' };

export function LivePreview({
  files,
  preview,
  landing,
  known,
  onReady,
  onFailed,
}: {
  files: Record<string, string>;
  /** What the lesson's path previews. */
  preview: PreviewKind;
  /** The page to open, and to reload after each write. */
  landing: string;
  /** The path's read-only previewFiles: a plugin boots on its main file from here. */
  known?: Record<string, string>;
  onReady: (p: Preview) => void;
  /** The boot failed or timed out. A late boot can still follow with onReady. */
  onFailed?: () => void;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const initial = useRef({ files, preview, landing, known });
  const ready = useRef(onReady);
  ready.current = onReady;
  const failed = useRef(onFailed);
  failed.current = onFailed;
  const [status, setStatus] = useState<Status>('booting');

  useEffect(() => {
    const ctl = new AbortController();
    const live = (p: Preview) => {
      if (ctl.signal.aborted) return;
      setStatus('live');
      ready.current(p);
    };
    // A boot that beats the timeout, or one that finishes after it while still mounted.
    const i = initial.current;
    startLivePreview(frame.current!, i.files, i.preview, i.landing, ctl.signal, live, i.known).then(live, () => {
      if (ctl.signal.aborted) return;
      setStatus('failed');
      failed.current?.();
    });
    return () => ctl.abort();
  }, []);

  return (
    <div class="live-preview" data-status={status}>
      <p class="live-preview__status" role="status">
        {status === 'booting' && 'Starting WordPress Playground'}
        {status === 'live' && `Live: ${WHAT[preview.kind]} in WordPress Playground`}
        {status === 'failed' && (
          <>
            Couldn't start WordPress here.{' '}
            <a href={playgroundUrl(files, preview)} target="_blank" rel="noopener noreferrer">
              Open in Playground
            </a>
          </>
        )}
      </p>
      <iframe ref={frame} class="live-preview__frame" title={`Live preview of ${WHAT[preview.kind]}`} hidden={status === 'failed'} />
    </div>
  );
}
