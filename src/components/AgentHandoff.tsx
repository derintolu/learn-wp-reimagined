import { useEffect, useState } from 'preact/hooks';
import { startHandoff } from '../agent/client';
import { flushPendingEdits } from '../record/useFileEdits';
import { getRecordManager } from '../record/useRecord';
import { CopyField } from './CopyField';
import './agent.css';

export const KEEP_PRIVATE = "Keep this handle private. It's the key to your progress in your AI.";
export const HANDOFF_FAILED = "Couldn't create a handle right now. You can still connect your AI from the Connect page.";

type Handoff = { handle: string; mcpUrl: string; prompt: string };

/**
 * One handoff per lesson per page load, held in memory only (never in storage), so reopening the
 * panel doesn't spend another record creation from the site-wide limit.
 */
const made = new Map<string, Handoff>();

/** For tests: forget handoffs made on this page. */
export function resetHandoffs(): void {
  made.clear();
}

type State = { kind: 'loading' } | { kind: 'ready'; handle: string; mcpUrl: string; prompt: string } | { kind: 'failed' };

/**
 * "Continue in your agent": makes a handle for an agent record placed at this lesson, with the
 * learner's files, and shows what to paste into the agent. The handle is shown once and never stored.
 */
export function AgentHandoff({ lessonId, lessonTitle }: { lessonId: string; lessonTitle: string }) {
  const [state, setState] = useState<State>(() => {
    const m = made.get(lessonId);
    return m ? { kind: 'ready', ...m } : { kind: 'loading' };
  });
  useEffect(() => {
    const cached = made.get(lessonId);
    if (cached) return setState({ kind: 'ready', ...cached });
    let live = true;
    flushPendingEdits();
    startHandoff(lessonId, getRecordManager().record.files).then((r) => {
      if (r.ok) made.set(lessonId, r.data);
      if (!live) return;
      setState(r.ok ? { kind: 'ready', ...r.data } : { kind: 'failed' });
    });
    return () => {
      live = false;
    };
  }, [lessonId]);

  return (
    <div class="agent-handoff" aria-busy={state.kind === 'loading'}>
      <p class="record__confirm-q">Continue “{lessonTitle}” in your AI</p>
      {state.kind === 'loading' && <p class="record__body">Making a handle for your AI…</p>}
      {state.kind === 'failed' && (
        <p class="record__alert" role="alert">
          {HANDOFF_FAILED}
        </p>
      )}
      {state.kind === 'ready' && (
        <>
          <ol class="agent-handoff__steps">
            <li>
              <CopyField label="Connector URL" value={state.mcpUrl} />
            </li>
            <li>
              <CopyField label="Your record handle" value={state.handle} />
              <p class="agent-handoff__note">{KEEP_PRIVATE}</p>
            </li>
            <li>
              <CopyField label="Message for your AI" value={state.prompt} multiline />
            </li>
          </ol>
        </>
      )}
      <p class="agent-handoff__link">
        <a href="/connect">Set up your AI</a>
      </p>
    </div>
  );
}
