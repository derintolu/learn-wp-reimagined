// The course-xapi-mcp standard's validator over package files, as "CODE file pointer: message" lines.
import { loadPackage } from '../vendor/course-xapi-mcp/core/package/index.ts';
import { behaviourIssues } from '../vendor/course-xapi-mcp/validator/behaviour.ts';
import { lintIssues } from '../vendor/course-xapi-mcp/validator/lint.ts';

const dec = new TextDecoder();

/** Validator errors as "CODE file pointer: message" lines. XSD checks need schema files that are not vendored. */
export function packageErrors(files: Record<string, Uint8Array>): string[] {
  const loaded = loadPackage(files);
  const line = (i: { code: string; file?: string; pointer?: string; message?: string }) =>
    `${i.code} ${[i.file, i.pointer].filter(Boolean).join(' ')}${i.message ? `: ${i.message}` : ''}`;
  const out = loaded.issues.filter((i) => i.severity === 'error').map(line);
  if (!loaded.ok) return out;
  const lessons = Object.values(loaded.course.lessons).map((l) => {
    const file = `cxm/lessons/${l.key}.json`;
    return { key: l.key, file, base: '', lesson: JSON.parse(dec.decode(files[file]!)) };
  });
  const course = { file: 'cxm/course.json', base: '', rules: loaded.course.rules };
  const issues = [...behaviourIssues(lessons, 'authoring'), ...lintIssues(course, lessons)];
  return [...out, ...issues.filter((i) => i.severity === 'error').map(line)];
}
