import { useEffect, useState } from 'preact/hooks';
import type { CodeEditor as Editor } from './CodeEditor';

type Mod = typeof import('./CodeEditor');
type Props = Parameters<typeof Editor>[0];

let mod: Mod | null = null;
let loading: Promise<Mod> | null = null;

/** Start fetching CodeMirror early, e.g. when a lesson with code opens. */
export function preloadCodeEditor(): Promise<Mod> {
  loading ??= import('./CodeEditor').then((m) => (mod = m));
  return loading;
}

/**
 * CodeMirror is most of the bundle, and only code checkpoints need it, so it loads on demand.
 * Until it arrives the code shows read-only, in the same frame.
 */
export function CodeEditor(props: Props) {
  const [m, setM] = useState<Mod | null>(mod);
  useEffect(() => {
    if (m) return;
    let live = true;
    preloadCodeEditor().then((x) => live && setM(x));
    return () => {
      live = false;
    };
  }, []);
  if (m) return <m.CodeEditor {...props} />;
  return (
    <div class="code-editor" aria-busy="true">
      <div class="code-editor__bar">
        <span class="code-editor__file">{props.file}</span>
        <span class="code-editor__hint">Loading the editor…</span>
      </div>
      <pre class="code-editor__loading">{props.value}</pre>
    </div>
  );
}
