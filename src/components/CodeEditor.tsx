import { useEffect, useRef } from 'preact/hooks';
import { Annotation, EditorState, type Extension } from '@codemirror/state';
import { EditorView, highlightActiveLine, keymap, lineNumbers } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { bracketMatching, HighlightStyle, indentOnInput, syntaxHighlighting } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';
import { json } from '@codemirror/lang-json';
import { css } from '@codemirror/lang-css';
import { html } from '@codemirror/lang-html';
import { php } from '@codemirror/lang-php';

/** Marks a change that came in through the `value` prop, so it isn't echoed back through onChange. */
const external = Annotation.define<boolean>();

/** The language mode for a file, picked by its extension. */
export function languageFor(file: string): Extension {
  const ext = file.toLowerCase().split('.').pop();
  switch (ext) {
    case 'json':
      return json();
    case 'css':
      return css();
    case 'html':
    case 'htm':
      return html();
    case 'php':
      return php();
    default:
      return [];
  }
}

// Colours come from tokens.css so the editor follows the design system.
const highlight = HighlightStyle.define([
  { tag: [t.keyword, t.moduleKeyword, t.operatorKeyword], color: 'var(--code-keyword)' },
  { tag: [t.string, t.special(t.string)], color: 'var(--code-string)' },
  { tag: [t.number, t.bool, t.null, t.atom], color: 'var(--code-number)' },
  { tag: [t.propertyName, t.attributeName], color: 'var(--code-property)' },
  { tag: [t.tagName, t.className, t.typeName], color: 'var(--code-tag)' },
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], color: 'var(--code-comment)', fontStyle: 'italic' },
  { tag: [t.variableName, t.definition(t.variableName)], color: 'var(--code-variable)' },
  { tag: [t.processingInstruction, t.meta], color: 'var(--code-meta)' },
  { tag: t.invalid, color: 'var(--code-invalid)' },
]);

export function CodeEditor({
  file,
  value,
  onChange,
  label,
  describedBy,
  readOnly = false,
}: {
  file: string;
  value: string;
  onChange: (v: string) => void;
  label?: string;
  describedBy?: string;
  readOnly?: boolean;
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const change = useRef(onChange);
  change.current = onChange;

  useEffect(() => {
    if (!host.current) return;
    const v = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(),
          history(),
          indentOnInput(),
          bracketMatching(),
          highlightActiveLine(),
          syntaxHighlighting(highlight),
          keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
          languageFor(file),
          EditorView.lineWrapping,
          EditorState.readOnly.of(readOnly),
          EditorView.contentAttributes.of({
            'aria-label': label ?? `Code editor for ${file}`,
            ...(describedBy ? { 'aria-describedby': describedBy } : {}),
            ...(readOnly ? { 'aria-readonly': 'true' } : {}),
          }),
          EditorView.updateListener.of((u) => {
            if (u.docChanged && !u.transactions.some((tr) => tr.annotation(external))) change.current(u.state.doc.toString());
          }),
        ],
      }),
    });
    view.current = v;
    return () => {
      v.destroy();
      view.current = null;
    };
    // The editor owns its text after mount; a new file remounts via key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file, readOnly]);

  // Accept a replacement value from outside (e.g. a restored record) without fighting the learner's typing.
  // It isn't echoed to onChange: a stale value landing after newer typing would otherwise ping-pong forever.
  useEffect(() => {
    const v = view.current;
    if (v && v.state.doc.toString() !== value) {
      v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value }, annotations: external.of(true) });
    }
  }, [value]);

  return (
    <div class="code-editor">
      <div class="code-editor__bar">
        <span class="code-editor__file">{file}</span>
        <span class="code-editor__hint">Esc then Tab leaves the editor</span>
      </div>
      <div class="code-editor__host" ref={host} />
    </div>
  );
}
