export type PathId = 'learner' | 'block-theme' | 'vibe-coder';
export type Outcome = 'advance' | 'review' | 'skip';

export interface Source { title: string; url: string }

export interface Path {
  id: PathId;
  title: string;
  tagline: string;
  status: 'live' | 'coming-soon';
  lessons: string[];
  placementHints: string;
  /** The finished reference theme, file name to content. Live paths only. */
  finalFiles?: Record<string, string>;
  /** Read-only scaffold files so the live preview renders from the first lesson. Live paths only. */
  previewFiles?: Record<string, string>;
}

export interface Beat { id: string; goal: string; content: string; question?: string }

export type Check =
  | { type: 'contains' | 'notContains'; file: string; value: string; message: string }
  | { type: 'regex'; file: string; pattern: string; flags?: string; message: string }
  | { type: 'json'; file: string; pointer: string; equals: unknown; message: string };

export interface Branch { outcome: Outcome; to: string; message: string }

export interface Checkpoint {
  id: string;
  question: string;
  kind: 'free-text' | 'code';
  rubric: string;
  file?: string;
  checks?: Check[];
  branches: Branch[];
  fallback: { label: string; outcome: Outcome }[];
}

export interface PlantedBug { id: string; file: string; code: string; explanation: string; fixChecks: Check[] }

export interface Lesson {
  id: string;
  pathId: PathId;
  title: string;
  minutes: number;
  sources: Source[];
  beats: Beat[];
  starterFiles?: Record<string, string>;
  checkpoint?: Checkpoint;
  bug?: PlantedBug;
}

export interface ContentBundle { paths: Record<PathId, Path>; lessons: Record<string, Lesson> }
