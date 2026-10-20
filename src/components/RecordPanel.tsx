import { useEffect, useRef, useState } from 'preact/hooks';
import { useLocation } from 'preact-iso';
import { content } from '../content';
import { downloadRecord, readRecordFile } from '../record/fileTransfer';
import { supportsFolder } from '../record/folderStore';
import type { AttachResult } from '../record/store';
import { cancelPendingEdits, flushPendingEdits } from '../record/useFileEdits';
import { useRecord } from '../record/useRecord';
import type { LearningRecord } from '../shared/record';

/** Fired after a restore so an open lesson can pick up the restored place. */
export const RESTORED_EVENT = 'learn:record-restored';

export const NOT_SAVED = "Your progress isn't being saved. Download it to keep it.";

const ATTACH_COPY: Record<AttachResult, string> = {
  wrote: 'Saving to your folder from now on',
  resumed: 'Resumed from your folder',
  'kept-current-with-backup': "Kept this browser's newer progress and saved a backup in the folder",
  'recovered-corrupt': 'The record in that folder was damaged, so we set it aside and saved your progress there',
};

const titleOf = (id: string) => (Object.prototype.hasOwnProperty.call(content.lessons, id) ? content.lessons[id].title : id);

function summary(r: LearningRecord): string {
  const n = r.completedLessons.length;
  const done = `${n} ${n === 1 ? 'lesson' : 'lessons'} done`;
  return r.current ? `${done}, at “${titleOf(r.current.lessonId)}”` : done;
}

type Msg = { tone: 'ok' | 'error'; text: string; href?: string };

/** The header menu for the learning record: where it's saved, and download, restore or save to a folder. */
export function RecordPanel() {
  const { manager, record, persistent, notice } = useRecord();
  const [open, setOpen] = useState(false);
  const [pendingRestore, setPendingRestore] = useState<LearningRecord | null>(null);
  const [msg, setMsg] = useState<Msg | null>(null);
  const [busy, setBusy] = useState(false);
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
  const stateLabel = { folder: 'Saving to your folder', browser: 'Saved in this browser', none: 'Not saved' }[state];

  useEffect(() => {
    if (!open) return;
    panelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
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
                ? 'Your record and theme files are written to the folder you picked, and kept in this browser too.'
                : 'Your progress stays on this device. Nothing about you is sent to us.'}
          </p>
          <p class="record__summary">{summary(record)}</p>
          {notice && <p class="record__alert">{notice.message}</p>}
          {manager.folderError && (
            <p class="record__alert">
              We couldn't save to your folder ({manager.folderError.message}). Your progress is still kept in this browser.
            </p>
          )}

          {pendingRestore ? (
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
