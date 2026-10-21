import { useEffect, useRef } from 'preact/hooks';
import { CodeEditor } from '../components/LazyCodeEditor';
import { LivePreview } from './LivePreview';
import { useStudioInternal } from './StudioContext';

const tabId = (name: string) => `ws-tab-${name.replace(/[^a-z0-9]+/gi, '-')}`;

/** The right-hand pane: file tabs, the editor, and the live WordPress preview. */
export function Workspace() {
  const s = useStudioInternal();
  const tablist = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const names = Object.keys(s.files);

  // focusEditor(): after the tab switch has rendered (the editor remounts per file, and the first
  // time CodeMirror may still be loading), focus it. Gives up after about two seconds.
  useEffect(() => {
    if (!s.focusTick) return;
    let tries = 0;
    let t: ReturnType<typeof setTimeout>;
    const attempt = () => {
      const el = panel.current?.querySelector<HTMLElement>('.cm-content, textarea');
      if (el) el.focus();
      else if (tries++ < 40) t = setTimeout(attempt, 50);
    };
    t = setTimeout(attempt);
    return () => clearTimeout(t);
  }, [s.focusTick]);

  if (!s.loaded) {
    return (
      <section class="workspace" aria-label="Workspace" aria-busy="true">
        <p class="ws-loading">Opening your files…</p>
      </section>
    );
  }

  const readOnly = !s.editable.includes(s.active);
  const describedBy = s.describedBy?.file === s.active ? s.describedBy.id : undefined;

  const onKey = (e: KeyboardEvent) => {
    const i = names.indexOf(s.active);
    const next =
      e.key === 'ArrowRight' ? (i + 1) % names.length
      : e.key === 'ArrowLeft' ? (i - 1 + names.length) % names.length
      : e.key === 'Home' ? 0
      : e.key === 'End' ? names.length - 1
      : -1;
    if (next < 0) return;
    e.preventDefault();
    s.openFile(names[next]);
    tablist.current?.querySelector<HTMLElement>(`#${tabId(names[next])}`)?.focus();
  };

  return (
    <section class="workspace" aria-label="Workspace">
      <div class="ws-head">
        <div class="ws-tabs" role="tablist" aria-label="Files" ref={tablist} onKeyDown={onKey}>
          {names.map((name) => {
            const selected = name === s.active;
            return (
              <button
                key={name}
                id={tabId(name)}
                type="button"
                role="tab"
                class="ws-tab"
                aria-selected={selected ? 'true' : 'false'}
                aria-controls="ws-panel"
                tabIndex={selected ? 0 : -1}
                onClick={() => s.openFile(name)}
              >
                {name}
                {s.dirty.includes(name) && (
                  <>
                    <span class="ws-dot" aria-hidden="true" />
                    <span class="visually-hidden"> (not applied)</span>
                  </>
                )}
              </button>
            );
          })}
        </div>
        <button type="button" class="ws-apply" title="Write these files into the live WordPress" onClick={() => void s.apply()}>
          Apply to site
        </button>
      </div>
      <div class="ws-editor" id="ws-panel" ref={panel} role="tabpanel" aria-labelledby={s.active ? tabId(s.active) : undefined}>
        {readOnly && (
          <p class="ws-provided">
            {s.completed ? (
              'Lesson complete. Read-only.'
            ) : (
              <>
                <span class="ws-badge">Provided</span> Read-only. This file comes with the lesson.
              </>
            )}
          </p>
        )}
        {s.active && (
          <CodeEditor
            key={`${s.active}:${describedBy ?? ''}`}
            file={s.active}
            value={s.files[s.active] ?? ''}
            readOnly={readOnly}
            describedBy={describedBy}
            onChange={(v) => s.setFile(s.active, v)}
          />
        )}
      </div>
      <LivePreview files={s.files} onReady={s.attachPreview} />
    </section>
  );
}
