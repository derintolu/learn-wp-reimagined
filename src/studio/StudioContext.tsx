import { createContext, type ComponentChildren } from 'preact';
import { useContext, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { content } from '../content';
import { useFileEdits } from '../record/useFileEdits';
import { getRecordManager } from '../record/useRecord';
import type { Lesson } from '../shared/types';
import type { LivePreview } from './previewClient';
import { workspaceFiles } from './workspace';

export type Pane = 'outline' | 'lesson' | 'workspace';

export interface Studio {
  files: Record<string, string>;
  editable: string[];
  /** The open tab. */
  active: string;
  /** The saved record has loaded and the files are in. */
  loaded: boolean;
  /** Open a file's tab, and switch the narrow-screen pane to Workspace (unless `switchPane` is false). */
  openFile(name: string, opts?: { switchPane?: boolean }): void;
  /** The learner typing. Edits to editable files are recorded (debounced, tagged with this lesson). */
  setFile(name: string, text: string): void;
  /** Like setFile but programmatic (e.g. a bug hunt starting): nothing is recorded. */
  replaceFile(name: string, text: string): void;
  /** Write files to the preview. Default: every dirty file. Before the preview is ready they wait. */
  apply(names?: string[]): Promise<void>;
  /** Files changed since the last apply. */
  dirty: string[];
  /** Record any pending edit now. */
  flush(): void;
  /** Move keyboard focus into the workspace editor (on the open tab). */
  focusEditor(): void;
  pane: Pane;
  setPane(p: Pane): void;
  /** What describes a file's editor (e.g. the code checkpoint's question), while it shows. */
  describedBy: { file: string; id: string } | null;
  setDescribedBy(d: { file: string; id: string } | null): void;
}

/** What the workspace pane needs beyond the public interface. */
interface StudioInternal extends Studio {
  /** The open lesson: its path decides what the preview runs and where it lands. */
  lesson: Lesson;
  /** Bumped by focusEditor; the workspace pane focuses its editor when it changes. */
  focusTick: number;
  /** The lesson is completed, so nothing is editable (R22). */
  completed: boolean;
  /** The preview couldn't start (it may still come up late, via attachPreview). Apply is off meanwhile. */
  previewFailed: boolean;
  failPreview(): void;
  attachPreview(p: LivePreview): void;
}

const Ctx = createContext<StudioInternal | null>(null);

function internal(): StudioInternal {
  const s = useContext(Ctx);
  if (!s) throw new Error('useStudio needs a <StudioProvider>');
  return s;
}

export function useStudio(): Studio {
  return internal();
}

/** For <Workspace>: whether the files are loaded, and where to hand the booted preview. */
export function useStudioInternal(): StudioInternal {
  return internal();
}

const pick = (files: Record<string, string>, names: string[]) =>
  Object.fromEntries(names.filter((n) => n in files).map((n) => [n, files[n]]));

export function StudioProvider({ lesson, children }: { lesson: Lesson; children?: ComponentChildren }) {
  const manager = getRecordManager();
  const { edit, flush } = useFileEdits(lesson.id);
  const [loaded, setLoaded] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [files, setFiles] = useState<Record<string, string>>({});
  const [editable, setEditable] = useState<string[]>([]);
  const [active, setActive] = useState('');
  const [pane, setPane] = useState<Pane>('lesson');
  const [describedBy, setDescribedBy] = useState<Studio['describedBy']>(null);
  const [focusTick, setFocusTick] = useState(0);
  // What the preview has (or will have, once pending writes land). Dirty = differs from this.
  const [applied, setApplied] = useState<Record<string, string>>({});
  const [previewFailed, setPreviewFailed] = useState(false);
  const failedRef = useRef(false);

  const filesRef = useRef(files);
  const appliedRef = useRef(applied);
  const editableRef = useRef(editable);
  const preview = useRef<LivePreview | null>(null);
  const pending = useRef<Record<string, string> | null>(null);
  const queue = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    let live = true;
    // Load the files whether or not the saved record could be read (then it's the starting record).
    const load = () => {
      if (!live) return;
      const r = manager.record;
      const w = workspaceFiles(content, r, lesson.id);
      const done = r.completedLessons.includes(lesson.id);
      const canEdit = done ? [] : w.editable; // R22: a completed lesson is read-only
      filesRef.current = w.files;
      appliedRef.current = w.files;
      editableRef.current = canEdit;
      setFiles(w.files);
      setApplied(w.files);
      setEditable(canEdit);
      setCompleted(done);
      setActive(canEdit.find((f) => f in w.files) ?? Object.keys(w.files)[0] ?? '');
      setLoaded(true);
    };
    manager.init().then(load, load);
    return () => {
      live = false;
    };
  }, [manager, lesson.id]);

  const value = useMemo<StudioInternal>(() => {
    const put = (name: string, text: string) => {
      filesRef.current = { ...filesRef.current, [name]: text };
      setFiles(filesRef.current);
    };
    const write = (batch: Record<string, string>) => {
      const p = preview.current!;
      queue.current = queue.current
        .then(() => p.write(batch))
        .catch(() => {
          // The preview never got these: make them dirty again, unless a newer apply has replaced them.
          let changed = false;
          const next = { ...appliedRef.current };
          for (const [n, text] of Object.entries(batch)) {
            if (next[n] === text) {
              delete next[n];
              changed = true;
            }
          }
          if (changed) {
            appliedRef.current = next;
            setApplied(next);
          }
        });
      return queue.current;
    };
    return {
      files,
      editable,
      active,
      pane,
      setPane,
      describedBy,
      setDescribedBy,
      loaded,
      completed,
      dirty: Object.keys(files).filter((n) => files[n] !== applied[n]),
      flush,
      focusTick,
      focusEditor() {
        setFocusTick((n) => n + 1);
      },
      openFile(name, opts) {
        setActive(name);
        if (opts?.switchPane !== false) setPane('workspace');
      },
      setFile(name, text) {
        if (filesRef.current[name] === text) return; // the editor echoing a replaceFile back
        put(name, text);
        if (editableRef.current.includes(name)) edit(name, text);
      },
      replaceFile: put,
      apply(names) {
        // Nowhere to write: the files stay dirty until the preview comes up (if it does).
        if (failedRef.current) return queue.current;
        const cur = filesRef.current;
        const list = names ?? Object.keys(cur).filter((n) => cur[n] !== appliedRef.current[n]);
        const batch = pick(cur, list);
        if (Object.keys(batch).length === 0) return queue.current;
        appliedRef.current = { ...appliedRef.current, ...batch };
        setApplied(appliedRef.current);
        if (!preview.current) {
          pending.current = { ...pending.current, ...batch };
          return Promise.resolve();
        }
        return write(batch);
      },
      lesson,
      previewFailed,
      failPreview() {
        failedRef.current = true;
        setPreviewFailed(true);
      },
      attachPreview(p) {
        failedRef.current = false;
        setPreviewFailed(false);
        preview.current = p;
        const waiting = pending.current;
        pending.current = null;
        if (waiting) void write(waiting);
      },
    };
  }, [lesson, files, editable, active, pane, describedBy, loaded, completed, applied, focusTick, previewFailed]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
