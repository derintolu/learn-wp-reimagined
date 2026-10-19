import { content } from '../content';
import type { PathId } from '../shared/types';
import { SketchIcon } from './SketchIcon';

export const PATH_ORDER: PathId[] = ['learner', 'block-theme', 'vibe-coder'];

function minutes(id: PathId): number {
  return content.paths[id].lessons.reduce((sum, l) => sum + (content.lessons[l]?.minutes ?? 0), 0);
}

/** The three path cards. Live paths link to their page; coming-soon cards are plain, not clickable. */
export function PathCards() {
  return (
    <ul class="path-cards">
      {PATH_ORDER.map((id) => {
        const path = content.paths[id];
        const live = path.status === 'live';
        const count = path.lessons.length;
        return (
          <li class={`path-card ${live ? 'path-card--live' : 'path-card--soon'}`} key={id}>
            <SketchIcon name={id} class="path-card__icon" />
            <h3 class="path-card__title">
              {live ? (
                <a class="path-card__link" href={`/path/${id}`}>
                  {path.title}
                </a>
              ) : (
                path.title
              )}
            </h3>
            <p class="path-card__tagline">{path.tagline}</p>
            <p class="path-card__meta">
              {live ? (
                <>
                  {count} {count === 1 ? 'lesson' : 'lessons'}, about {minutes(id)} minutes
                  <span class="path-card__go" aria-hidden="true">→</span>
                </>
              ) : (
                <span class="path-card__status">Coming soon</span>
              )}
            </p>
          </li>
        );
      })}
    </ul>
  );
}
