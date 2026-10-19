import { z } from 'zod';
import type { ContentBundle, Lesson, Path } from './types';

export const PathIdSchema = z.enum(['learner', 'block-theme', 'vibe-coder']);
export const OutcomeSchema = z.enum(['advance', 'review', 'skip']);

const nonEmpty = z.string().min(1);

export const SourceSchema = z.object({ title: nonEmpty, url: z.url() }).strict();

export const CheckSchema = z.discriminatedUnion('type', [
  z.object({ type: z.enum(['contains', 'notContains']), file: nonEmpty, value: z.string(), message: nonEmpty }).strict(),
  z.object({ type: z.literal('regex'), file: nonEmpty, pattern: nonEmpty, flags: z.string().optional(), message: nonEmpty }).strict(),
  z.object({ type: z.literal('json'), file: nonEmpty, pointer: z.string(), equals: z.unknown(), message: nonEmpty }).strict(),
]);

export const BeatSchema = z
  .object({ id: nonEmpty, goal: nonEmpty, content: nonEmpty, question: nonEmpty.optional() })
  .strict();

export const BranchSchema = z.object({ outcome: OutcomeSchema, to: nonEmpty, message: nonEmpty }).strict();

export const CheckpointSchema = z
  .object({
    id: nonEmpty,
    question: nonEmpty,
    kind: z.enum(['free-text', 'code']),
    rubric: nonEmpty,
    file: nonEmpty.optional(),
    checks: z.array(CheckSchema).optional(),
    branches: z.array(BranchSchema),
    fallback: z.array(z.object({ label: nonEmpty, outcome: OutcomeSchema }).strict()).min(1),
  })
  .strict()
  .superRefine((c, ctx) => {
    for (const o of ['advance', 'review', 'skip'] as const) {
      if (!c.branches.some((b) => b.outcome === o)) {
        ctx.addIssue({ code: 'custom', path: ['branches'], message: `missing branch for outcome "${o}"` });
      }
    }
    if (c.kind === 'code') {
      if (!c.file) ctx.addIssue({ code: 'custom', path: ['file'], message: 'code checkpoint requires file' });
      if (!c.checks?.length) ctx.addIssue({ code: 'custom', path: ['checks'], message: 'code checkpoint requires checks' });
    }
  });

export const PlantedBugSchema = z
  .object({ id: nonEmpty, file: nonEmpty, code: nonEmpty, explanation: nonEmpty, fixChecks: z.array(CheckSchema).min(1) })
  .strict();

export const LessonSchema = z
  .object({
    id: nonEmpty,
    pathId: PathIdSchema,
    title: nonEmpty,
    minutes: z.number().int().positive(),
    sources: z.array(SourceSchema).min(1),
    beats: z.array(BeatSchema).min(1),
    starterFiles: z.record(z.string(), z.string()).optional(),
    checkpoint: CheckpointSchema.optional(),
    bug: PlantedBugSchema.optional(),
  })
  .strict();

export const PathSchema = z
  .object({
    id: PathIdSchema,
    title: nonEmpty,
    tagline: nonEmpty,
    status: z.enum(['live', 'coming-soon']),
    lessons: z.array(nonEmpty),
    placementHints: nonEmpty,
  })
  .strict()
  .superRefine((p, ctx) => {
    if (p.status === 'live' && p.lessons.length === 0) {
      ctx.addIssue({ code: 'custom', path: ['lessons'], message: 'a live path needs at least one lesson' });
    }
  });

export const ContentBundleSchema = z
  .object({
    paths: z.object({ learner: PathSchema, 'block-theme': PathSchema, 'vibe-coder': PathSchema }).strict(),
    lessons: z.record(z.string(), LessonSchema),
  })
  .strict()
  .superRefine((b, ctx) => {
    for (const [key, lesson] of Object.entries(b.lessons)) {
      if (lesson.id !== key) ctx.addIssue({ code: 'custom', path: ['lessons', key], message: `lesson id "${lesson.id}" does not match key` });
      for (const br of lesson.checkpoint?.branches ?? []) {
        if (!b.lessons[br.to]) {
          ctx.addIssue({ code: 'custom', path: ['lessons', key, 'checkpoint', 'branches'], message: `branch targets unknown lesson "${br.to}"` });
        }
      }
    }
    for (const [pid, p] of Object.entries(b.paths)) {
      if (p.id !== pid) ctx.addIssue({ code: 'custom', path: ['paths', pid], message: `path id "${p.id}" does not match key` });
      for (const id of p.lessons) {
        if (!b.lessons[id]) ctx.addIssue({ code: 'custom', path: ['paths', pid, 'lessons'], message: `unknown lesson "${id}"` });
      }
      if (p.status === 'live') {
        const n = p.lessons.filter((id) => b.lessons[id]?.checkpoint).length;
        if (n < 2) ctx.addIssue({ code: 'custom', path: ['paths', pid], message: `a live path needs at least 2 checkpoints, found ${n}` });
      }
    }
  });

// Compile-time guard: schema output must stay assignable to the shared types.
type _Check = z.infer<typeof ContentBundleSchema> extends ContentBundle ? true : never;
export const _typeCheck: _Check = true;
export type { Lesson, Path };
