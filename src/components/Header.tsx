import { REPO_URL } from '../config';
import { RecordPanel } from './RecordPanel';
import { Sticker } from './Sticker';

export function Header() {
  return (
    <header class="site-header">
      <a class="skip-link" href="#main">Skip to content</a>
      <div class="wrap site-header__inner">
        <div class="brand">
          <a class="wordmark" href="/">Learn WordPress, reimagined</a>
          <Sticker>unofficial concept</Sticker>
        </div>
        <nav class="site-nav" aria-label="Main">
          <ul>
            <li><a href="/#paths">Paths</a></li>
            <li class="nav-optional"><a href="/how-it-works">How this works</a></li>
            <li class="nav-optional"><a href={REPO_URL}>GitHub</a></li>
          </ul>
          <RecordPanel />
        </nav>
      </div>
    </header>
  );
}
