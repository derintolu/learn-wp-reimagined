import { useEffect } from 'preact/hooks';

export const SITE_NAME = 'Learn WordPress, reimagined';

/** Sets `document.title` to "<title> · Learn WordPress, reimagined", or the bare site name for null. */
export function usePageTitle(title: string | null): void {
  useEffect(() => {
    document.title = title ? `${title} · ${SITE_NAME}` : SITE_NAME;
  }, [title]);
}
