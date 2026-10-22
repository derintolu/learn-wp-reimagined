import { useMemo } from 'preact/hooks';
import { content } from '../content';
import { useRecord } from '../record/useRecord';
import { pathZip, resolveFiles } from '../finale/themeZip';
import { PLAYGROUND_URL_LIMIT, playgroundUrl } from '../finale/playground';
import { Bubble } from '../components/Bubble';
import { SketchIcon } from '../components/SketchIcon';
import { Swipe } from '../components/Swipe';
import { NotFound } from './routes';
import { usePageTitle } from '../usePageTitle';
import type { PathId, Preview } from '../shared/types';

function downloadZip(files: Record<string, string>, preview: Preview) {
  const blob = new Blob([pathZip(files, preview) as BlobPart], { type: 'application/zip' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${preview.kind === 'site' ? 'site' : preview.slug}.zip`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Some browsers start the download asynchronously; revoking at once can cancel it.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

interface Copy {
  noun: string;
  filesLabel: string;
  lessonsLabel: string;
  made: string;
  finished: string;
  none: string;
  download: string | null;
  open: string;
  tooBig: string;
  fine: string;
  next: { title: string; body: (slug: string) => preact.ComponentChildren };
  keepLearning: preact.ComponentChildren;
  closing: string;
}

const THEME_COPY: Copy = {
  noun: 'theme',
  filesLabel: 'Files in your theme',
  lessonsLabel: 'Lessons in your theme',
  made: "That's a real WordPress block theme, and you wrote it. Take it home as a zip, or watch it run in a full WordPress site in your browser.",
  finished: "Here's the finished theme from the path, a real WordPress block theme. Take it home as a zip, or watch it run in a full WordPress site in your browser.",
  none: "Here's the block theme this path builds. Open the finished reference theme in a real WordPress site, then work through the lessons to make it yours.",
  download: 'Download your theme (.zip)',
  open: 'Open in WordPress Playground',
  tooBig: 'Your theme is too big for a Playground link. Download the zip, open playground.wordpress.net and upload it under Appearance → Themes.',
  fine: "Playground runs WordPress entirely in your browser. It takes a few seconds to start, then shows your theme's front page. Nothing is uploaded anywhere.",
  next: {
    title: 'Install it on a real site',
    body: (slug) => (
      <>
        In any WordPress site, go to Appearance → Themes → Add Theme → Upload Theme, choose <code>{slug}.zip</code> and activate it.
        Then open the Site Editor and keep shaping it.
      </>
    ),
  },
  keepLearning: (
    <>
      The <a href="https://learn.wordpress.org/">Learn WordPress</a> courses and the{' '}
      <a href="https://developer.wordpress.org/themes/">Theme Handbook</a> go deeper on everything here. The Create Block Theme plugin
      exports whatever you change in the Site Editor back to files.
    </>
  ),
  closing: 'The theme, though, is entirely yours.',
};

const PLUGIN_COPY: Copy = {
  noun: 'plugin',
  filesLabel: 'Files in your plugin',
  lessonsLabel: 'Lessons in your plugin',
  made: "That's a real WordPress plugin, and you shaped it, bugs caught and all. Take it home as a zip, or switch it on in a full WordPress site in your browser.",
  finished: "Here's the finished plugin from the path, a real WordPress plugin. Take it home as a zip, or switch it on in a full WordPress site in your browser.",
  none: "Here's the plugin this path builds. Open the finished reference plugin in a real WordPress site, then work through the lessons to make it yours.",
  download: 'Download your plugin (.zip)',
  open: 'Open in WordPress Playground',
  tooBig: 'Your plugin is too big for a Playground link. Download the zip, open playground.wordpress.net and upload it under Plugins → Add Plugin.',
  fine: 'Playground runs WordPress entirely in your browser. It takes a few seconds to start, then opens a site with your plugin already active. Nothing is uploaded anywhere.',
  next: {
    title: 'Install it on a real site',
    body: (slug) => (
      <>
        In any WordPress site, go to Plugins → Add Plugin → Upload Plugin, choose <code>{slug}.zip</code> and activate it. Try it on a
        test site first, the way you would with any code an AI wrote for you.
      </>
    ),
  },
  keepLearning: (
    <>
      The <a href="https://learn.wordpress.org/">Learn WordPress</a> courses and the{' '}
      <a href="https://developer.wordpress.org/plugins/">Plugin Handbook</a> go deeper on everything here.
    </>
  ),
  closing: 'The plugin, though, is entirely yours.',
};

const SITE_COPY: Copy = {
  noun: 'site',
  filesLabel: 'Pages in your site',
  lessonsLabel: 'Lessons in your site',
  made: "That's a real WordPress site, and you built it. Watch it run in a full WordPress site in your browser.",
  finished: "Here's the finished site from the path, running in a real WordPress site in your browser.",
  none: "Here's what this path builds. Open the finished reference site in WordPress Playground, then work through the lessons to make it yours.",
  download: null,
  open: 'Open your site in Playground',
  tooBig: 'Your site is too big for a Playground link. Head back to the lessons and trim a page or two.',
  fine: 'Playground runs WordPress entirely in your browser. It takes a few seconds to start, then shows your pages. Nothing is uploaded anywhere.',
  next: {
    title: 'Make it a real site',
    body: () => (
      <>
        Pick a host, or run WordPress on your own computer with Local. Then paste each page's markup into the code editor of a new page
        and publish it.
      </>
    ),
  },
  keepLearning: (
    <>
      The <a href="https://learn.wordpress.org/">Learn WordPress</a> courses and the{' '}
      <a href="https://wordpress.org/documentation/">WordPress documentation</a> go deeper on everything here.
    </>
  ),
  closing: 'The site, though, is entirely yours.',
};

const COPY = { theme: THEME_COPY, plugin: PLUGIN_COPY, site: SITE_COPY };

/** /finale (the block theme) and /finale/:pathId. An unknown or non-live path is NotFound. */
export function Finale({ pathId }: { pathId?: string }) {
  const id = pathId ?? 'block-theme';
  const path = Object.prototype.hasOwnProperty.call(content.paths, id) ? content.paths[id as PathId] : undefined;
  if (!path || path.status !== 'live' || !path.preview) return <NotFound />;
  return <FinaleFor pathId={path.id} />;
}

function FinaleFor({ pathId }: { pathId: PathId }) {
  const { record } = useRecord();
  const path = content.paths[pathId];
  usePageTitle(`Finale: ${path.title}`);
  const preview = path.preview!;
  const copy = COPY[preview.kind];
  const lessons = path.lessons.map((id) => content.lessons[id]).filter(Boolean);
  const done = new Set(record.completedLessons);
  const doneCount = lessons.filter((l) => done.has(l.id)).length;
  const resolved = useMemo(() => resolveFiles(content, record, pathId), [record, pathId]);
  const files = resolved.files;
  const url = useMemo(() => playgroundUrl(files, preview), [files, preview]);
  const fits = url.length < PLAYGROUND_URL_LIMIT;
  const names = Object.keys(files).sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b));
  const slug = preview.kind === 'site' ? '' : preview.slug;
  const root = preview.kind === 'theme' ? `${slug}/` : preview.kind === 'plugin' ? 'wp-content/plugins/' : null;

  return (
    <>
      <section class="band band--dark finale-hero" aria-labelledby="finale-title">
        <div class="wrap split">
          <div class="finale-hero__head">
            <SketchIcon name={pathId} class="finale-hero__icon" />
            <h1 class="split__title finale-hero__title" id="finale-title">
              {doneCount > 0 ? (
                preview.kind === 'theme' ? (
                  <>
                    You made it <Swipe>this far</Swipe>
                  </>
                ) : (
                  <>
                    Your first {copy.noun}, <Swipe>built</Swipe>
                  </>
                )
              ) : (
                <>
                  Where this path <Swipe>ends up</Swipe>
                </>
              )}
            </h1>
          </div>
          <div class="split__body finale-hero__body">
            <p class="lede">{doneCount > 0 && resolved.used.length > 0 ? copy.made : doneCount > 0 ? copy.finished : copy.none}</p>
            <p class="finale-hero__meta">
              {doneCount === lessons.length
                ? `All ${lessons.length} lessons done.`
                : doneCount > 0
                  ? `${doneCount} of ${lessons.length} lessons done. Anything you skipped comes from the finished reference ${copy.noun}, so it's still complete.`
                  : `0 of ${lessons.length} lessons done.`}
            </p>
            <div class="finale-actions">
              {copy.download && (
                <button type="button" class="button" onClick={() => downloadZip(files, preview)}>
                  {copy.download}
                </button>
              )}
              {fits ? (
                <a class="button button--quiet" href={url} target="_blank" rel="noopener noreferrer">
                  {copy.open}
                  <span aria-hidden="true">↗</span>
                  <span class="visually-hidden"> (opens in a new tab)</span>
                </a>
              ) : (
                <p class="finale-actions__note">{copy.tooBig}</p>
              )}
            </div>
            {fits && (
              <p class="finale-hero__fine">{copy.fine}</p>
            )}
          </div>
        </div>
      </section>

      <section class="band band--light" aria-labelledby="theme-title">
        <div class="wrap split">
          <h2 class="split__title" id="theme-title">
            What's in <Swipe>your {copy.noun}</Swipe>
          </h2>
          <div class="split__body split__body--wide finale-theme">
            <div class="finale-files">
              {root && (
                <p class="finale-files__root">
                  <span aria-hidden="true">▾ </span>
                  {root}
                </p>
              )}
              <ul class="finale-files__list" aria-label={copy.filesLabel}>
                {names.map((f) => (
                  <li key={f}>
                    <code>{f}</code>
                    {resolved.used.includes(f) && <span class="chip chip--here">Your edit</span>}
                  </li>
                ))}
              </ul>
              {resolved.replaced.length > 0 && (
                <ul class="finale-files__notes">
                  {resolved.replaced.map((n) => (
                    <li key={n.file}>{n.message}</li>
                  ))}
                </ul>
              )}
            </div>
            <ol class="lesson-list finale-lessons" aria-label={copy.lessonsLabel}>
              {lessons.map((l, i) => (
                <li class="lesson-row" key={l.id}>
                  <span class="lesson-row__n" aria-hidden="true">
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <div class="lesson-row__main">
                    <h3 class="lesson-row__title">
                      <a href={`/learn/${l.id}`}>{l.title}</a>
                    </h3>
                  </div>
                  <span class={`chip ${done.has(l.id) ? 'chip--done' : 'chip--skipped'}`}>
                    {done.has(l.id) ? 'Done' : 'Not done'}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </section>

      <section class="band band--dark-2" aria-labelledby="next-title">
        <div class="wrap split">
          <h2 class="split__title" id="next-title">
            What to do <Swipe>next</Swipe>
          </h2>
          <div class="split__body">
            <ol class="finale-next">
              <li>
                <h3>{copy.next.title}</h3>
                <p>{copy.next.body(slug)}</p>
              </li>
              <li>
                <h3>Keep learning</h3>
                <p>{copy.keepLearning}</p>
              </li>
            </ol>
            <div class="chat finale-chat">
              <Bubble from="tutor">
                One last thing: this site is an unofficial concept, a picture of what Learn WordPress could feel like. It
                isn't run by WordPress.org. {copy.closing}
              </Bubble>
            </div>
            <a class="button button--quiet finale-home" href="/">
              Back to the start
            </a>
          </div>
        </div>
      </section>
    </>
  );
}
