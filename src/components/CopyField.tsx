import { useState } from 'preact/hooks';

/** A value split before each path slash with <wbr>, so a long URL wraps at a "/" rather than mid-hostname. */
function breakable(value: string) {
  return value.split(/(?<=[^/:])(?=\/[^/])/).flatMap((part, i) => (i ? [<wbr key={i} />, part] : [part]));
}

/** A read-only value with a Copy button. */
export function CopyField({ label, value, multiline = false }: { label: string; value: string; multiline?: boolean }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setState('copied');
    } catch {
      setState('failed');
    }
  }
  return (
    <div class="copy-field">
      <span class="copy-field__label">{label}</span>
      <div class="copy-field__row">
        {multiline ? <pre class="copy-field__value">{value}</pre> : <code class="copy-field__value">{breakable(value)}</code>}
        <button type="button" class="button button--quiet copy-field__button" onClick={copy} aria-label={`Copy ${label}`}>
          {state === 'copied' ? 'Copied' : 'Copy'}
        </button>
      </div>
      <span class={state === 'failed' ? 'copy-field__error' : 'visually-hidden'} role="status">
        {state === 'copied' ? `${label} copied` : state === 'failed' ? "Couldn't copy. Select the text and copy it yourself." : ''}
      </span>
    </div>
  );
}
