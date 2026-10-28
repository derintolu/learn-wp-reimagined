// Creates a blog post on learnwp.sqwrlz.com as a DRAFT, through WP-CLI on the space.
//
//   npx tsx scripts/blog/draft-learnwp.ts <post.md> [--author <user id>] [--dry-run]
//
// It never publishes: Derin reviews and publishes in wp-admin. A remote WP-CLI run reports only
// success or failure, so this can't see whether the draft already exists; running it twice makes
// two drafts. No secrets cross WP-CLI here: the arguments are the post's own text.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parsePost, toBlocks } from './markdown.ts';

export const SPACE = 'learn-wp-reimagined';

/** The `wp` arguments for one draft post. */
export function draftArgs(source: string, author: number): string[] {
  const post = parsePost(source);
  return [
    'post',
    'create',
    '--post_type=post',
    '--post_status=draft',
    `--post_author=${author}`,
    `--post_title=${post.title}`,
    `--post_name=${post.slug}`,
    `--post_excerpt=${post.excerpt}`,
    `--post_content=${toBlocks(post.body)}`,
  ];
}

function main(argv: string[]): void {
  const file = argv.find((a) => !a.startsWith('--'));
  if (!file) throw new Error('usage: draft-learnwp.ts <post.md> [--author <id>] [--dry-run]');
  const ai = argv.indexOf('--author');
  const author = ai >= 0 ? Number(argv[ai + 1]) : 2; // 2 = Derin Tolu on learnwp.sqwrlz.com
  if (!Number.isInteger(author) || author < 1) throw new Error('--author must be a user id');
  const args = draftArgs(readFileSync(file, 'utf8'), author);
  if (argv.includes('--dry-run')) {
    console.log(args.slice(0, 8).join('\n'), `\n--post_content=(${args[8].length} chars)`);
    return;
  }
  execFileSync('sf', ['wp', '--space', SPACE, '--', ...args], { stdio: 'inherit' });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv.slice(2));
}
