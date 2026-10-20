import { describe, expect, it } from 'vitest';
import { buildContent } from '../../scripts/build-content';
import { DELIVER_GROUNDING, FEEDBACK_GROUNDING, deliverPrompt, feedbackPrompt } from '../../functions/_lib/prompts';

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
