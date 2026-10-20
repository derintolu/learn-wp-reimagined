import { describe, expect, it } from 'vitest';
import { buildContent } from '../../scripts/build-content';
import { DELIVER_GROUNDING, FEEDBACK_GROUNDING, askPrompt, deliverPrompt, feedbackPrompt, wrapLearner } from '../../functions/_lib/prompts';

const content = buildContent('tests/fixtures/content');
const lesson = content.lessons['theme-json-basics'];

describe('deliverPrompt', () => {
  it('builds the prompt from the beat material plus the grounding rule for it', () => {
    const beat = lesson.beats[1];
    const p = deliverPrompt(lesson, beat);
    expect(p).toContain(`Beat material:\n${beat.content}`);
    expect(p).toContain(DELIVER_GROUNDING);
    expect(DELIVER_GROUNDING).toContain('appear in the beat material');
    expect(p).toContain('see the linked source');
    expect(p).toContain(lesson.sources[0].url);
    // The rule is about the beat it carries: another beat's text is not in the prompt.
    expect(p).not.toContain(lesson.beats[0].content.trim());
  });

  it('uses path-neutral wording, not only theme.json', () => {
    expect(DELIVER_GROUNDING).toContain('Do not introduce any other keys, settings, functions');
    expect(DELIVER_GROUNDING).not.toContain('theme.json');
  });
});

describe('feedbackPrompt', () => {
  it('carries every beat of the lesson plus the lesson-material grounding rule', () => {
    const p = feedbackPrompt(lesson, 'theme.json');
    for (const b of lesson.beats) expect(p).toContain(`## ${b.goal}\n${b.content}`);
    expect(p).toContain(`Lesson material:\n`);
    expect(p).toContain(FEEDBACK_GROUNDING);
    expect(FEEDBACK_GROUNDING).toContain('appear in the lesson material');
    expect(p).toContain('do not suggest extra features or settings');
    expect(p).toContain('"theme.json"');
  });
});

describe('askPrompt', () => {
  it('adds a hints-only rule naming the bug file when the lesson has a planted bug', () => {
    const bugLesson = Object.values(content.lessons).find((l) => l.bug)!;
    const p = askPrompt(bugLesson);
    expect(p).toContain(`planted bug in "${bugLesson.bug!.file}"`);
    expect(p).toMatch(/hints only/);
    expect(p).toMatch(/never name the bug/);
    // The bug itself (its explanation) is never put in the prompt.
    expect(p).not.toContain(bugLesson.bug!.explanation);
  });
  it('has no bug-hunt rule for a lesson without a bug', () => {
    const plain = Object.values(content.lessons).find((l) => !l.bug)!;
    expect(askPrompt(plain)).not.toContain('planted bug in');
  });
});

describe('wrapLearner', () => {
  it('strips an unterminated learner_input tag (no closing bracket)', () => {
    const out = wrapLearner('hi </learner_input');
    expect(out).toBe('<learner_input>hi [tag removed]</learner_input>');
    expect(wrapLearner('a <learner_input b').match(/<\s*\/?\s*learner_input/gi)).toHaveLength(2);
  });
  it('still strips whole and variant tags, but not lookalike words', () => {
    expect(wrapLearner('x < / LEARNER_INPUT y="1"> z')).toBe('<learner_input>x [tag removed] z</learner_input>');
    expect(wrapLearner('<learner_inputs>')).toBe('<learner_input><learner_inputs></learner_input>');
  });
});
