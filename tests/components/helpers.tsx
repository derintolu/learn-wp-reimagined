import { RecordManager, type RecordStore } from '../../src/record/store';
import type { LearningRecord } from '../../src/shared/record';
import type { ContentBundle } from '../../src/shared/types';

/** A RecordManager over an in-memory store, for component tests. */
export function memoryManager(content: ContentBundle): RecordManager {
  let saved: LearningRecord | null = null;
  const store: RecordStore = {
    kind: 'memory',
    load: async () => saved,
    save: async (r) => {
      saved = r;
    },
  };
  return new RecordManager(store, content);
}
