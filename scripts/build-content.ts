// Stub: Task 2 replaces this with the real content compiler.
import { mkdirSync, writeFileSync } from 'node:fs';

mkdirSync('src/generated', { recursive: true });
writeFileSync('src/generated/content.json', JSON.stringify({ paths: {}, lessons: {} }));
