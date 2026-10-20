import { useMemo } from 'preact/hooks';
import { content } from '../content';
import { useRecord } from '../record/useRecord';
import { resolveTheme, themeZip, THEME_SLUG } from '../finale/themeZip';
import { PLAYGROUND_URL_LIMIT, playgroundUrl } from '../finale/playground';
import { Bubble } from '../components/Bubble';
import { SketchIcon } from '../components/SketchIcon';
import { Swipe } from '../components/Swipe';

function downloadZip(files: Record<string, string>) {
  const blob = new Blob([themeZip(files) as BlobPart], { type: 'application/zip' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${THEME_SLUG}.zip`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Some browsers start the download asynchronously; revoking at once can cancel it.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function Finale() {
  const { record } = useRecord();
  const path = content.paths['block-theme'];
  const lessons = path.lessons.map((id) => content.lessons[id]).filter(Boolean);
  const done = new Set(record.completedLessons);
  const doneCount = lessons.filter((l) => done.has(l.id)).length;
  const theme = useMemo(() => resolveTheme(content, record), [record]);
  const files = theme.files;
  const url = useMemo(() => playgroundUrl(files), [files]);
  const fits = url.length < PLAYGROUND_URL_LIMIT;
  const names = Object.keys(files).sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b));

  return (
    <>
      <section class="band band--dark finale-hero" aria-labelledby="finale-title">
        <div class="wrap split">
          <div class="finale-hero__head">
            <SketchIcon name="block-theme" class="finale-hero__icon" />
            <h1 class="split__title finale-hero__title" id="finale-title">
              You made it <Swipe>this far</Swipe>
            </h1>
          </div>
          <div class="split__body finale-hero__body">
            {doneCount > 0 ? (
              <p class="lede">
                That's a real WordPress block theme, and you wrote it. Take it home as a zip, or watch it run in a full
                WordPress site in your browser.
              </p>
            ) : (
              <p class="lede">
                Here's the block theme this path builds. Open the finished reference theme in a real WordPress site, then
                work through the lessons to make it yours.
              </p>
            )}
            <p class="finale-hero__meta">
              {doneCount === lessons.length
                ? `All ${lessons.length} lessons done.`
                : doneCount > 0
                  ? `${doneCount} of ${lessons.length} lessons done. Anything you skipped comes from the finished reference theme, so it's still complete.`
                  : `0 of ${lessons.length} lessons done.`}
            </p>
            <div class="finale-actions">
              <button type="button" class="button" onClick={() => downloadZip(files)}>
                Download your theme (.zip)
              </button>
              {fits ? (
                <a class="button button--quiet" href={url} target="_blank" rel="noopener noreferrer">
                  Open in WordPress Playground
                  <span aria-hidden="true">↗</span>
                  <span class="visually-hidden"> (opens in a new tab)</span>
                </a>
              ) : (
                <p class="finale-actions__note">
                  Your theme is too big for a Playground link. Download the zip, open playground.wordpress.net and upload
                  it under Appearance → Themes.
                </p>
              )}
            </div>
            {fits && (
              <p class="finale-hero__fine">
                Playground runs WordPress entirely in your browser. It takes a few seconds to start, then shows your theme's
                front page. Nothing is uploaded anywhere.
              </p>
            )}
          </div>
        </div>
      </section>

      <section class="band band--light" aria-labelledby="theme-title">
        <div class="wrap split">
          <h2 class="split__title" id="theme-title">
            What's in <Swipe>your theme</Swipe>
          </h2>
          <div class="split__body split__body--wide finale-theme">
            <div class="finale-files">
              <p class="finale-files__root">
                <span aria-hidden="true">▾ </span>
                {THEME_SLUG}/
              </p>
              <ul class="finale-files__list" aria-label="Files in your theme">
                {names.map((f) => (
                  <li key={f}>
                    <code>{f}</code>
                    {theme.used.includes(f) && <span class="chip chip--here">Your edit</span>}
                  </li>
                ))}
              </ul>
              {theme.replaced.length > 0 && (
                <ul class="finale-files__notes">
                  {theme.replaced.map((n) => (
                    <li key={n.file}>{n.message}</li>
                  ))}
                </ul>
              )}
            </div>
            <ol class="lesson-list finale-lessons" aria-label="Lessons in your theme">
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
                <h3>Install it on a real site</h3>
                <p>
                  In any WordPress site, go to Appearance → Themes → Add New Theme → Upload Theme, choose{' '}
                  <code>{THEME_SLUG}.zip</code> and activate it. Then open the Site Editor and keep shaping it.
                </p>
              </li>
              <li>
                <h3>Keep learning</h3>
                <p>
                  The <a href="https://learn.wordpress.org/">Learn WordPress</a> courses and the{' '}
                  <a href="https://developer.wordpress.org/themes/">Theme Handbook</a> go deeper on everything here. The
                  Create Block Theme plugin exports whatever you change in the Site Editor back to files.
                </p>
              </li>
            </ol>
            <div class="chat finale-chat">
              <Bubble from="tutor">
                One last thing: this site is an unofficial concept, a picture of what Learn WordPress could feel like. It
                isn't run by WordPress.org. The theme, though, is entirely yours.
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
