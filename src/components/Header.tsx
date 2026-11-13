import { useEffect, useRef, useState } from 'preact/hooks';
import { REPO_URL } from '../config';
import { RecordPanel } from './RecordPanel';
import { Sticker } from './Sticker';

export function Header() {
  // Narrow screens hide the links behind a Menu button (the CSS shows the button only there).
  const [open, setOpen] = useState(false);
  const nav = useRef<HTMLElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!nav.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [open]);

  return (
    <header class="site-header">
      <a class="skip-link" href="#main">Skip to content</a>
      <div class="wrap site-header__inner">
        <div class="brand">
          <a class="wordmark" href="/">Learn WordPress, reimagined</a>
          <Sticker>unofficial concept</Sticker>
        </div>
        <nav class="site-nav" aria-label="Main" ref={nav}>
          <button
            ref={toggle}
            type="button"
            class="site-nav__toggle"
            aria-expanded={open ? 'true' : 'false'}
            aria-controls="site-nav-links"
            onClick={() => setOpen((o) => !o)}
          >
            Menu
          </button>
          <ul
            id="site-nav-links"
            class={open ? 'is-open' : undefined}
            onClick={(e) => {
              if ((e.target as Element).closest('a')) setOpen(false);
            }}
            onKeyDown={(e) => {
              if (e.key !== 'Escape') return;
              setOpen(false);
              toggle.current?.focus();
            }}
          >
            <li><a href="/#paths">Paths</a></li>
            <li class="nav-optional"><a href="/how-it-works">How this works</a></li>
            <li class="nav-optional"><a href="/blog">Blog</a></li>
            <li class="nav-optional"><a href={REPO_URL}>GitHub</a></li>
          </ul>
          <RecordPanel />
        </nav>
      </div>
    </header>
  );
}
