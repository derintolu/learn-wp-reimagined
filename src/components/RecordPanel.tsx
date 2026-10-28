import { useEffect, useRef, useState } from 'preact/hooks';
import { useLocation } from 'preact-iso';
import { FEATURES } from '../config';
import { content } from '../content';
import { downloadRecord, readRecordFile } from '../record/fileTransfer';
import { supportsFolder } from '../record/folderStore';
import { deleteMyDataDetailed } from '../record/session';
import type { AttachResult } from '../record/store';
import { cancelPendingEdits, flushPendingEdits } from '../record/useFileEdits';
import { useRecord } from '../record/useRecord';
import type { LearningRecord } from '../shared/record';
import { revokeAllAgents } from '../agent/client';
import { AgentHandoff } from './AgentHandoff';
import { ImportAgentProgress } from './ImportAgentProgress';

/** Fired after a restore so an open lesson can pick up the restored place. */
export const RESTORED_EVENT = 'learn:record-restored';

export const NOT_SAVED = "Your progress isn't being saved. Download it to keep it.";

const ATTACH_COPY: Record<AttachResult, string> = {
  wrote: 'Saving to your folder from now on',
  resumed: 'Resumed from your folder',
  'kept-current-with-backup': "Kept this browser's newer progress and saved a backup in the folder",
  'recovered-corrupt': 'The record in that folder was damaged, so we set it aside and saved your progress there',
};

export const AGENTS_DISCONNECTED = 'Your agents are disconnected. They will ask you to sign in again.';
export const DISCONNECT_FAILED = "We couldn't disconnect your agents. Nothing was changed. Try again later.";

export const DELETE_FAILED = "We couldn't delete your data. Nothing was changed. Try again later.";

export const BROWSER_NOT_CLEARED =
  "Your data was deleted on this site, but this browser's copy couldn't be cleared. Close this tab's site data to finish.";

const titleOf = (id: string) => (Object.prototype.hasOwnProperty.call(content.lessons, id) ? content.lessons[id].title : id);

function summary(r: LearningRecord): string {
  const n = r.completedLessons.length;
  const done = `${n} ${n === 1 ? 'lesson' : 'lessons'} done`;
  return r.current ? `${done}, at “${titleOf(r.current.lessonId)}”` : done;
}

type Msg = { tone: 'ok' | 'error'; text: string; href?: string };

/** The lesson open on this page, if any. */
function lessonInPath(): string | null {
  const m = /^\/learn\/([^/]+)\/?$/.exec(location.pathname);
  if (!m) return null;
  try {
    const id = decodeURIComponent(m[1]);
    return Object.prototype.hasOwnProperty.call(content.lessons, id) ? id : null;
  } catch {
    return null;
  }
}

