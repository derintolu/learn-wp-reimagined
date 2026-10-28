import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildContentFromYaml } from '../../scripts/yaml-content';

// The YAML loader stays until Task 24; migrate-to-sensei still uses it.
function yamlDir(lesson: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'yaml-'));
  const p = join(dir, 'paths/learner');
  mkdirSync(p, { recursive: true });
  writeFileSync(join(p, 'path.yaml'), 'title: Learner\ntagline: t\nstatus: coming-soon\nplacementHints: h\n');
  writeFileSync(join(p, '01-a.yaml'), lesson);
  return dir;
}

describe('buildContentFromYaml', () => {
  it('names the file when a lesson is malformed YAML', () => {
    expect(() => buildContentFromYaml(yamlDir('title: [unclosed\n'))).toThrow(/01-a\.yaml.*invalid YAML/);
  });

  it('names the file and field when a lesson fails the schema', () => {
    expect(() => buildContentFromYaml(yamlDir('id: a\ntitle: A\n'))).toThrow(/01-a\.yaml/);
  });
});
