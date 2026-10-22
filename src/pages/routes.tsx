import { Swipe } from '../components/Swipe';
import { Placeholder } from './Placeholder';
import { usePageTitle } from '../usePageTitle';

export const NOT_FOUND_TITLE = 'Page not found';

export function NotFound() {
  usePageTitle(NOT_FOUND_TITLE);
  return (
    <Placeholder title={<>Nothing <Swipe>here</Swipe></>}>
      <p>That page doesn't exist. Head back and pick a path.</p>
    </Placeholder>
  );
}