/** Asks before deleting. Escape and "Keep it" close it; Tab stays inside while it is open. */
function DeleteDialog({ onKeep, onDelete, busy, failed }: { onKeep: () => void; onDelete: () => void; busy: boolean; failed: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const keepRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    keepRef.current?.focus();
  }, []);
  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      if (!busy) onKeep();
      return;
    }
    if (e.key !== 'Tab') return;
    const items = Array.from(ref.current?.querySelectorAll<HTMLButtonElement>('button') ?? []);
    if (!items.length) {
      e.preventDefault();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || !ref.current?.contains(active))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (active === last || !ref.current?.contains(active))) {
      e.preventDefault();
      first.focus();
    }
  }
  return (
    <div class="record-confirm__scrim">
      <div
        class="record-confirm"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="record-delete-title"
        aria-describedby="record-delete-body"
        ref={ref}
        onKeyDown={onKeyDown}
      >
        <h2 id="record-delete-title" class="record-confirm__title">Delete my data?</h2>
        <p id="record-delete-body" class="record-confirm__body">
          This deletes your progress on this site and in this browser. It can't be undone.
        </p>
        <div role="status" class="record-confirm__msg">
          {failed && <p class="record__msg-text record__msg-text--error">{DELETE_FAILED}</p>}
        </div>
        <div class="record__actions">
          <button type="button" class="button button--quiet" ref={keepRef} onClick={() => !busy && onKeep()} aria-disabled={busy || undefined}>
            Keep it
          </button>
          <button type="button" class="button" onClick={() => !busy && onDelete()} aria-disabled={busy || undefined}>
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

/** The header menu for the learning record: where it's saved, and download, restore or save to a folder. */
export function RecordPanel() {
  const { manager, record, persistent, notice } = useRecord();
  const [open, setOpen] = useState(false);
  const [pendingRestore, setPendingRestore] = useState<LearningRecord | null>(null);
  const [msg, setMsg] = useState<Msg | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteFailed, setDeleteFailed] = useState(false);
  const confirmRef = useRef(false);
  const deleteBtnRef = useRef<HTMLButtonElement>(null);
  const [view, setView] = useState<'main' | 'handoff' | 'import'>('main');
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const folderOk = supportsFolder();
  const loc = useLocation() as ReturnType<typeof useLocation> | undefined;

  /** Take the learner to the restored place; an open lesson remounts on the event. */
  function goToRestored() {
    const cur = manager.record.current;
    if (cur && loc?.route && location.pathname.startsWith('/learn/')) loc.route(`/learn/${cur.lessonId}`);
    window.dispatchEvent(new CustomEvent(RESTORED_EVENT));
  }

  const folder = manager.savingToFolder;
  const state: 'folder' | 'browser' | 'none' = folder ? 'folder' : persistent ? 'browser' : 'none';
  const attention = Boolean(notice || manager.folderError);
  const handoffLesson = open ? (lessonInPath() ?? record.current?.lessonId ?? null) : null;
  const stateLabel = { folder: 'Saving to your folder', browser: 'Saved in this browser', none: 'Not saved' }[state];

  useEffect(() => {
    if (!open) setView('main');
  }, [open]);

  useEffect(() => {
    panelRef.current?.focus();
  }, [view]);

  useEffect(() => {
    if (!open) return;
    panelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (confirmRef.current) return; // the confirm dialog handles its own Escape
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    const onDown = (e: Event) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown);
    };
  }, [open]);

  function openDelete() {
    setDeleteFailed(false);
    confirmRef.current = true;
    setConfirmDelete(true);
  }

  function closeDelete() {
    confirmRef.current = false;
    setConfirmDelete(false);
    deleteBtnRef.current?.focus();
  }

  async function disconnectAgents() {
    setBusy(true);
    try {
      const r = await revokeAllAgents();
      setMsg(r.ok ? { tone: 'ok', text: AGENTS_DISCONNECTED } : { tone: 'error', text: DISCONNECT_FAILED });
    } finally {
      setBusy(false);
    }
  }

  async function confirmDeleteNow() {
    setBusy(true);
    setDeleteFailed(false);
    try {
      const result = await deleteMyDataDetailed();
      if (result === 'failed') {
        setDeleteFailed(true);
        return;
      }
      setMsg(result === 'deleted' ? { tone: 'ok', text: 'Your data is deleted.' } : { tone: 'error', text: BROWSER_NOT_CLEARED });
      closeDelete();
    } finally {
      setBusy(false);
    }
  }

  async function saveToFolder() {
    setMsg(null);
    let dir: FileSystemDirectoryHandle;
    try {
      dir = await (window as unknown as { showDirectoryPicker: (o?: object) => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker({
        mode: 'readwrite',
        id: 'learn-wp-record',
      });
    } catch {
      return; // the learner closed the picker
    }
    setBusy(true);
    try {
      flushPendingEdits();
      const result = await manager.attachFolder(dir);
      setMsg({ tone: 'ok', text: ATTACH_COPY[result] });
      if (result === 'resumed') goToRestored();
    } catch (err) {
      setMsg({ tone: 'error', text: `We couldn't use that folder: ${(err as Error)?.message ?? 'unknown error'}` });
    } finally {
      setBusy(false);
    }
  }

  async function onFile(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const f = input.files?.[0];
    input.value = '';
    if (!f) return;
    setMsg(null);
    const res = await readRecordFile(f);
    if (!res.ok) {
      setPendingRestore(null);
      setMsg({ tone: 'error', text: `${res.error}. Your current progress hasn't changed.` });
      return;
    }
    setPendingRestore(res.record);
  }

  async function confirmRestore() {
    const r = pendingRestore;
    if (!r) return;
    setBusy(true);
    try {
      // An edit still waiting on its debounce must not land on top of the restored files.
      cancelPendingEdits();
      await manager.restore(r);
      setPendingRestore(null);
      setMsg({
        tone: 'ok',
        text: r.current ? `Restored. You're back at “${titleOf(r.current.lessonId)}”.` : 'Restored.',
        href: r.current ? `/learn/${r.current.lessonId}` : undefined,
      });
      goToRestored();
    } catch (err) {
      setMsg({ tone: 'error', text: `The restore didn't save: ${(err as Error)?.message ?? 'unknown error'}` });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div class="record" ref={rootRef}>
      <button
        type="button"
        class={`record__button record__button--${state}${attention ? ' record__button--attention' : ''}`}
        ref={buttonRef}
        aria-expanded={open}
        aria-controls="record-panel"
        onClick={() => setOpen((o) => !o)}
      >
        <span class="record__dot" aria-hidden="true" />
        {state === 'none' || attention ? (
          <>
            <span class="visually-hidden">Your record: </span>
            <span>{state === 'none' ? 'Not saved' : 'Check your record'}</span>
          </>
        ) : (
          <>
            <span>Your record</span>
            <span class="visually-hidden">: {stateLabel}</span>
          </>
        )}
      </button>
      {open && (
        <div class="record__panel" id="record-panel" role="dialog" aria-label="Your record" tabIndex={-1} ref={panelRef}>
          <p class={`record__state record__state--${state}`}>
            <span class="record__dot" aria-hidden="true" />
            {stateLabel}
          </p>
          <p class="record__body">
            {state === 'none'
              ? NOT_SAVED
              : state === 'folder'
                ? 'Your record and lesson files are written to the folder you picked, and kept in this browser too.'
                : "Your progress stays on this device. Your answers and tutor messages go to the course server to be checked or answered, and aren't stored."}
          </p>
          <p class="record__summary">{summary(record)}</p>
          {notice && <p class="record__alert">{notice.message}</p>}
          {manager.folderError && (
            <p class="record__alert">
              We couldn't save to your folder ({manager.folderError.message}). Your progress is still kept in this browser.
            </p>
          )}

          {view !== 'main' ? (
            <div class="record__agent-view">
              <div class="record__back">
                <button type="button" class="button button--quiet" onClick={() => setView('main')}>
                  Back
                </button>
              </div>
              {view === 'handoff' && handoffLesson && <AgentHandoff lessonId={handoffLesson} lessonTitle={titleOf(handoffLesson)} />}
              {view === 'import' && (
                <>
                  <p class="record__confirm-q">Bring back your AI's progress</p>
                  <ImportAgentProgress idPrefix="record-import" onDone={goToRestored} />
                </>
              )}
            </div>
          ) : pendingRestore ? (
            <div class="record__confirm" role="group" aria-labelledby="restore-q">
              <p id="restore-q" class="record__confirm-q">
                Replace your progress with this file?
              </p>
              <dl class="record__compare">
                <div>
                  <dt>Now</dt>
                  <dd>{summary(record)}</dd>
                </div>
                <div>
                  <dt>File</dt>
                  <dd>{summary(pendingRestore)}</dd>
                </div>
              </dl>
              <div class="record__actions">
                <button type="button" class="button" onClick={confirmRestore} disabled={busy}>
                  Replace my progress
                </button>
                <button type="button" class="button button--quiet" onClick={() => setPendingRestore(null)} disabled={busy}>
                  Keep what I have
                </button>
              </div>
            </div>
          ) : (
            <div class="record__actions record__actions--stack">
              {folderOk && (
                <button type="button" class="button button--quiet" onClick={saveToFolder} disabled={busy}>
                  Save to a folder
                </button>
              )}
              <button type="button" class="button button--quiet" onClick={() => downloadRecord(manager.record)}>
                Download record
              </button>
              <button type="button" class="button button--quiet" onClick={() => fileRef.current?.click()} disabled={busy}>
                Restore record
              </button>
              {FEATURES.sessions && (
                <button type="button" class="button button--quiet" ref={deleteBtnRef} onClick={openDelete}>
                  Delete my data
                </button>
              )}
              {FEATURES.agent && (
                <div class="record__agent record__actions record__actions--stack">
                  <p class="record__agent-title">Your own AI</p>
                  {handoffLesson && (
                    <button type="button" class="button button--quiet" onClick={() => setView('handoff')}>
                      Continue in your AI
                    </button>
                  )}
                  {FEATURES.agentOnStandard ? (
                    <button type="button" class="button button--quiet" onClick={disconnectAgents} disabled={busy}>
                      Disconnect agents
                    </button>
                  ) : (
                    <button type="button" class="button button--quiet" onClick={() => setView('import')}>
                      Bring back your AI's progress
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            class="visually-hidden"
            tabIndex={-1}
            aria-hidden="true"
            onChange={onFile}
          />
          <div role="status" class="record__msg">
            {msg && (
              <p class={`record__msg-text record__msg-text--${msg.tone}`}>
                {msg.text}
                {msg.href && (
                  <>
                    {' '}
                    <a href={msg.href} onClick={() => setOpen(false)}>
                      Go there
                    </a>
                  </>
                )}
              </p>
            )}
          </div>
        </div>
      )}
      {confirmDelete && <DeleteDialog onKeep={closeDelete} onDelete={confirmDeleteNow} busy={busy} failed={deleteFailed} />}
    </div>
  );
}

let warningDismissed = false;

/**
 * A visible warning on the lesson page when progress isn't being kept (private window,
 * blocked storage) or the stored record needed attention. Dismissible for this visit.
 */
export function SaveWarning() {
  const { manager, persistent, notice } = useRecord();
  const [hidden, setHidden] = useState(warningDismissed);
  if (hidden || (persistent && !notice)) return null;
  return (
    <div class="save-warning" role="status">
      <p class="save-warning__text">{persistent ? notice!.message : NOT_SAVED}</p>
      <div class="save-warning__actions">
        <button type="button" class="button" onClick={() => downloadRecord(manager.record)}>
          Download record
        </button>
        <button
          type="button"
          class="save-warning__close"
          onClick={() => {
            warningDismissed = true;
            setHidden(true);
          }}
        >
          <span class="visually-hidden">Dismiss this warning</span>
          <span aria-hidden="true">×</span>
        </button>
      </div>
    </div>
  );
}

/** For tests: show the warning again. */
export function resetSaveWarning(): void {
  warningDismissed = false;
}
