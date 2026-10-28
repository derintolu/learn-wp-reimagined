// Creates or updates a blog post on learnwp.sqwrlz.com by slug, through `wp lwr-blog put`
// (wordpress/mu-plugins/lwr-blog-cli.php) on the space.
//
//   npx tsx scripts/blog/put-learnwp.ts <post.md> <post.html> [--status publish] [--author <id>] [--dry-run]
//
// The title, slug and excerpt come from the .md file's front matter; the body is the .html file,
// block markup written by hand. A remote WP-CLI argument holds at most 4,096 characters, so the
// body travels as base64 chunks of CHUNK characters, which the command decodes and joins.
// A remote run reports only success or failure, so check the result at /wp-json/wp/v2/posts.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parsePost } from './markdown.ts';
import { MAX_ARG, SPACE } from './draft-learnwp.ts';

/** Base64 characters per chunk: a multiple of 4, so each chunk decodes on its own. */
export const CHUNK = 3500;
export const STATUSES = ['draft', 'pending', 'private', 'publish'] as const;
export type Status = (typeof STATUSES)[number];

/** Splits `content` into base64 chunks of at most CHUNK characters. */
export function base64Chunks(content: string): string[] {
  const b64 = Buffer.from(content, 'utf8').toString('base64');
  const out: string[] = [];
  for (let i = 0; i < b64.length; i += CHUNK) out.push(b64.slice(i, i + CHUNK));
  return out;
}

/** The `wp` arguments for one `lwr-blog put`. */
export function putArgs(source: string, blocks: string, status: Status, author: number): string[] {
  const post = parsePost(source);
  if (!blocks.trim().startsWith('<!-- wp:')) throw new Error('the body is not block markup');
  const args = ['lwr-blog', 'put', post.slug, post.title, post.excerpt, status, ...base64Chunks(blocks), `--author=${author}`];
  const long = args.find((a) => a.length > MAX_ARG);
  if (long) throw new Error(`an argument is ${long.length} characters; remote WP-CLI takes at most ${MAX_ARG}`);
  return args;
}

function main(argv: string[]): void {
  const files = argv.filter((a, i) => !a.startsWith('--') && !['--status', '--author'].includes(argv[i - 1]));
  if (files.length !== 2) throw new Error('usage: put-learnwp.ts <post.md> <post.html> [--status <s>] [--author <id>] [--dry-run]');
  const flag = (name: string) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined);
  const status = (flag('--status') ?? 'draft') as Status;
  if (!STATUSES.includes(status)) throw new Error(`--status must be one of ${STATUSES.join(', ')}`);
  const author = Number(flag('--author') ?? 2); // 2 = Derin Tolu on learnwp.sqwrlz.com
  if (!Number.isInteger(author) || author < 1) throw new Error('--author must be a user id');
  const args = putArgs(readFileSync(files[0], 'utf8'), readFileSync(files[1], 'utf8'), status, author);
  if (argv.includes('--dry-run')) {
    console.log(args.slice(0, 6).join('\n'), `\n${args.length - 7} chunk(s): ${args.slice(6, -1).map((c) => c.length).join(', ')}`, `\n${args.at(-1)}`);
    return;
  }
  execFileSync('sf', ['wp', '--space', SPACE, '--', ...args], { stdio: 'inherit' });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv.slice(2));
}
