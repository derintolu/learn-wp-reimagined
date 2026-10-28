import { useCallback, useEffect, useState } from 'preact/hooks';
import { useRoute } from 'preact-iso';
import { Swipe } from '../components/Swipe';
import { formatDate, getPost, listPosts, type BlogPost } from '../blog/posts';
import { useMetaDescription, usePageTitle } from '../usePageTitle';
import { Placeholder } from './Placeholder';
import '../styles/blog.css';

export const BLOG_TITLE = 'Blog';
export const BLOG_DESCRIPTION =
  'Notes from building Learn WordPress, reimagined: the course-xapi-mcp standard, the Learning Ledger plugin and the move onto Sensei.';
export const POST_NOT_FOUND_TITLE = 'Post not found';

type Load<T> = { state: 'loading' } | { state: 'error' } | { state: 'ready'; value: T };

/** Runs `load` on mount and whenever `key` changes; `retry` runs it again. */
function useLoad<T>(load: () => Promise<T>, key: string): [Load<T>, () => void] {
  const [result, setResult] = useState<Load<T>>({ state: 'loading' });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    setResult({ state: 'loading' });
    load().then(
      (value) => live && setResult({ state: 'ready', value }),
      () => live && setResult({ state: 'error' }),
    );
    return () => {
      live = false;
    };
    // `load` is rebuilt each render; `key` names what it loads.
  }, [key, attempt]);
  return [result, useCallback(() => setAttempt((n) => n + 1), [])];
}

function Byline({ post }: { post: BlogPost }) {
  const date = formatDate(post.date);
  return (
    <p class="blog-meta">
      {date && <time dateTime={`${post.date}Z`}>{date}</time>}
      {date && post.author && <span aria-hidden="true"> · </span>}
      {post.author && <span>{post.author}</span>}
    </p>
  );
}

function Loading({ label }: { label: string }) {
  return (
    <p class="blog-status" role="status">
      {label}
    </p>
  );
}

function LoadError({ what, onRetry }: { what: string; onRetry: () => void }) {
  return (
    <div class="blog-status" role="alert">
      <p>{what} couldn't load. Check your connection and try again.</p>
      <button type="button" class="button button--quiet" onClick={onRetry}>
        Try again
      </button>
    </div>
  );
}

/** /blog: every published post, newest first. */
export function BlogIndex() {
  usePageTitle(BLOG_TITLE);
  useMetaDescription(BLOG_DESCRIPTION);
  const [posts, retry] = useLoad(listPosts, 'all');
  return (
    <section class="band band--light blog" aria-labelledby="blog-title">
      <div class="wrap split">
        <div>
          <h1 id="blog-title" class="placeholder__title">
            The <Swipe>blog</Swipe>
          </h1>
          <p class="lede blog__lede">{BLOG_DESCRIPTION}</p>
        </div>
        <div class="split__body" aria-busy={posts.state === 'loading'}>
          {posts.state === 'loading' && <Loading label="Loading posts…" />}
          {posts.state === 'error' && <LoadError what="The posts" onRetry={retry} />}
          {posts.state === 'ready' && posts.value.length === 0 && (
            <p class="blog-status">No posts yet. Check back soon.</p>
          )}
          {posts.state === 'ready' && posts.value.length > 0 && (
            <ol class="blog-list" aria-label="Posts">
              {posts.value.map((p) => (
                <li key={p.slug}>
                  <article class="blog-card" aria-labelledby={`post-${p.slug}`}>
                    <h2 id={`post-${p.slug}`} class="blog-card__title">
                      <a href={`/blog/${encodeURIComponent(p.slug)}`}>{p.title}</a>
                    </h2>
                    <Byline post={p} />
                    {p.excerpt && <p class="blog-card__excerpt">{p.excerpt}</p>}
                  </article>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </section>
  );
}

/** /blog/:slug: one published post. */
export function BlogPostPage() {
  const { params } = useRoute();
  const slug = params.slug ?? '';
  const [post, retry] = useLoad(() => getPost(slug), slug);
  const found = post.state === 'ready' ? post.value : null;
  usePageTitle(post.state === 'ready' ? (found ? found.title : POST_NOT_FOUND_TITLE) : BLOG_TITLE);
  useMetaDescription(found?.excerpt || null);

  if (post.state === 'ready' && !found) {
    return (
      <Placeholder title={<>No post <Swipe>here</Swipe></>}>
        <p>There's no published post at this address.</p>
        <p>
          <a href="/blog">See all posts</a>
        </p>
      </Placeholder>
    );
  }
  return (
    <article class="band band--light blog-post" aria-labelledby={found ? 'post-title' : undefined} aria-busy={post.state === 'loading'}>
      <div class="wrap">
        <p class="blog-post__back">
          <a href="/blog">
            <span aria-hidden="true">← </span>All posts
          </a>
        </p>
        {post.state === 'loading' && <Loading label="Loading the post…" />}
        {post.state === 'error' && <LoadError what="This post" onRetry={retry} />}
        {found && (
          <>
            <header class="blog-post__header">
              <h1 id="post-title" class="blog-post__title">
                {found.title}
              </h1>
              <Byline post={found} />
            </header>
            {/* Sanitized with DOMPurify in sanitizePostHtml. */}
            <div class="prose blog-post__body" dangerouslySetInnerHTML={{ __html: found.html }} />
          </>
        )}
      </div>
    </article>
  );
}
