import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { buildContent } from '../../scripts/build-content';
import { FIXTURE_CONTENT, contentDirFrom, effortFor, expectedStarts } from '../../scripts/eval-models';

const cases = parse(readFileSync('tests/eval/cases.yaml', 'utf8')) as {
  placement: { id: string; expect: { start?: string[]; contentStart?: string[] } }[];
};

describe('eval-models content switch', () => {
  it('defaults to the fixtures and takes --content <dir>', () => {
    expect(contentDirFrom([])).toBe(FIXTURE_CONTENT);
    expect(contentDirFrom(['--only', 'placement', '--content', 'content'])).toBe('content');
  });

  it('uses contentStart on real content and start on the fixtures', () => {
    const e = { start: ['theme-json-basics'], contentStart: ['bt-what-is-a-block-theme'] };
    expect(expectedStarts(e, FIXTURE_CONTENT)).toEqual(['theme-json-basics']);
    expect(expectedStarts(e, 'content')).toEqual(['bt-what-is-a-block-theme']);
    expect(expectedStarts({ start: ['ln-what-is-wordpress'] }, 'content')).toEqual(['ln-what-is-wordpress']);
  });

  it('every expected start is a real lesson in the content it is checked against', () => {
    const fixture = buildContent(FIXTURE_CONTENT);
    const real = buildContent();
    for (const c of cases.placement) {
      for (const id of expectedStarts(c.expect, FIXTURE_CONTENT)) expect(fixture.lessons[id], `${c.id}: ${id}`).toBeTruthy();
      for (const id of expectedStarts(c.expect, 'content')) expect(real.lessons[id], `${c.id}: ${id}`).toBeTruthy();
    }
  });
});

describe('eval-models reasoning effort', () => {
  it("sends the route's effort only for the routed model", () => {
    expect(effortFor('placement', '@cf/openai/gpt-oss-120b')).toBe('low');
    expect(effortFor('judge', '@cf/openai/gpt-oss-120b')).toBe('low');
    expect(effortFor('placement', '@cf/zai-org/glm-4.7-flash')).toBeUndefined();
    expect(effortFor('feedback', '@cf/meta/llama-4-scout-17b-16e-instruct')).toBeUndefined();
  });
});
