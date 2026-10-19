import { Sticker } from './Sticker';
import { REPO_URL } from './Header';

export function Footer() {
  return (
    <footer class="site-footer">
      <div class="wrap">
        <div class="site-footer__top">
          <div class="site-footer__brand">
            <span>Learn WordPress, reimagined</span>
            <Sticker>unofficial concept</Sticker>
          </div>
          <div class="site-footer__cols">
            <div>
              <p class="site-footer__heading">Who made this</p>
              <p>
                Concept and build by <a href="https://github.com/derintolu">Derin Tolu</a>. Ideas, bugs and
                kind words are all welcome.
              </p>
              <ul class="site-footer__links">
                <li><a href={REPO_URL}>Source on GitHub</a></li>
                <li><a href="mailto:hello@derintolu.com">hello@derintolu.com</a></li>
              </ul>
            </div>
            <div>
              <p class="site-footer__heading">Where the lessons come from</p>
              <p>
                Lessons are adapted from <a href="https://learn.wordpress.org/">Learn WordPress</a> and the
                Developer Handbooks, and haven't been reviewed by the Training Team. Lesson content is
                CC BY-SA 4.0. Code is GPL-2.0-or-later.
              </p>
            </div>
          </div>
        </div>
        <div class="site-footer__legal">
          <p>Not affiliated with WordPress.org or the WordPress Foundation.</p>
          <p>Made with WordPress-shaped love.</p>
        </div>
      </div>
    </footer>
  );
}
