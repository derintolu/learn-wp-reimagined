import { Swipe } from '../components/Swipe';
import { Placeholder } from './Placeholder';

// Placeholders until the finale task lands.
export function FinalePage() {
  return (
    <Placeholder title={<>You made it <Swipe>this far</Swipe></>}>
      <p>The finale is still being built. It's where you'll find your planted bug and download your record.</p>
    </Placeholder>
  );
}

export function NotFound() {
  return (
    <Placeholder title={<>Nothing <Swipe>here</Swipe></>}>
      <p>That page doesn't exist. Head back and pick a path.</p>
    </Placeholder>
  );
}
