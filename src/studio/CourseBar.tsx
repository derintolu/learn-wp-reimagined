import { RecordPanel } from '../components/RecordPanel';
import { Sticker } from '../components/Sticker';
import { content } from '../content';
import { useRecord } from '../record/useRecord';
import type { Lesson } from '../shared/types';
import { useStudio, type Pane } from './StudioContext';

const PANES: { id: Pane; label: string }[] = [
  { id: 'outline', label: 'Outline' },
  { id: 'lesson', label: 'Lesson' },
  { id: 'workspace', label: 'Workspace' },
];

/** The charcoal bar over the studio: home, where you are in the path, the pane switch, your record. */
export function CourseBar({ lesson, narrow }: { lesson: Lesson; narrow: boolean }) {
  const { pane, setPane } = useStudio();
  const { record } = useRecord();
  const path = content.paths[lesson.pathId];
  const total = path.lessons.length;
  const n = path.lessons.indexOf(lesson.id) + 1;
  const done = path.lessons.filter((id) => record.completedLessons.includes(id)).length;

  return (
    <header class="course-bar">
      <a class="wordmark course-bar__brand" href="/">
        Learn WordPress, <em>reimagined</em>
      </a>
      <Sticker>unofficial concept</Sticker>
      <div class="course-bar__course">
        <span class="course-bar__label">
          <b>{path.title}</b> · Lesson {n} of {total}
        </span>
        <span
          class="meter"
          role="progressbar"
          aria-label="Course progress"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={done}
          aria-valuetext={`${done} of ${total} lessons done`}
        >
          <span class="meter__fill" style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
        </span>
      </div>
      <span class="course-bar__spacer" />
      {narrow && (
        <div class="panes" role="group" aria-label="Show pane">
          {PANES.map((p) => (
            <button key={p.id} type="button" aria-pressed={pane === p.id ? 'true' : 'false'} onClick={() => setPane(p.id)}>
              {p.label}
            </button>
          ))}
        </div>
      )}
      <RecordPanel />
    </header>
  );
}
