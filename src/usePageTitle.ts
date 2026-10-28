import { useEffect } from 'preact/hooks';

export const SITE_NAME = 'Learn WordPress, reimagined';

/** Sets `document.title` to "<title> · Learn WordPress, reimagined", or the bare site name for null. */
export function usePageTitle(title: string | null): void {
  useEffect(() => {
    document.title = title ? `${title} · ${SITE_NAME}` : SITE_NAME;
  }, [title]);
}

/**
 * Sets `<meta name="description">` while the page is mounted, and puts back the description the
 * page loaded with afterwards. Null leaves the loaded description in place.
 */
export function useMetaDescription(description: string | null): void {
  useEffect(() => {
    if (!description) return;
    let meta = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    const created = !meta;
    if (!meta) {
      meta = document.createElement('meta');
      meta.name = 'description';
      document.head.append(meta);
    }
    const before = meta.content;
    meta.content = description;
    return () => {
      if (created) meta.remove();
      else meta.content = before;
    };
  }, [description]);
}
