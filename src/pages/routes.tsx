import { Swipe } from '../components/Swipe';
import { Placeholder } from './Placeholder';

export function NotFound() {
  return (
    <Placeholder title={<>Nothing <Swipe>here</Swipe></>}>
      <p>That page doesn't exist. Head back and pick a path.</p>
    </Placeholder>
  );
}
