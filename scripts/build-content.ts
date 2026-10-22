import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import type { z } from 'zod';
import { runChecks } from '../src/shared/checks';
import { ContentBundleSchema, LessonSchema, PathIdSchema, PathSchema } from '../src/shared/schema';
import type { ContentBundle, Lesson, Path, PathId } from '../src/shared/types';

function fail(file: string, detail: string): never {
  throw new Error(`${file}: ${detail}`);
}

function describeIssues(err: z.ZodError): string {
  return err.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
}

function readYaml(file: string): unknown {
  try {
    return parse(readFileSync(file, 'utf8'));
  } catch (e) {
    return fail(file, `invalid YAML: ${(e as Error).message}`);
  }
}

export function buildContent(dir: string): ContentBundle {
  const pathsDir = join(dir, 'paths');
  const paths: Partial<Record<PathId, Path>> = {};
  const lessons: Record<string, Lesson> = {};
  const lessonFile: Record<string, string> = {};
  const pathFile: Partial<Record<PathId, string>> = {};

  for (const entry of readdirSync(pathsDir, { withFileTypes: true }).filter((e) => e.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    const pid = PathIdSchema.safeParse(entry.name);
    if (!pid.success) fail(join(pathsDir, entry.name), `unknown path directory "${entry.name}"`);
    const pathId = pid.data;
    const pdir = join(pathsDir, entry.name);
    const pfile = join(pdir, 'path.yaml');
    const rel = (f: string) => relative(dir, f);

    const ids: string[] = [];
    const files = readdirSync(pdir).filter((f) => /^\d+-.+\.ya?ml$/.test(f)).sort();
    for (const f of files) {
      const file = join(pdir, f);
      const parsed = LessonSchema.safeParse({ ...(readYaml(file) as object), pathId });
      if (!parsed.success) fail(rel(file), describeIssues(parsed.error));
      const lesson = parsed.data as Lesson;
      if (lessons[lesson.id]) fail(rel(file), `duplicate lesson id "${lesson.id}" (also in ${lessonFile[lesson.id]})`);
      lessons[lesson.id] = lesson;
      lessonFile[lesson.id] = rel(file);
      ids.push(lesson.id);
    }

    const pparsed = PathSchema.safeParse({ ...(readYaml(pfile) as object), id: pathId, lessons: ids });
    if (!pparsed.success) fail(rel(pfile), describeIssues(pparsed.error));
    paths[pathId] = pparsed.data as Path;
    pathFile[pathId] = rel(pfile);
  }

  /** Every file a path owns: lesson starters, checkpoint and bug files, plus its preview and final files. */
  const ownedByPath = (p: Path): string[] => [
    ...new Set([
      ...p.lessons.flatMap((id) => [...Object.keys(lessons[id].starterFiles ?? {}), lessons[id].checkpoint?.file, lessons[id].bug?.file]),
      ...Object.keys(p.previewFiles ?? {}),
      ...Object.keys(p.finalFiles ?? {}),
    ].filter((f): f is string => !!f)),
  ];

  // Cross-reference checks, after the per-file zod parse, so errors name the file.
  for (const lesson of Object.values(lessons)) {
    for (const br of lesson.checkpoint?.branches ?? []) {
      if (!lessons[br.to]) fail(lessonFile[lesson.id], `checkpoint "${lesson.checkpoint!.id}" branch "${br.outcome}" targets unknown lesson "${br.to}"`);
    }
  }
  const fileOwner: Record<string, PathId> = {};
  for (const [pid, p] of Object.entries(paths) as [PathId, Path][]) {
    if (p.status !== 'live') continue;
    for (const file of ownedByPath(p)) {
      const other = Object.prototype.hasOwnProperty.call(fileOwner, file) ? fileOwner[file] : undefined;
      if (other && other !== pid) fail(pathFile[pid]!, `file "${file}" is owned by both "${other}" and "${pid}"; live paths may not share file names`);
      fileOwner[file] = pid;
    }
  }
  for (const [pid, p] of Object.entries(paths) as [PathId, Path][]) {
    if (p.status !== 'live') continue;
    const n = p.lessons.filter((id) => lessons[id].checkpoint).length;
    if (n < 2) fail(pathFile[pid]!, `a live path needs at least 2 checkpoints across its lessons, found ${n}`);
    // The finished reference theme must pass every check any lesson runs on its files.
    const finalFiles = p.finalFiles ?? {};
    for (const [file, text] of Object.entries(finalFiles)) {
      if (file.endsWith('.json')) {
        try {
          JSON.parse(text);
        } catch (e) {
          fail(pathFile[pid]!, `finalFiles ${file} is not valid JSON: ${(e as Error).message}`);
        }
      }
    }
    const previewFiles = p.previewFiles;
    if (!previewFiles) fail(pathFile[pid]!, 'a live path needs previewFiles');
    const preview = p.preview;
    if (!preview) fail(pathFile[pid]!, 'a live path needs preview (kind: theme, plugin or site)');
    const owned = ownedByPath(p);
    if (preview.kind === 'theme') {
      for (const required of ['style.css', 'templates/index.html']) {
        if (!Object.prototype.hasOwnProperty.call(previewFiles, required)) fail(pathFile[pid]!, `previewFiles must include ${required}`);
      }
    } else if (preview.kind === 'plugin') {
      const main = `${preview.slug}/${preview.slug}.php`;
      if (!Object.prototype.hasOwnProperty.call(previewFiles, main)) fail(pathFile[pid]!, `previewFiles must include ${main}`);
      if (!/^\s*\*\s*Plugin Name:\s*\S/m.test(previewFiles[main])) fail(pathFile[pid]!, `${main} needs a Plugin Name header`);
      for (const file of owned) {
        if (!file.startsWith(`${preview.slug}/`)) fail(pathFile[pid]!, `plugin file "${file}" must live under ${preview.slug}/`);
      }
    } else {
      for (const file of owned) {
        if (!/^pages\/[a-z0-9-]+\.html$/.test(file)) fail(pathFile[pid]!, `site file "${file}" must be named pages/<slug>.html`);
      }
    }
    for (const [file, text] of Object.entries(previewFiles)) {
      if (file.endsWith('.json')) {
        try {
          JSON.parse(text);
        } catch (e) {
          fail(pathFile[pid]!, `previewFiles ${file} is not valid JSON: ${(e as Error).message}`);
        }
      }
    }
    for (const id of p.lessons) {
      const l = lessons[id];
      const checks = [...(l.checkpoint?.checks ?? []), ...(l.bug?.fixChecks ?? [])].filter((ch) => Object.prototype.hasOwnProperty.call(finalFiles, ch.file));
      for (const { check, passed } of runChecks(checks, finalFiles).results) {
        if (!passed) fail(pathFile[pid]!, `finalFiles ${check.file} fails a check in lesson "${id}": ${check.message}`);
      }
    }
  }

  const bundle = ContentBundleSchema.safeParse({ paths, lessons });
  if (!bundle.success) fail(dir, describeIssues(bundle.error));
  return bundle.data as ContentBundle;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const dir = process.env.CONTENT_DIR || 'content';
  const bundle = buildContent(dir);
  mkdirSync('src/generated', { recursive: true });
  writeFileSync('src/generated/content.json', JSON.stringify(bundle, null, 2) + '\n');
  console.log(`content: ${Object.keys(bundle.lessons).length} lessons from ${dir}`);
}
