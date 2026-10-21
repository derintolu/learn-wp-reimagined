import { useState } from 'preact/hooks';
import { deleteAgentRecord, fetchAgentRecord } from '../agent/client';
import { applyImport, classifyPaste, planImport, type ImportPlan } from '../agent/importRecord';
import { content } from '../content';
import { flushPendingEdits } from '../record/useFileEdits';
import { getRecordManager } from '../record/useRecord';
import './agent.css';

export const IMPORT_DONE = "Your agent's progress is on the site now.";
export const PRIVACY = 'The handle is the only key to your agent\'s copy. It holds no personal data and expires after 30 days without use.';

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

type Msg = { tone: 'ok' | 'error'; text: string };

/** "Bring back your agent's progress": paste a handle or the exported JSON, review, then merge. */
export function ImportAgentProgress({ idPrefix = 'import', onDone }: { idPrefix?: string; onDone?: () => void }) {
  const [text, setText] = useState('');
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [raw, setRaw] = useState<unknown>(undefined);
  const [handle, setHandle] = useState<string | null>(null);
  const [accepted, setAccepted] = useState<Set<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg | null>(null);
  const fieldId = `${idPrefix}-paste`;

  function reset() {
    setPlan(null);
    setAccepted(new Set());
    setConfirmDelete(false);
  }

  async function check(e: Event) {
    e.preventDefault();
    reset();
    setMsg(null);
    flushPendingEdits();
    const p = classifyPaste(text);
    if (p.kind === 'invalid') return setMsg({ tone: 'error', text: p.message });
    let raw: unknown;
    setHandle(null);
    if (p.kind === 'handle') {
      setBusy(true);
      const r = await fetchAgentRecord(p.handle);
      setBusy(false);
      if (!r.ok) return setMsg({ tone: 'error', text: r.message });
      raw = r.data.record;
      setHandle(p.handle);
    } else {
      raw = p.value;
      setHandle(null);
    }
    const planned = planImport(getRecordManager().record, raw, content);
    if (!planned.ok) return setMsg({ tone: 'error', text: `We couldn't read that record: ${planned.error}.` });
    setRaw(raw);
    setPlan(planned.plan);
  }

  async function bringBack() {
    if (!plan || raw === undefined) return;
    setBusy(true);
    try {
      // Keep the learner's latest typing, then plan again against the record as it is now: if
      // anything new now differs, show the conflicts again instead of overwriting it.
      flushPendingEdits();
      const m = getRecordManager();
      const fresh = planImport(m.record, raw, content);
      if (!fresh.ok) throw new Error(fresh.error);
      const keys = (p: ImportPlan) => p.conflicts.map((c) => c.key).sort().join('|');
      if (keys(fresh.plan) !== keys(plan)) {
        setPlan(fresh.plan);
        setMsg({ tone: 'error', text: 'Your progress changed while you were looking. Check the list again.' });
        return;
      }
      await m.restore(applyImport(m.record, fresh.plan, accepted, content));
      reset();
      setText('');
      setMsg({ tone: 'ok', text: IMPORT_DONE });
      onDone?.();
    } catch (err) {
      setMsg({ tone: 'error', text: `That didn't save: ${(err as Error)?.message ?? 'unknown error'}` });
    } finally {
      setBusy(false);
    }
  }

  async function deleteCopy() {
    if (!handle) return;
    setBusy(true);
    const r = await deleteAgentRecord(handle);
    setBusy(false);
    setConfirmDelete(false);
    if (!r.ok) return setMsg({ tone: 'error', text: r.message });
    setHandle(null);
    reset();
    setMsg({ tone: 'ok', text: r.data.deleted ? "The agent's copy is deleted." : 'There was no copy left to delete.' });
  }

  const toggle = (key: string) =>
    setAccepted((s) => {
      const n = new Set(s);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });

  const nothing = plan && plan.events.length === 0 && plan.conflicts.length === 0;

  return (
    <div class="agent-import">
      <form onSubmit={check}>
        <label class="agent-import__label" for={fieldId}>
          Record handle or exported JSON
        </label>
        <textarea
          id={fieldId}
          class="agent-import__field"
          rows={3}
          spellcheck={false}
          autocomplete="off"
          value={text}
          onInput={(e) => {
            // A new paste invalidates the last check, and the handle it was for.
            setText((e.currentTarget as HTMLTextAreaElement).value);
            reset();
            setHandle(null);
          }}
        />
        <p class="agent-import__privacy">{PRIVACY}</p>
        <div class="record__actions">
          <button type="submit" class="button button--quiet" disabled={busy || !text.trim()}>
            Check it
          </button>
        </div>
      </form>

      {plan && (
        <div class="agent-import__plan" role="group" aria-labelledby={`${idPrefix}-summary`}>
          <p id={`${idPrefix}-summary`} class="record__summary">
            {nothing
              ? 'Nothing new: the site already has everything in this record.'
              : `${plural(plan.summary.lessons, 'lesson')}, ${plural(plan.summary.checkpoints, 'checkpoint')}, ${plural(plan.summary.files, 'file')}`}
          </p>
          {plan.conflicts.length > 0 && (
            <fieldset class="agent-import__conflicts">
              <legend>These differ from the site. Tick the ones to replace.</legend>
              {plan.conflicts.map((c) => (
                <div class="agent-import__conflict" key={c.key}>
                  <input
                    id={`${idPrefix}-${c.key}`}
                    type="checkbox"
                    checked={accepted.has(c.key)}
                    onChange={() => toggle(c.key)}
                    aria-describedby={`${idPrefix}-${c.key}-vs`}
                  />
                  <div>
                    <label class="agent-import__what" for={`${idPrefix}-${c.key}`}>
                      Use the agent's version: {c.kind === 'file' ? c.key.slice(5) : c.kind === 'position' ? 'where you are' : 'placement'}
                    </label>
                    <div class="agent-import__vs" id={`${idPrefix}-${c.key}-vs`}>
                      <span>Site</span>
                      {c.kind === 'file' ? <pre>{c.site}</pre> : <span>{c.site}</span>}
                      <span>Agent</span>
                      {c.kind === 'file' ? <pre>{c.agent}</pre> : <span>{c.agent}</span>}
                    </div>
                  </div>
                </div>
              ))}
            </fieldset>
          )}
          {plan.ignored.length > 0 && (
            <details class="agent-import__ignored">
              <summary>Not brought over ({plan.ignored.length})</summary>
              <ul>
                {plan.ignored.map((i) => (
                  <li key={i}>{i}</li>
                ))}
              </ul>
            </details>
          )}
          <div class="record__actions">
            <button type="button" class="button" onClick={bringBack} disabled={busy || Boolean(nothing)}>
              Bring it back
            </button>
            <button type="button" class="button button--quiet" onClick={reset} disabled={busy}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {handle && (
        <div class="agent-import__delete">
          {confirmDelete ? (
            <div role="group" aria-labelledby={`${idPrefix}-del-q`}>
              <p id={`${idPrefix}-del-q`} class="record__confirm-q">
                Delete the agent's copy? Your agent can't continue from it afterwards. Progress on this site stays.
              </p>
              <div class="record__actions">
                <button type="button" class="button" onClick={deleteCopy} disabled={busy}>
                  Yes, delete it
                </button>
                <button type="button" class="button button--quiet" onClick={() => setConfirmDelete(false)} disabled={busy}>
                  Keep it
                </button>
              </div>
            </div>
          ) : (
            <button type="button" class="button button--quiet" onClick={() => setConfirmDelete(true)} disabled={busy}>
              Delete the agent's copy
            </button>
          )}
        </div>
      )}

      <div role="status" class="record__msg">
        {msg && <p class={`record__msg-text record__msg-text--${msg.tone}`}>{msg.text}</p>}
      </div>
    </div>
  );
}
