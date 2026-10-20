import { describe, expect, it } from 'vitest';
import { buildContent } from '../../scripts/build-content';
import { DELIVER_GROUNDING, deliverPrompt } from '../../functions/_lib/prompts';

const content = buildContent('tests/fixtures/content');
const lesson = content.lessons['theme-json-basics'];

describe('deliverPrompt grounding', () => {
  it('limits the tutor to the facts, keys and code in the beat', () => {
    const p = deliverPrompt(lesson, lesson.beats[1]);
    expect(p).toContain(DELIVER_GROUNDING);
    expect(DELIVER_GROUNDING).toMatch(/Use ONLY the facts, file names, keys, block markup, code and settings that appear in the beat material/);
    expect(DELIVER_GROUNDING).toMatch(/Do not introduce any other theme\.json keys, settings, functions/);
    expect(DELIVER_GROUNDING).toContain('see the linked source');
  });

  it('still carries the beat material and the sources to point at', () => {
    const p = deliverPrompt(lesson, lesson.beats[1]);
    expect(p).toContain(lesson.beats[1].content.trim());
    expect(p).toContain(lesson.sources[0].url);
  });
});
