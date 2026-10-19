import type { ComponentChildren } from 'preact';

export function Placeholder({ title, children }: { title: ComponentChildren; children: ComponentChildren }) {
  return (
    <section class="band band--light">
      <div class="wrap split">
        <h1 class="placeholder__title">{title}</h1>
        <div class="split__body placeholder__body lede">
          {children}
          <div>
            <a class="button button--quiet" href="/">Back to the start</a>
          </div>
        </div>
      </div>
    </section>
  );
}
