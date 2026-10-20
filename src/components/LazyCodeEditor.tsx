import { useEffect, useState } from 'preact/hooks';
import type { CodeEditor as Editor } from './CodeEditor';

type Mod = typeof import('./CodeEditor');
type Props = Parameters<typeof Editor>[0];

let importer: () => Promise<Mod> = () => import('./CodeEditor');
let mod: Mod | null = null;
let loading: Promise<Mod> | null = null;

/** For tests: replace how the CodeMirror chunk is fetched, and forget any cached result. */
export function setEditorImporter(fn: (() => Promise<Mod>) | null): void {
  importer = fn ?? (() => import('./CodeEditor'));
  mod = null;
  loading = null;
}

/** Start fetching CodeMirror early, e.g. when a lesson with code opens. A failed fetch can be retried. */
export function preloadCodeEditor(): Promise<Mod> {
  loading ??= importer().then(
    (m) => (mod = m),
    (err) => {
      loading = null; // let the next attempt try again
      throw err;
    },
  );
  return loading;
}

type State = { kind: 'loading' } | { kind: 'ready'; m: Mod } | { kind: 'failed' };

/**
 * CodeMirror is most of the bundle, and only code checkpoints need it, so it loads on demand.
 * Until it arrives the code shows read-only. If it can't load (offline, a stale deploy),
 * a plain textarea takes over so the checkpoint can still be finished.
 */
export function CodeEditor(props: Props) {
  const [state, setState] = useState<State>(mod ? { kind: 'ready', m: mod } : { kind: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (state.kind === 'ready') return;
    let live = true;
    preloadCodeEditor().then(
      (m) => live && setState({ kind: 'ready', m }),
      () => live && setState({ kind: 'failed' }),
    );
    return () => {
      live = false;
    };
  }, [attempt]);

  if (state.kind === 'ready') return <state.m.CodeEditor {...props} />;

  const label = props.label ?? `Code editor for ${props.file}`;
  if (state.kind === 'failed') {
    return (
      <div class="code-editor code-editor--plain">
        <div class="code-editor__bar">
          <span class="code-editor__file">{props.file}</span>
          <button
            type="button"
            class="code-editor__retry"
            onClick={() => {
              setState({ kind: 'loading' });
              setAttempt((a) => a + 1);
            }}
          >
            Load the full editor
          </button>
        </div>
        <textarea
          class="code-editor__plain"
          aria-label={label}
          aria-describedby={props.describedBy}
          spellcheck={false}
          autocapitalize="off"
          autocomplete="off"
          rows={Math.min(18, Math.max(6, props.value.split('\n').length + 1))}
          value={props.value}
          onInput={(e) => props.onChange((e.currentTarget as HTMLTextAreaElement).value)}
        />
      </div>
    );
  }
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
