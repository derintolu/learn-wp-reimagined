import type { RecordEvent } from './record';
import type { ContentBundle } from './types';
import { EXT_CHOSEN_BY, EXT_FROM_LESSON, EXT_OUTCOME, activityId, buildStatement, type VerbKey, type XapiResult, type XapiStatement } from './xapi';

const has = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

/**
 * The xAPI statements one record event produces, in order. Shared by the browser record and the server.
 * `placed` and `fileEdited` produce none. Whether `lessonCompleted` is a repeat is the caller's concern.
 */
export function statementsForEvent(
  learnerId: string,
  e: RecordEvent,
  c: ContentBundle,
  opts: { ids?: string[]; timestamp?: string; chosenBy?: 'judge' | 'learner' } = {},
): XapiStatement[] {
  const out: XapiStatement[] = [];
  const lessonOf = (id: string) => (has(c.lessons, id) ? c.lessons[id] : undefined);
  const title = (id: string) => lessonOf(id)?.title ?? id;
  const add = (verb: VerbKey, activityPath: string[], name: string, lessonId: string, result?: XapiResult) => {
    const lesson = lessonOf(lessonId);
    out.push(
      buildStatement({
        learnerId,
        verb,
        activityPath,
        name,
        result,
        parent: lesson ? ['paths', lesson.pathId] : undefined,
        id: opts.ids?.[out.length],
        timestamp: opts.timestamp,
      }),
    );
  };

  switch (e.type) {
    case 'beatViewed': {
      const beat = lessonOf(e.lessonId)?.beats[e.beatIndex];
      add('experienced', ['lessons', e.lessonId, 'beats', String(e.beatIndex)], beat ? `${title(e.lessonId)}: ${beat.id}` : title(e.lessonId), e.lessonId);
      break;
    }
    case 'checkpointAnswered': {
      const cpPath = ['lessons', e.lessonId, 'checkpoint'];
      const name = `${title(e.lessonId)}: checkpoint`;
      add('answered', cpPath, name, e.lessonId, { response: e.response });
      add(e.outcome === 'review' ? 'failed' : 'passed', cpPath, name, e.lessonId, { success: e.outcome !== 'review' });
      const extensions: Record<string, unknown> = { [EXT_OUTCOME]: e.outcome, [EXT_FROM_LESSON]: activityId(['lessons', e.lessonId]) };
      if (opts.chosenBy === 'learner') extensions[EXT_CHOSEN_BY] = 'learner';
      add('branched', ['lessons', e.to], title(e.to), e.to, { extensions });
      break;
    }
    case 'codeChecked':
      add(e.passed ? 'passed' : 'failed', ['lessons', e.lessonId, 'files', e.file], `${title(e.lessonId)}: ${e.file}`, e.lessonId, { success: e.passed });
      break;
    case 'lessonCompleted':
      add('completed', ['lessons', e.lessonId], title(e.lessonId), e.lessonId, { completion: true });
      break;
  }
  return out;
}
