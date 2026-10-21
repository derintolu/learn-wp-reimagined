import { useEffect, useRef, useState } from 'preact/hooks';
import { playgroundUrl } from '../finale/playground';
import { startLivePreview, type LivePreview as Preview } from './previewClient';

type Status = 'booting' | 'live' | 'failed';

export function LivePreview({
  files,
  onReady,
  onFailed,
}: {
  files: Record<string, string>;
  onReady: (p: Preview) => void;
  /** The boot failed or timed out. A late boot can still follow with onReady. */
  onFailed?: () => void;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const initial = useRef(files);
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
    startLivePreview(frame.current!, initial.current, ctl.signal, live).then(live, () => {
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
        {status === 'live' && 'Live: your theme in WordPress Playground'}
        {status === 'failed' && (
          <>
            Couldn't start WordPress here.{' '}
            <a href={playgroundUrl(files)} target="_blank" rel="noopener noreferrer">
              Open in Playground
            </a>
          </>
        )}
      </p>
      <iframe ref={frame} class="live-preview__frame" title="Live preview of your theme" hidden={status === 'failed'} />
    </div>
  );
}
